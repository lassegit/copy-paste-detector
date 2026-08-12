import type { Origin, Run } from './types.ts'

/** A splice to apply to the ledger. Offsets and lengths are UTF-16 code units. */
export interface LedgerSplice {
  readonly start: number
  readonly removed: number
  readonly inserted: number
  readonly origin: Origin
  readonly at: number
}

/**
 * Tracks the origin of every character currently in a field.
 *
 * This is a piece table with provenance attached: a list of contiguous runs
 * that always sums to the field's length. Splicing it on every edit means the
 * ledger reflects the text as it stands *now*, not as a history of events — so
 * a user who pastes 500 characters and then rewrites half of them ends up with
 * half pasted and half typed, which is the honest answer. A one-shot "a paste
 * happened" flag cannot express that, and would libel anyone who pasted a
 * reference and then wrote around it.
 */
export class ProvenanceLedger {
  #runs: Run[] = []
  #length = 0
  #desynced = false

  constructor(initialLength = 0, origin: Origin = 'initial') {
    if (initialLength > 0) {
      this.#runs.push({ origin, length: initialLength, at: 0 })
      this.#length = initialLength
    }
  }

  /** Total length of the field, in UTF-16 code units. */
  get length(): number {
    return this.#length
  }

  /** True once the ledger has had to guess — an out-of-range splice or an unexplained value change. */
  get desynced(): boolean {
    return this.#desynced
  }

  get runs(): readonly Run[] {
    return this.#runs
  }

  /** Apply an edit. Out-of-range offsets are clamped rather than thrown, and flag the ledger as desynced. */
  splice(splice: LedgerSplice): void {
    const start = clamp(splice.start, 0, this.#length)
    const removed = clamp(splice.removed, 0, this.#length - start)
    const inserted = Math.max(0, splice.inserted)
    if (start !== splice.start || removed !== splice.removed) this.#desynced = true
    if (removed === 0 && inserted === 0) return

    const end = start + removed
    const next: Run[] = []
    const tail: Run[] = []

    let cursor = 0
    for (const run of this.#runs) {
      const runStart = cursor
      const runEnd = runStart + run.length
      cursor = runEnd

      // The part of this run that sits before the splice point survives ahead of the insertion.
      const headLength = Math.max(0, Math.min(run.length, start - runStart))
      if (headLength > 0) next.push({ origin: run.origin, length: headLength, at: run.at })

      // The part at or after the end of the removed range survives behind it.
      const tailLength = Math.max(0, runEnd - Math.max(end, runStart))
      if (tailLength > 0) tail.push({ origin: run.origin, length: tailLength, at: run.at })
    }

    if (inserted > 0) next.push({ origin: splice.origin, length: inserted, at: splice.at })
    for (const run of tail) next.push(run)

    this.#runs = coalesce(next)
    this.#length = this.#runs.reduce((total, run) => total + run.length, 0)
  }

  /**
   * Force the ledger to a known length when the field's real contents have
   * drifted from what the events described. The difference is attributed to
   * `origin`, which callers should set to `'programmatic'` when they know
   * script wrote the value and `'unknown'` when they genuinely cannot tell.
   */
  reconcile(actualLength: number, at: number, origin: Origin = 'unknown'): void {
    if (actualLength === this.#length) return
    if (origin === 'unknown') this.#desynced = true
    if (actualLength > this.#length) {
      this.splice({ start: this.#length, removed: 0, inserted: actualLength - this.#length, origin, at })
    } else {
      this.splice({ start: actualLength, removed: this.#length - actualLength, inserted: 0, origin, at })
    }
  }

  /** Total surviving length attributable to any of `origins`. */
  lengthOf(origins: ReadonlySet<Origin>): number {
    let total = 0
    for (const run of this.#runs) if (origins.has(run.origin)) total += run.length
    return total
  }

  /** Longest single surviving run attributable to any of `origins`. */
  largestRun(origins: ReadonlySet<Origin>): number {
    let largest = 0
    for (const run of this.#runs) {
      if (origins.has(run.origin) && run.length > largest) largest = run.length
    }
    return largest
  }

  /** Fraction of the field attributable to any of `origins`. Empty fields are `0`. */
  ratioOf(origins: ReadonlySet<Origin>): number {
    if (this.#length === 0) return 0
    return this.lengthOf(origins) / this.#length
  }

  /** Absolute character offsets of each run, for highlighting the imported parts of a field. */
  ranges(): Array<{ start: number; end: number; origin: Origin; at: number }> {
    const out: Array<{ start: number; end: number; origin: Origin; at: number }> = []
    let cursor = 0
    for (const run of this.#runs) {
      out.push({ start: cursor, end: cursor + run.length, origin: run.origin, at: run.at })
      cursor += run.length
    }
    return out
  }
}

/** Merge neighbouring runs that share an origin, keeping the earlier timestamp, and drop empties. */
function coalesce(runs: readonly Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    if (run.length <= 0) continue
    const previous = out[out.length - 1]
    if (previous !== undefined && previous.origin === run.origin) {
      out[out.length - 1] = {
        origin: previous.origin,
        length: previous.length + run.length,
        at: Math.min(previous.at, run.at),
      }
    } else {
      out.push(run)
    }
  }
  return out
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), Math.max(min, max))
}
