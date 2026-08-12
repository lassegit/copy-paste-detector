/**
 * @cpd/core — headless provenance and typing-dynamics engine.
 *
 * This package knows nothing about the DOM. It consumes a stream of normalised
 * events and produces a `Report` describing where a field's text came from and
 * how it got there. Bind it to real elements with `@cpd/dom`, or replay a
 * submitted log server-side with `replay()`.
 *
 * A report is a signal, not a verdict. It cannot distinguish someone composing
 * from someone transcribing text off a second screen, and it should never be
 * wired directly to an automated rejection.
 */

export { diffSplice, type Splice } from './diff.ts'
export { ProvenanceLedger, type LedgerSplice } from './ledger.ts'
export {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  evaluate,
  type ScoreConfig,
  type ScoreFacts,
  type Thresholds,
  type Verdict,
  type Weights,
} from './score.ts'
export {
  ProvenanceSession,
  replay,
  type PrivacyMode,
  type SessionOptions,
} from './session.ts'
export { countGraphemes } from './text.ts'
export { DEFAULT_TIMING_CONFIG, TimingTracker, type TimingConfig } from './timing.ts'
export {
  AUTHORED_ORIGINS,
  IMPORTED_ORIGINS,
  type AttentionStats,
  type CaveatCode,
  type CompositionStats,
  type EditEvent,
  type FieldState,
  type Origin,
  type PasteStats,
  type ProvenanceEvent,
  type Report,
  type Run,
  type Signal,
  type SignalCode,
  type TimingStats,
} from './types.ts'
