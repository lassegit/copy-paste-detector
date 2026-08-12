import type {
  AttentionStats,
  CaveatCode,
  CompositionStats,
  FieldState,
  PasteStats,
  Signal,
  SignalCode,
  TimingStats,
} from './types.ts'

export interface Thresholds {
  /** A single paste at or above this many characters is worth noting. */
  readonly largePasteChars: number
  /** Fraction of the final text that may come from the clipboard before it counts against the field. */
  readonly pastedRatio: number
  /** Time away from the field that makes a subsequent large import notable. */
  readonly awayBeforeImportMs: number
  /** Sustained words per minute beyond which the input is not plausibly typed. */
  readonly sustainedWpm: number
  /** Coefficient of variation below which keystroke rhythm looks machine-generated. */
  readonly roboticCv: number
  /** Keystrokes required before rhythm is judged at all. */
  readonly roboticMinKeystrokes: number
  /** Text length beyond which a complete absence of corrections is itself notable. */
  readonly noCorrectionsMinChars: number
  /** Corrections-per-character at or below which text looks transcribed rather than composed. */
  readonly noCorrectionsRatio: number
  /** Keystrokes required before any timing signal is trusted. */
  readonly minKeystrokesForTiming: number
  /** Score at which a field is worth a human look. */
  readonly reviewScore: number
  /** Score at which a field is flagged. */
  readonly suspiciousScore: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  largePasteChars: 40,
  pastedRatio: 0.35,
  awayBeforeImportMs: 3_000,
  // The fastest sustained typist on record sat around 216 wpm; ordinary fast
  // typing is 90-120. 220 leaves generous headroom above any real human.
  sustainedWpm: 220,
  // Human inter-keystroke intervals are bursty: CV normally lands between 0.4
  // and 1.0. Anything under 0.2 is a machine holding a metronome.
  roboticCv: 0.2,
  roboticMinKeystrokes: 30,
  noCorrectionsMinChars: 200,
  noCorrectionsRatio: 0.01,
  minKeystrokesForTiming: 20,
  reviewScore: 35,
  suspiciousScore: 70,
}

export type Weights = Record<SignalCode, number>

/** Maximum points each signal can contribute. Crossing a threshold always yields at least half. */
export const DEFAULT_WEIGHTS: Weights = {
  'paste.large': 22,
  'paste.ratio': 34,
  'paste.after-away': 24,
  'typing.impossible-speed': 34,
  'typing.robotic': 26,
  'typing.no-corrections': 14,
  'input.programmatic': 30,
  'input.untrusted': 40,
}

/**
 * Caveats that withhold a signal entirely.
 *
 * These are not tuning knobs, they are correctness requirements. An IME user
 * composing Japanese produces multi-character inserts with meaningless
 * inter-key intervals; a swipe-keyboard user produces whole words at a time;
 * someone using a switch device or word prediction produces neither of the
 * rhythms we model. Scoring those inputs with the typing signals would not
 * detect misconduct, it would detect not typing in English on a laptop.
 */
const SUPPRESSED_BY: Partial<Record<SignalCode, readonly CaveatCode[]>> = {
  'typing.impossible-speed': [
    'accessibility-mode',
    'ime-composition',
    'wordwise-input',
    'dictation',
    'insufficient-timing-data',
  ],
  'typing.robotic': [
    'accessibility-mode',
    'ime-composition',
    'wordwise-input',
    'dictation',
    'insufficient-timing-data',
  ],
  'typing.no-corrections': ['accessibility-mode', 'ime-composition', 'dictation'],
}

/** Everything the scorer is allowed to look at. */
export interface ScoreFacts {
  readonly length: number
  readonly composition: CompositionStats
  readonly paste: PasteStats
  readonly timing: TimingStats
  readonly attention: AttentionStats
  readonly programmaticChars: number
  readonly untrustedEdits: number
}

export interface ScoreConfig {
  readonly thresholds: Thresholds
  readonly weights: Weights
}

export interface Verdict {
  readonly score: number
  readonly state: FieldState
  readonly signals: readonly Signal[]
}

interface Candidate {
  readonly code: SignalCode
  readonly value: number
  /** 0–1, how far past the threshold the measurement sits. */
  readonly strength: number
  readonly detail: string
}

/**
 * Turn measurements into a score plus the reasons behind it.
 *
 * Signals contribute `weight * (0.5 + 0.5 * strength)` rather than firing as
 * step functions, so a field that barely crosses a threshold scores visibly
 * lower than one that blows past it — a 41-character paste and a 4000-character
 * paste should not look identical to a reviewer.
 */
export function evaluate(
  facts: ScoreFacts,
  caveats: readonly CaveatCode[],
  config: ScoreConfig,
): Verdict {
  const { thresholds: t, weights } = config
  const candidates: Candidate[] = []

  if (facts.paste.largestChars >= t.largePasteChars) {
    candidates.push({
      code: 'paste.large',
      value: facts.paste.largestChars,
      strength: ramp(facts.paste.largestChars, t.largePasteChars, t.largePasteChars * 6),
      detail: `A single paste inserted ${facts.paste.largestChars} characters.`,
    })
  }

  if (facts.composition.pastedRatio >= t.pastedRatio) {
    candidates.push({
      code: 'paste.ratio',
      value: facts.composition.pastedRatio,
      strength: ramp(facts.composition.pastedRatio, t.pastedRatio, 1),
      detail: `${percent(facts.composition.pastedRatio)} of the final text came from the clipboard.`,
    })
  }

  if (facts.paste.afterAwayCount > 0) {
    // Strength tracks how long the user was gone rather than how many times it
    // happened: one paste after a minute away says far more than three pastes
    // after four seconds.
    const away = facts.attention.msAwayBeforeLargestImport ?? t.awayBeforeImportMs
    candidates.push({
      code: 'paste.after-away',
      value: away,
      strength: ramp(away, t.awayBeforeImportMs, t.awayBeforeImportMs * 4),
      detail: `${facts.paste.afterAwayCount} paste(s) landed within moments of the user returning, after ${seconds(away)} away.`,
    })
  }

  const peak = facts.timing.peakWpm
  if (peak !== null && peak >= t.sustainedWpm) {
    candidates.push({
      code: 'typing.impossible-speed',
      value: peak,
      strength: ramp(peak, t.sustainedWpm, t.sustainedWpm * 2),
      detail: `Sustained ${Math.round(peak)} wpm, above the fastest recorded human typing speed.`,
    })
  }

  const cv = facts.timing.ikiCv
  if (cv !== null && cv <= t.roboticCv && facts.timing.keystrokes >= t.roboticMinKeystrokes) {
    candidates.push({
      code: 'typing.robotic',
      value: cv,
      strength: ramp(t.roboticCv - cv, 0, t.roboticCv),
      detail: `Keystroke rhythm was near-uniform (variation ${cv.toFixed(2)}); human typing is markedly burstier.`,
    })
  }

  if (
    facts.timing.insertedChars >= t.noCorrectionsMinChars &&
    facts.timing.correctionRatio <= t.noCorrectionsRatio
  ) {
    candidates.push({
      code: 'typing.no-corrections',
      value: facts.timing.correctionRatio,
      strength: ramp(t.noCorrectionsRatio - facts.timing.correctionRatio, 0, t.noCorrectionsRatio),
      detail: `${facts.timing.insertedChars} characters typed with essentially no corrections, which reads as transcription rather than composition.`,
    })
  }

  if (facts.programmaticChars > 0) {
    candidates.push({
      code: 'input.programmatic',
      value: facts.programmaticChars,
      strength: ramp(facts.programmaticChars, 1, Math.max(2, t.largePasteChars)),
      detail: `${facts.programmaticChars} characters were written by script rather than entered by a user.`,
    })
  }

  if (facts.untrustedEdits > 0) {
    candidates.push({
      code: 'input.untrusted',
      value: facts.untrustedEdits,
      strength: 1,
      detail: `${facts.untrustedEdits} edit(s) came from synthesised events rather than real user input.`,
    })
  }

  const signals: Signal[] = []
  let score = 0
  for (const candidate of candidates) {
    const suppressor = SUPPRESSED_BY[candidate.code]?.find((code) => caveats.includes(code))
    const weight = weights[candidate.code]
    if (suppressor !== undefined) {
      signals.push({ ...candidate, weight: 0, suppressedBy: suppressor })
      continue
    }
    const contribution = weight * (0.5 + 0.5 * candidate.strength)
    score += contribution
    signals.push({ ...candidate, weight: round(contribution) })
  }

  score = round(Math.min(100, score))
  signals.sort((a, b) => b.weight - a.weight)

  return { score, state: stateFor(score, facts, t), signals }
}

function stateFor(score: number, facts: ScoreFacts, t: Thresholds): FieldState {
  if (score >= t.suspiciousScore) return 'suspicious'
  if (score >= t.reviewScore) return 'review'
  if (facts.composition.importedRatio > 0) return 'pasted'
  return 'clean'
}

/** Position of `value` between `from` and `to`, clamped to 0–1. */
function ramp(value: number, from: number, to: number): number {
  if (to <= from) return 1
  return Math.min(1, Math.max(0, (value - from) / (to - from)))
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
