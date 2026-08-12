import type { ProvenanceEvent, Report } from '@cpd/core'
import { findForm, type ProvenanceTarget } from './target.ts'

export interface HiddenInputOptions {
  /** Field name to submit under. Given the watched element so it can be derived from its own name. */
  readonly name: (element: ProvenanceTarget) => string
  /**
   * What to submit.
   *
   * `summary` is small and constant-sized, but a client can edit it before
   * posting. `log` carries the raw event stream so the server can recompute the
   * verdict with `replay()` — worth far more, at roughly 40 bytes per keystroke.
   */
  readonly include: 'summary' | 'log' | 'both'
  /** Refuse to write a payload larger than this many bytes, rather than silently bloating the request. */
  readonly maxBytes: number
}

export const DEFAULT_HIDDEN_INPUT_OPTIONS: HiddenInputOptions = {
  name: (element) => `_cpd_${nameOf(element) || 'field'}`,
  include: 'summary',
  maxBytes: 64 * 1024,
}

/** The submitted payload. Deliberately flat and versioned so a server can parse it without this package. */
export interface HiddenPayload {
  readonly v: 1
  readonly summary?: {
    readonly state: string
    readonly score: number
    readonly length: number
    readonly caveats: readonly string[]
    readonly composition: Report['composition']
    readonly paste: Report['paste']
    readonly timing: Report['timing']
    readonly attention: Report['attention']
    /** `[code, weight]` pairs, ordered by contribution. */
    readonly signals: ReadonlyArray<readonly [string, number]>
  }
  readonly log?: readonly ProvenanceEvent[]
  /** Set when the log was dropped for exceeding `maxBytes`. */
  readonly truncated?: true
}

export function buildPayload(
  report: Report,
  events: readonly ProvenanceEvent[],
  options: HiddenInputOptions,
): HiddenPayload {
  const summary =
    options.include === 'log'
      ? undefined
      : {
          state: report.state,
          score: report.score,
          length: report.length,
          caveats: report.caveats,
          composition: report.composition,
          paste: report.paste,
          timing: report.timing,
          attention: report.attention,
          signals: report.signals.map((signal) => [signal.code, signal.weight] as const),
        }

  if (options.include === 'summary') return { v: 1, summary }

  const withLog: HiddenPayload = { v: 1, summary, log: events }
  if (JSON.stringify(withLog).length <= options.maxBytes) return withLog

  // Silently posting a truncated log would let a server believe it had verified
  // something it had not. Drop the log and say so instead.
  return { v: 1, summary, truncated: true }
}

/** Create or update the hidden field carrying the payload, inside the element's form. */
export function syncHiddenInput(
  element: ProvenanceTarget,
  report: Report,
  events: readonly ProvenanceEvent[],
  options: HiddenInputOptions,
): HTMLInputElement | null {
  const form = findForm(element)
  if (form === null) return null

  const name = options.name(element)
  const existing = form.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${escapeAttributeValue(name)}"]`,
  )
  const field = existing ?? document.createElement('input')
  if (existing === null) {
    field.type = 'hidden'
    field.name = name
    form.append(field)
  }

  field.value = JSON.stringify(buildPayload(report, events, options))
  return field
}

/** `CSS.escape` where available; a conservative fallback for non-browser DOM implementations. */
function escapeAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

function nameOf(element: ProvenanceTarget): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.name || element.id
  }
  return element.id
}
