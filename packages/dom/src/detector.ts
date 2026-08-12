import {
  ProvenanceSession,
  countGraphemes,
  diffSplice,
  type Origin,
  type ProvenanceEvent,
  type Report,
  type SessionOptions,
} from '@cpd/core'
import { classify } from './classify.ts'
import {
  DEFAULT_HIDDEN_INPUT_OPTIONS,
  syncHiddenInput,
  type HiddenInputOptions,
} from './hidden-input.ts'
import { DEFAULT_REFLECT_OPTIONS, clearReflection, reflect, type ReflectOptions } from './reflect.ts'
import { createAdapter, findForm, type ProvenanceTarget, type TargetAdapter } from './target.ts'

export interface DetectorOptions extends SessionOptions {
  /** Write the verdict back onto the element as attributes. Pass `false` to disable. */
  readonly reflect?: boolean | Partial<ReflectOptions>
  /** Carry the verdict in a hidden form field, for servers that only see the form post. */
  readonly hiddenInput?: boolean | Partial<HiddenInputOptions>
  /** Dispatch `cpd:paste`, `cpd:report` and `cpd:flag` CustomEvents on the element. */
  readonly emitEvents?: boolean
  /** How long to coalesce updates before recomputing the report and touching the DOM. */
  readonly updateDebounceMs?: number
  /**
   * Intercept the element's `value` setter to catch script writes as they happen.
   *
   * Off by default, and deliberately so: React installs its own instance-level
   * `value` descriptor for change tracking, and whichever library defines its
   * property last wins. Without this, script writes are still caught at the next
   * checkpoint, just attributed to `unknown` rather than `programmatic`.
   */
  readonly detectProgrammatic?: boolean
  /**
   * Treat script-dispatched input events as legitimate.
   *
   * `isTrusted` is worth watching — form-filling spam scripts routinely set
   * `value` and dispatch a synthetic `input` — but it is a blunt instrument.
   * Browser automation driven through CDP (Playwright, Puppeteer, Selenium)
   * produces *trusted* events and sails past it, while testing libraries and
   * component kits that dispatch their own events get caught. Turn this on when
   * your application legitimately synthesises input.
   */
  readonly allowSyntheticEvents?: boolean
  readonly onReport?: (report: Report, element: ProvenanceTarget) => void
}

interface ResolvedOptions {
  readonly reflect: ReflectOptions | null
  readonly hiddenInput: HiddenInputOptions | null
  readonly emitEvents: boolean
  readonly updateDebounceMs: number
  readonly detectProgrammatic: boolean
  readonly allowSyntheticEvents: boolean
  readonly onReport: ((report: Report, element: ProvenanceTarget) => void) | undefined
}

/**
 * Watches one field and keeps a `ProvenanceSession` in step with it.
 *
 * The design rests on two sources of truth used together. `InputEvent.inputType`
 * says what the user meant to do, and a diff of the value against the last known
 * one says what actually happened. Trusting only the first misses everything
 * that changes a field without announcing itself — extensions, password
 * managers, framework re-renders, automation drivers. Trusting only the second
 * cannot tell a paste from fast typing. Together they cover each other.
 */
export class InputProvenanceDetector {
  readonly element: ProvenanceTarget
  readonly session: ProvenanceSession

  readonly #adapter: TargetAdapter
  readonly #options: ResolvedOptions
  readonly #start: number
  readonly #teardown: Array<() => void> = []

  #value: string
  #pendingPaste = false
  #pendingDrop = false
  #hinted: Origin | undefined
  #composing = false
  #updateTimer: ReturnType<typeof setTimeout> | undefined
  #lastState: Report['state'] | undefined
  #destroyed = false
  #restoreValueDescriptor: (() => void) | undefined

  constructor(element: ProvenanceTarget, options: DetectorOptions = {}) {
    this.element = element
    this.#adapter = createAdapter(element)
    this.#options = resolve(options)
    this.#start = performance.now()
    this.#value = this.#adapter.read()

    this.session = new ProvenanceSession({
      ...options,
      initialLength: this.#value.length,
      // A password field never retains its text, whatever the caller asked for.
      privacy: this.#adapter.sensitive && options.privacy === 'forensic' ? 'balanced' : options.privacy,
    })

    this.#bind()
    if (this.#options.detectProgrammatic) this.#interceptValueSetter()
  }

  /** Current verdict. Recomputed on demand; cheap enough to call from a render loop, but debounced internally for DOM writes. */
  report(): Report {
    return this.session.report()
  }

  /** Character ranges by origin, for highlighting which parts of the field were imported. */
  ranges(): ReturnType<ProvenanceSession['ranges']> {
    return this.session.ranges()
  }

  /** The replayable event log, for submitting to a server that will re-score it. */
  get events(): readonly ProvenanceEvent[] {
    return this.session.events
  }

  /**
   * Declare the origin of the next insertion.
   *
   * There is no `inputType` for speech-to-text, so an application that provides
   * its own dictation control has to say so — otherwise a dictated paragraph is
   * indistinguishable from a paste, and users who dictate get penalised for it.
   */
  hintNextInsert(origin: Origin): void {
    this.#hinted = origin
  }

  /** Reconcile against the field's real contents right now, e.g. before submitting. */
  sync(): void {
    this.#checkpoint()
    this.#update(true)
  }

  reset(): void {
    this.#value = this.#adapter.read()
    this.session.reset(this.#value.length)
    this.#lastState = undefined
    this.#update(true)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    if (this.#updateTimer !== undefined) clearTimeout(this.#updateTimer)
    for (const off of this.#teardown) off()
    this.#teardown.length = 0
    this.#restoreValueDescriptor?.()
    if (this.#options.reflect !== null) clearReflection(this.element, this.#options.reflect)
  }

  // ---------------------------------------------------------------- listeners

  #bind(): void {
    const element = this.element

    this.#on(element, 'beforeinput', () => {
      // Checkpoint: anything that changed the value since the last input event
      // did so without telling us. Attribute it before the user's own edit lands
      // on top of it. Skipped mid-composition, where the value is in flux.
      if (!this.#composing) this.#checkpoint()
    })

    this.#on(element, 'input', (event) => {
      this.#applyInput(event as InputEvent)
    })

    this.#on(element, 'paste', (event) => {
      this.#pendingPaste = true
      this.#expirePendingClipboard()
      if (this.#options.emitEvents) {
        const text = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? ''
        this.#emit('cpd:paste', { chars: text.length, graphemes: countGraphemes(text) })
      }
    })

    this.#on(element, 'drop', () => {
      this.#pendingDrop = true
      this.#expirePendingClipboard()
    })

    this.#on(element, 'compositionstart', () => {
      this.#composing = true
      this.session.dispatch({ kind: 'composition', t: this.#now(), phase: 'start' })
    })

    this.#on(element, 'compositionend', () => {
      this.#composing = false
      this.session.dispatch({ kind: 'composition', t: this.#now(), phase: 'end' })
    })

    this.#on(element, 'focus', () => {
      this.#checkpoint()
      this.session.dispatch({ kind: 'focus', t: this.#now() })
    })

    this.#on(element, 'blur', () => {
      this.#checkpoint()
      this.session.dispatch({ kind: 'blur', t: this.#now() })
      this.#update(true)
    })

    this.#on(document, 'visibilitychange', () => {
      this.session.dispatch({
        kind: 'visibility',
        t: this.#now(),
        visible: document.visibilityState === 'visible',
      })
    })

    // Make sure the hidden field is current at the moment of submission, not
    // one debounce interval behind it.
    const form = findForm(element)
    if (form !== null) this.#on(form, 'submit', () => this.sync())
  }

  #on(target: EventTarget, type: string, handler: (event: Event) => void): void {
    const wrapped = (event: Event): void => {
      if (this.#destroyed) return
      handler(event)
    }
    target.addEventListener(type, wrapped, true)
    this.#teardown.push(() => {
      target.removeEventListener(type, wrapped, true)
    })
  }

  // ------------------------------------------------------------------- edits

  #applyInput(event: InputEvent): void {
    const next = this.#adapter.read()
    const splice = diffSplice(this.#value, next)
    this.#value = next

    if (splice.removed === 0 && splice.inserted === 0) return

    const origin = classify(event.inputType, {
      hinted: this.#hinted,
      pendingPaste: this.#pendingPaste,
      pendingDrop: this.#pendingDrop,
      composing: this.#composing || event.isComposing,
      graphemes: splice.graphemes,
    })

    // A clipboard event vouches for exactly one insertion — the one it
    // preceded. Holding the flag any longer would attribute whatever the user
    // typed next to the clipboard as well, which is precisely wrong when
    // several edits are dispatched inside a single task.
    this.#pendingPaste = false
    this.#pendingDrop = false
    this.#hinted = undefined

    this.session.dispatch({
      kind: 'edit',
      t: this.#now(),
      start: splice.start,
      removed: splice.removed,
      inserted: splice.inserted,
      graphemes: splice.graphemes,
      origin,
      inputType: event.inputType,
      text: splice.insertedText,
      // Only an affirmative `true` counts as trusted. A DOM implementation that
      // leaves the property unset has not vouched for the event.
      trusted: this.#options.allowSyntheticEvents || event.isTrusted === true,
    })

    this.#update(false)
  }

  /**
   * Reconcile against the field's real contents.
   *
   * The delta is attributed to `unknown`, not `programmatic`. We genuinely do
   * not know what changed it — a framework normalising the value on re-render
   * looks exactly like an automation driver from here, and calling the first one
   * "written by script" would put points on the board for ordinary React apps.
   * Turn on `detectProgrammatic` when you need the stronger claim.
   */
  #checkpoint(): void {
    const current = this.#adapter.read()
    if (current === this.#value) return

    const splice = diffSplice(this.#value, current)
    this.#value = current
    this.session.dispatch({
      kind: 'edit',
      t: this.#now(),
      start: splice.start,
      removed: splice.removed,
      inserted: splice.inserted,
      graphemes: splice.graphemes,
      origin: 'unknown',
      text: splice.insertedText,
    })
  }

  #interceptValueSetter(): void {
    const element = this.element
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) return

    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    const get = descriptor?.get
    const set = descriptor?.set
    if (get === undefined || set === undefined) return

    Object.defineProperty(element, 'value', {
      configurable: true,
      enumerable: true,
      get: () => get.call(element),
      set: (next: string) => {
        set.call(element, next)
        const current = this.#adapter.read()
        if (current === this.#value) return
        const splice = diffSplice(this.#value, current)
        this.#value = current
        this.session.dispatch({
          kind: 'edit',
          t: this.#now(),
          start: splice.start,
          removed: splice.removed,
          inserted: splice.inserted,
          graphemes: splice.graphemes,
          origin: 'programmatic',
          text: splice.insertedText,
        })
        this.#update(false)
      },
    })

    this.#restoreValueDescriptor = () => {
      Reflect.deleteProperty(element, 'value')
    }
  }

  // ------------------------------------------------------------------ output

  #update(immediate: boolean): void {
    if (this.#updateTimer !== undefined) {
      clearTimeout(this.#updateTimer)
      this.#updateTimer = undefined
    }
    if (immediate || this.#options.updateDebounceMs <= 0) {
      this.#flush()
      return
    }
    this.#updateTimer = setTimeout(() => {
      this.#updateTimer = undefined
      this.#flush()
    }, this.#options.updateDebounceMs)
  }

  #flush(): void {
    if (this.#destroyed) return
    const report = this.session.report()

    if (this.#options.reflect !== null) reflect(this.element, report, this.#options.reflect)
    if (this.#options.hiddenInput !== null) {
      syncHiddenInput(this.element, report, this.session.events, this.#options.hiddenInput)
    }

    if (this.#options.emitEvents) {
      this.#emit('cpd:report', { report })
      const escalated =
        (report.state === 'review' || report.state === 'suspicious') && report.state !== this.#lastState
      if (escalated) this.#emit('cpd:flag', { report })
    }
    this.#lastState = report.state
    this.#options.onReport?.(report, this.element)
  }

  /** Safety net: if a paste is cancelled no `input` event follows, so the flag must not linger. */
  #expirePendingClipboard(): void {
    queueMicrotask(() => {
      this.#pendingPaste = false
      this.#pendingDrop = false
    })
  }

  #emit(type: string, detail: unknown): void {
    this.element.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }))
  }

  #now(): number {
    return Math.max(0, Math.round(performance.now() - this.#start))
  }
}

function resolve(options: DetectorOptions): ResolvedOptions {
  return {
    reflect:
      options.reflect === false
        ? null
        : { ...DEFAULT_REFLECT_OPTIONS, ...(typeof options.reflect === 'object' ? options.reflect : {}) },
    hiddenInput:
      options.hiddenInput === undefined || options.hiddenInput === false
        ? null
        : {
            ...DEFAULT_HIDDEN_INPUT_OPTIONS,
            ...(typeof options.hiddenInput === 'object' ? options.hiddenInput : {}),
          },
    emitEvents: options.emitEvents ?? true,
    updateDebounceMs: options.updateDebounceMs ?? 250,
    detectProgrammatic: options.detectProgrammatic ?? false,
    allowSyntheticEvents: options.allowSyntheticEvents ?? false,
    onReport: options.onReport,
  }
}
