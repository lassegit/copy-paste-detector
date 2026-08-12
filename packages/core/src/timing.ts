import type { TimingStats } from './types.ts'

export interface TimingConfig {
  /** Gaps longer than this count as thinking, not typing, and are excluded from active time and interval stats. */
  readonly idleThresholdMs: number
  /** Rolling window for peak typing rate. */
  readonly wpmWindowMs: number
  /** Inserts up to this many graphemes are treated as word-at-a-time input (swipe keyboards, predictive text). */
  readonly wordwiseMaxGraphemes: number
}

export const DEFAULT_TIMING_CONFIG: TimingConfig = {
  idleThresholdMs: 2_000,
  wpmWindowMs: 4_000,
  wordwiseMaxGraphemes: 24,
}

/**
 * Accumulates typing dynamics from authored input only.
 *
 * Everything here is deliberately blind to pasted, dropped and programmatic
 * text: a paste is not typing, and letting it into the numbers would make a
 * single paste look like a burst of superhuman speed — double-counting the same
 * evidence under two different signals.
 */
export class TimingTracker {
  readonly #config: TimingConfig

  #keystrokes = 0
  #insertedGraphemes = 0
  #deletedChars = 0
  #activeMs = 0

  #intervals: number[] = []
  #lastKeystrokeAt: number | null = null
  #lastAuthoredAt: number | null = null
  #firstAuthoredAt: number | null = null

  #window: Array<{ t: number; graphemes: number }> = []
  #peakWpm: number | null = null

  #wordwiseInserts = 0

  constructor(config: TimingConfig = DEFAULT_TIMING_CONFIG) {
    this.#config = config
  }

  /** Number of multi-grapheme authored inserts seen — the fingerprint of a swipe or predictive keyboard. */
  get wordwiseInserts(): number {
    return this.#wordwiseInserts
  }

  get keystrokes(): number {
    return this.#keystrokes
  }

  /** Record a deletion. Deletions count regardless of what origin the removed text had. */
  recordDeletion(chars: number): void {
    if (chars > 0) this.#deletedChars += chars
  }

  /** Record an authored insertion of `graphemes` user-perceived characters at time `t`. */
  recordAuthoredInsert(t: number, graphemes: number): void {
    if (graphemes <= 0) return

    this.#insertedGraphemes += graphemes
    this.#firstAuthoredAt ??= t

    if (this.#lastAuthoredAt !== null) {
      const gap = t - this.#lastAuthoredAt
      if (gap >= 0 && gap <= this.#config.idleThresholdMs) this.#activeMs += gap
    }
    this.#lastAuthoredAt = t

    if (graphemes === 1) {
      this.#keystrokes++
      if (this.#lastKeystrokeAt !== null) {
        const interval = t - this.#lastKeystrokeAt
        if (interval >= 0 && interval <= this.#config.idleThresholdMs) this.#intervals.push(interval)
      }
      this.#lastKeystrokeAt = t
    } else {
      if (graphemes <= this.#config.wordwiseMaxGraphemes) this.#wordwiseInserts++
      // Key-to-key intervals must not span a chunk insert, so break the chain.
      this.#lastKeystrokeAt = null
    }

    this.#pushWindow(t, graphemes)
  }

  /**
   * Peak rate is measured over a fixed-width window rather than between
   * adjacent keystrokes. Two characters five milliseconds apart is not evidence
   * of anything — everyone produces bursts — but two hundred characters inside
   * four seconds is.
   */
  #pushWindow(t: number, graphemes: number): void {
    this.#window.push({ t, graphemes })
    const cutoff = t - this.#config.wpmWindowMs
    while (this.#window.length > 0 && (this.#window[0] as { t: number }).t < cutoff) this.#window.shift()

    // Don't report a peak until a full window's worth of history exists, or the
    // opening keystrokes of every session would read as impossibly fast.
    if (this.#firstAuthoredAt === null || t - this.#firstAuthoredAt < this.#config.wpmWindowMs) return

    let graphemesInWindow = 0
    for (const sample of this.#window) graphemesInWindow += sample.graphemes
    const wpm = graphemesInWindow / 5 / (this.#config.wpmWindowMs / 60_000)
    if (this.#peakWpm === null || wpm > this.#peakWpm) this.#peakWpm = wpm
  }

  stats(): TimingStats {
    const intervals = this.#intervals
    const mean = intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null

    let cv: number | null = null
    if (mean !== null && mean > 0 && intervals.length > 1) {
      const variance = intervals.reduce((total, x) => total + (x - mean) ** 2, 0) / intervals.length
      cv = Math.sqrt(variance) / mean
    }

    let median: number | null = null
    if (intervals.length > 0) {
      const sorted = [...intervals].sort((a, b) => a - b)
      const mid = sorted.length >> 1
      median =
        sorted.length % 2 === 0
          ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
          : (sorted[mid] as number)
    }

    const meanWpm =
      this.#activeMs > 0 ? this.#insertedGraphemes / 5 / (this.#activeMs / 60_000) : null

    return {
      keystrokes: this.#keystrokes,
      insertedChars: this.#insertedGraphemes,
      deletedChars: this.#deletedChars,
      correctionRatio: this.#insertedGraphemes > 0 ? this.#deletedChars / this.#insertedGraphemes : 0,
      activeMs: this.#activeMs,
      meanIkiMs: mean,
      medianIkiMs: median,
      ikiCv: cv,
      peakWpm: this.#peakWpm,
      meanWpm,
    }
  }
}
