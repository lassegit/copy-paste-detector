/**
 * Where a run of characters in a field came from.
 *
 * Origins are about *provenance* — how the text physically got into the field —
 * not about intent. Judging intent is the scorer's job, and it is deliberately
 * kept separate so that callers can reinterpret the same ledger under different
 * policies (see `score.ts`).
 */
export type Origin =
  /** Present in the field before the session started (server-rendered draft, restored form state). */
  | 'initial'
  /** Produced one grapheme at a time by a human at a keyboard. */
  | 'typed'
  /** Produced through an IME composition session (CJK and friends). Human-authored. */
  | 'composed'
  /** Produced by speech-to-text. Human-authored, arrives in large chunks. */
  | 'dictated'
  /** Pasted from the clipboard. */
  | 'pasted'
  /** Dropped in via drag-and-drop. */
  | 'dropped'
  /** Substituted by the platform: autocorrect, spellcheck, autofill, text expansion. */
  | 'replaced'
  /** Written by script — `el.value = …`, a browser extension, an automation driver. */
  | 'programmatic'
  /** Provenance could not be established (undo/redo, ledger desync, unsupported input type). */
  | 'unknown'

/** Origins that represent text a human produced in the field, keystroke by keystroke or utterance by utterance. */
export const AUTHORED_ORIGINS: ReadonlySet<Origin> = new Set<Origin>(['typed', 'composed', 'dictated'])

/** Origins that represent text that arrived from somewhere else, fully formed. */
export const IMPORTED_ORIGINS: ReadonlySet<Origin> = new Set<Origin>(['pasted', 'dropped', 'programmatic'])

/** A contiguous run of characters sharing one origin. Lengths are UTF-16 code units, matching `selectionStart`. */
export interface Run {
  readonly origin: Origin
  readonly length: number
  /** Milliseconds since session start, at which this run entered the field. */
  readonly at: number
}

/**
 * One splice applied to the field. Covers insertion (`removed === 0`), deletion
 * (`inserted === 0`) and replacement (both non-zero) in a single shape.
 */
export interface EditEvent {
  readonly kind: 'edit'
  /** Milliseconds since session start. */
  readonly t: number
  /** Offset of the splice, in UTF-16 code units. */
  readonly start: number
  /** UTF-16 code units removed at `start`. */
  readonly removed: number
  /** UTF-16 code units inserted at `start`. */
  readonly inserted: number
  /**
   * Grapheme count of the inserted text. Carried separately from `inserted` so
   * that typing-speed maths stays correct for emoji and combining marks even
   * when the text itself has been redacted. Defaults to `inserted`.
   */
  readonly graphemes?: number
  readonly origin: Origin
  /** The originating `InputEvent.inputType`, when there was one. Diagnostic only. */
  readonly inputType?: string
  /** The inserted text. Only present in `forensic` privacy mode. */
  readonly text?: string
  /** `false` when the event was synthesised by script rather than by the user agent. */
  readonly trusted?: boolean
}

/** The field gained or lost focus. */
export interface FocusEvent_ {
  readonly kind: 'focus' | 'blur'
  readonly t: number
}

/** The document became visible or hidden — tab switches, app switches. */
export interface VisibilityEvent {
  readonly kind: 'visibility'
  readonly t: number
  readonly visible: boolean
}

/** An IME composition session started or ended. */
export interface CompositionEvent_ {
  readonly kind: 'composition'
  readonly t: number
  readonly phase: 'start' | 'end'
}

/**
 * The full event vocabulary. Every member is plain JSON so a session log can be
 * submitted with the form and replayed server-side by `replay()`.
 */
export type ProvenanceEvent = EditEvent | FocusEvent_ | VisibilityEvent | CompositionEvent_

/** Reasons a signal may be withheld, or a report read with care. */
export type CaveatCode =
  /** IME composition was observed. Inter-keystroke timing is not meaningful. */
  | 'ime-composition'
  /** Speech-to-text was observed. Large inserts are expected. */
  | 'dictation'
  /** Text arrived a word at a time — swipe/glide keyboards, predictive text. Timing is not meaningful. */
  | 'wordwise-input'
  /** Timing signals were disabled by the caller. */
  | 'accessibility-mode'
  /** Too few keystrokes to say anything about typing dynamics. */
  | 'insufficient-timing-data'
  /** The ledger lost track of the field's real contents; composition figures are approximate. */
  | 'ledger-desynced'
  /**
   * Some of the text has no established provenance — it appeared without an
   * input event to explain it, or survived an undo. Informational: it withholds
   * no signal, but a reviewer should know the breakdown does not cover
   * everything.
   */
  | 'unattributed-content'
  /** Text content was not retained, by design. */
  | 'redacted'

/** The reasons a score is what it is. A report is never allowed to be a bare number. */
export type SignalCode =
  | 'paste.large'
  | 'paste.ratio'
  | 'paste.after-away'
  | 'typing.impossible-speed'
  | 'typing.robotic'
  | 'typing.no-corrections'
  | 'input.programmatic'
  | 'input.untrusted'

/** One contributing (or withheld) reason behind a score. */
export interface Signal {
  readonly code: SignalCode
  /** Points this signal added to the score. `0` when withheld. */
  readonly weight: number
  /** The measurement that triggered it. */
  readonly value: number
  /** Human-readable explanation, suitable for showing to a reviewer. */
  readonly detail: string
  /** Present when the signal fired but was withheld; names the caveat responsible. */
  readonly suppressedBy?: CaveatCode
}

/** Coarse verdict, suitable for a `data-` attribute and a CSS selector. */
export type FieldState = 'clean' | 'pasted' | 'review' | 'suspicious'

/** How the final text breaks down by provenance. */
export interface CompositionStats {
  /** Fraction of the field a human produced in place. */
  readonly authoredRatio: number
  /** Fraction that arrived fully formed from elsewhere. */
  readonly importedRatio: number
  /** Fraction the user brought in from outside — clipboard or drag-and-drop, excluding script writes. */
  readonly pastedRatio: number
  /** Longest single surviving imported run, in UTF-16 code units. */
  readonly largestImportedRun: number
}

/** Clipboard and drag-drop activity over the session. */
export interface PasteStats {
  readonly count: number
  /** Total characters ever pasted, including any later deleted. */
  readonly totalChars: number
  readonly largestChars: number
  /** Pastes that landed shortly after the user returned to the field. */
  readonly afterAwayCount: number
}

/** Typing dynamics. All figures derive from authored input only; pastes never inflate them. */
export interface TimingStats {
  /** Single-grapheme inserts — actual key presses. */
  readonly keystrokes: number
  /** Graphemes authored over the session, including any later deleted. */
  readonly insertedChars: number
  readonly deletedChars: number
  /** `deletedChars / insertedChars`. Real composition sits around 0.05–0.20; transcription near 0. */
  readonly correctionRatio: number
  /** Time spent actively typing, excluding pauses longer than the idle threshold. */
  readonly activeMs: number
  readonly meanIkiMs: number | null
  readonly medianIkiMs: number | null
  /** Coefficient of variation of inter-keystroke intervals. Human typing is bursty (~0.4–1.0); scripts are metronomic. */
  readonly ikiCv: number | null
  /** Highest sustained rate over a rolling window. */
  readonly peakWpm: number | null
  /** Words per minute across active typing time. */
  readonly meanWpm: number | null
}

/** Where the user's attention went during the session. */
export interface AttentionStats {
  readonly blurCount: number
  readonly hiddenCount: number
  /** Total time the field was unfocused or the document hidden. */
  readonly awayMs: number
  /** How long the user had been away immediately before the largest import landed. */
  readonly msAwayBeforeLargestImport: number | null
}

/** The complete verdict for one field. */
export interface Report {
  readonly version: 1
  readonly state: FieldState
  /** 0–100. Derived entirely from `signals`; never treat it as ground truth. */
  readonly score: number
  readonly signals: readonly Signal[]
  readonly caveats: readonly CaveatCode[]
  /** Final field length in UTF-16 code units. */
  readonly length: number
  readonly elapsedMs: number
  readonly runs: readonly Run[]
  readonly composition: CompositionStats
  readonly paste: PasteStats
  readonly timing: TimingStats
  readonly attention: AttentionStats
}
