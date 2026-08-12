import { ProvenanceLedger } from './ledger.ts'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, evaluate, type Thresholds, type Weights } from './score.ts'
import { DEFAULT_TIMING_CONFIG, TimingTracker, type TimingConfig } from './timing.ts'
import {
  AUTHORED_ORIGINS,
  IMPORTED_ORIGINS,
  type CaveatCode,
  type EditEvent,
  type Origin,
  type ProvenanceEvent,
  type Report,
} from './types.ts'

/** Text brought in from outside the field by the user, as opposed to written by script. */
const CLIPBOARD_ORIGINS: ReadonlySet<Origin> = new Set<Origin>(['pasted', 'dropped'])
const PROGRAMMATIC_ORIGINS: ReadonlySet<Origin> = new Set<Origin>(['programmatic'])
const UNKNOWN_ORIGINS: ReadonlySet<Origin> = new Set<Origin>(['unknown'])

/**
 * How much detail the session retains.
 *
 * Keystroke timing is behavioural biometric data. Under GDPR it becomes special
 * category data the moment it is used to identify a person, and even short of
 * that it is personal data. The default is therefore the least revealing mode
 * that still works: no text, coarsened clocks.
 */
export type PrivacyMode =
  /** No text retained; timestamps rounded to 50ms. Enough for paste ratios, too coarse to fingerprint a typist. */
  | 'strict'
  /** No text retained; timestamps rounded to 10ms. The default. */
  | 'balanced'
  /** Full text and exact timestamps retained. Only for explicit, consented investigation. */
  | 'forensic'

const TIME_RESOLUTION: Record<PrivacyMode, number> = {
  strict: 50,
  balanced: 10,
  forensic: 1,
}

export interface SessionOptions {
  /** Length of any text already in the field when the session began. Attributed to `initial`. */
  readonly initialLength?: number
  readonly privacy?: PrivacyMode
  /**
   * Withhold every timing-derived signal.
   *
   * Set this when a user relies on assistive input — switch access, word
   * prediction, text expansion, an on-screen keyboard. Their typing dynamics
   * carry no information about authorship, only about how they type.
   */
  readonly accessibilityMode?: boolean
  /** Retain the event log so it can be submitted and re-scored server-side. On by default. */
  readonly keepLog?: boolean
  readonly thresholds?: Partial<Thresholds>
  readonly weights?: Partial<Weights>
  readonly timing?: Partial<TimingConfig>
}

/**
 * Accumulates events for a single field and produces a `Report`.
 *
 * The session holds no reference to the DOM and never performs I/O. That keeps
 * it testable without a browser, and means the exact same code can re-score a
 * submitted event log on a server — see `replay()`.
 */
export class ProvenanceSession {
  readonly #privacy: PrivacyMode
  readonly #resolution: number
  readonly #accessibilityMode: boolean
  readonly #keepLog: boolean
  readonly #thresholds: Thresholds
  readonly #weights: Weights
  readonly #timingConfig: TimingConfig
  readonly #initialLength: number

  #ledger: ProvenanceLedger
  #timing: TimingTracker
  #events: ProvenanceEvent[] = []

  #pasteCount = 0
  #pasteTotalChars = 0
  #pasteLargestChars = 0
  #pasteAfterAwayCount = 0
  #untrustedEdits = 0

  #sawComposition = false
  #sawDictation = false

  #focused = true
  #visible = true
  #awaySince: number | null = null
  #awayMs = 0
  #lastReturnedAt: number | null = null
  #lastAwayDurationMs = 0
  #blurCount = 0
  #hiddenCount = 0

  #largestImportChars = 0
  #msAwayBeforeLargestImport: number | null = null

  #lastT = 0

  constructor(options: SessionOptions = {}) {
    this.#privacy = options.privacy ?? 'balanced'
    this.#resolution = TIME_RESOLUTION[this.#privacy]
    this.#accessibilityMode = options.accessibilityMode ?? false
    this.#keepLog = options.keepLog ?? true
    this.#thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds }
    this.#weights = { ...DEFAULT_WEIGHTS, ...options.weights }
    this.#timingConfig = { ...DEFAULT_TIMING_CONFIG, ...options.timing }
    this.#initialLength = options.initialLength ?? 0

    this.#ledger = new ProvenanceLedger(this.#initialLength, 'initial')
    this.#timing = new TimingTracker(this.#timingConfig)
  }

  /** Current field length, in UTF-16 code units, as the ledger understands it. */
  get length(): number {
    return this.#ledger.length
  }

  /** The recorded event log, ready to be JSON-serialised and submitted alongside the form. */
  get events(): readonly ProvenanceEvent[] {
    return this.#events
  }

  /** Feed one event. Timestamps are coarsened on ingest so that a replayed log scores identically. */
  dispatch(event: ProvenanceEvent): void {
    const t = this.#quantise(event.t)
    if (t > this.#lastT) this.#lastT = t

    switch (event.kind) {
      case 'edit':
        this.#applyEdit({ ...event, t })
        break
      case 'focus':
        this.#setPresence(t, true, this.#visible)
        break
      case 'blur':
        this.#blurCount++
        this.#setPresence(t, false, this.#visible)
        break
      case 'visibility':
        if (!event.visible) this.#hiddenCount++
        this.#setPresence(t, this.#focused, event.visible)
        break
      case 'composition':
        this.#sawComposition = true
        break
    }

    if (this.#keepLog) this.#events.push(this.#redact({ ...event, t } as ProvenanceEvent))
  }

  #applyEdit(edit: EditEvent): void {
    const graphemes = edit.graphemes ?? edit.inserted

    this.#ledger.splice({
      start: edit.start,
      removed: edit.removed,
      inserted: edit.inserted,
      origin: edit.origin,
      at: edit.t,
    })

    if (edit.trusted === false) this.#untrustedEdits++
    if (edit.origin === 'dictated') this.#sawDictation = true
    this.#timing.recordDeletion(edit.removed)

    if (AUTHORED_ORIGINS.has(edit.origin)) {
      this.#timing.recordAuthoredInsert(edit.t, graphemes)
    }

    if (CLIPBOARD_ORIGINS.has(edit.origin) && edit.inserted > 0) {
      this.#pasteCount++
      this.#pasteTotalChars += edit.inserted
      if (edit.inserted > this.#pasteLargestChars) this.#pasteLargestChars = edit.inserted
      if (this.#landedAfterReturning(edit)) this.#pasteAfterAwayCount++
    }

    if (IMPORTED_ORIGINS.has(edit.origin) && edit.inserted > this.#largestImportChars) {
      this.#largestImportChars = edit.inserted
      this.#msAwayBeforeLargestImport = this.#lastReturnedAt === null ? null : this.#lastAwayDurationMs
    }
  }

  /**
   * The tab-away-and-return pattern: the user left for long enough to have gone
   * somewhere, came straight back, and a substantial block of text appeared. On
   * its own this is circumstantial — people look things up — which is why it is
   * a weighted signal rather than a verdict.
   */
  #landedAfterReturning(edit: EditEvent): boolean {
    if (this.#lastReturnedAt === null) return false
    if (edit.inserted < this.#thresholds.largePasteChars) return false
    if (this.#lastAwayDurationMs < this.#thresholds.awayBeforeImportMs) return false
    return edit.t - this.#lastReturnedAt <= this.#thresholds.awayBeforeImportMs
  }

  #setPresence(t: number, focused: boolean, visible: boolean): void {
    const wasPresent = this.#focused && this.#visible
    this.#focused = focused
    this.#visible = visible
    const isPresent = focused && visible

    if (wasPresent && !isPresent) {
      this.#awaySince = t
    } else if (!wasPresent && isPresent && this.#awaySince !== null) {
      this.#lastAwayDurationMs = Math.max(0, t - this.#awaySince)
      this.#awayMs += this.#lastAwayDurationMs
      this.#lastReturnedAt = t
      this.#awaySince = null
    }
  }

  #caveats(keystrokes: number): CaveatCode[] {
    const caveats: CaveatCode[] = []
    if (this.#accessibilityMode) caveats.push('accessibility-mode')
    if (this.#sawComposition) caveats.push('ime-composition')
    if (this.#sawDictation) caveats.push('dictation')
    if (this.#timing.wordwiseInserts >= 3) caveats.push('wordwise-input')
    if (keystrokes < this.#thresholds.minKeystrokesForTiming) caveats.push('insufficient-timing-data')
    if (this.#ledger.desynced) caveats.push('ledger-desynced')
    if (this.#ledger.lengthOf(UNKNOWN_ORIGINS) > 0) caveats.push('unattributed-content')
    if (this.#privacy !== 'forensic') caveats.push('redacted')
    return caveats
  }

  report(): Report {
    const timing = this.#timing.stats()
    const caveats = this.#caveats(timing.keystrokes)

    const composition = {
      authoredRatio: this.#ledger.ratioOf(AUTHORED_ORIGINS),
      importedRatio: this.#ledger.ratioOf(IMPORTED_ORIGINS),
      pastedRatio: this.#ledger.ratioOf(CLIPBOARD_ORIGINS),
      largestImportedRun: this.#ledger.largestRun(IMPORTED_ORIGINS),
    }

    const paste = {
      count: this.#pasteCount,
      totalChars: this.#pasteTotalChars,
      largestChars: this.#pasteLargestChars,
      afterAwayCount: this.#pasteAfterAwayCount,
    }

    const attention = {
      blurCount: this.#blurCount,
      hiddenCount: this.#hiddenCount,
      awayMs: this.#awayMs + (this.#awaySince === null ? 0 : Math.max(0, this.#lastT - this.#awaySince)),
      msAwayBeforeLargestImport: this.#msAwayBeforeLargestImport,
    }

    const verdict = evaluate(
      {
        length: this.#ledger.length,
        composition,
        paste,
        timing,
        attention,
        programmaticChars: this.#ledger.lengthOf(PROGRAMMATIC_ORIGINS),
        untrustedEdits: this.#untrustedEdits,
      },
      caveats,
      { thresholds: this.#thresholds, weights: this.#weights },
    )

    return {
      version: 1,
      state: verdict.state,
      score: verdict.score,
      signals: verdict.signals,
      caveats,
      length: this.#ledger.length,
      elapsedMs: this.#lastT,
      runs: this.#ledger.runs,
      composition,
      paste,
      timing,
      attention,
    }
  }

  /** Character ranges by origin, for highlighting which parts of the field were imported. */
  ranges(): Array<{ start: number; end: number; origin: Origin; at: number }> {
    return this.#ledger.ranges()
  }

  /** Drop all state and start over. */
  reset(initialLength: number = this.#initialLength): void {
    this.#ledger = new ProvenanceLedger(initialLength, 'initial')
    this.#timing = new TimingTracker(this.#timingConfig)
    this.#events = []
    this.#pasteCount = 0
    this.#pasteTotalChars = 0
    this.#pasteLargestChars = 0
    this.#pasteAfterAwayCount = 0
    this.#untrustedEdits = 0
    this.#sawComposition = false
    this.#sawDictation = false
    this.#focused = true
    this.#visible = true
    this.#awaySince = null
    this.#awayMs = 0
    this.#lastReturnedAt = null
    this.#lastAwayDurationMs = 0
    this.#blurCount = 0
    this.#hiddenCount = 0
    this.#largestImportChars = 0
    this.#msAwayBeforeLargestImport = null
    this.#lastT = 0
  }

  /** Reconcile the ledger against the field's real length when something changed it without telling us. */
  reconcile(actualLength: number, t: number, origin: Origin = 'unknown'): void {
    this.#ledger.reconcile(actualLength, this.#quantise(t), origin)
  }

  #quantise(t: number): number {
    if (this.#resolution <= 1) return Math.max(0, Math.round(t))
    return Math.max(0, Math.round(t / this.#resolution) * this.#resolution)
  }

  #redact(event: ProvenanceEvent): ProvenanceEvent {
    if (this.#privacy === 'forensic' || event.kind !== 'edit' || event.text === undefined) return event
    const { text: _text, ...rest } = event
    return rest
  }
}

/**
 * Re-score a submitted event log.
 *
 * Client-side scores are advisory: anyone can edit the number before it is
 * posted. Posting the *log* instead and recomputing here raises the bar
 * considerably — a forgery now has to be an internally consistent event stream
 * with a plausible distribution of inter-keystroke intervals, not a single
 * flipped integer. It is still not proof, and nothing in this library should be
 * used as if it were.
 */
export function replay(events: readonly ProvenanceEvent[], options: SessionOptions = {}): Report {
  const session = new ProvenanceSession(options)
  for (const event of events) session.dispatch(event)
  return session.report()
}
