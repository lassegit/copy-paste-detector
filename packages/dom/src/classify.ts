import type { Origin } from '@cpd/core'

/**
 * `InputEvent.inputType` → provenance.
 *
 * These names are specified by Input Events Level 2, and they are the single
 * most reliable signal available in the browser: the spec requires a `paste`
 * event to precede any `insertFromPaste`, and requires the user agent to report
 * the user's *intention* rather than the mechanism. Everything else in this
 * package exists to cover the cases where this table does not apply.
 */
const INPUT_TYPE_ORIGINS: Readonly<Record<string, Origin>> = {
  // Clipboard and drag-drop.
  insertFromPaste: 'pasted',
  insertFromPasteAsQuotation: 'pasted',
  // The macOS/Emacs kill ring. Morally a paste.
  insertFromYank: 'pasted',
  insertFromDrop: 'dropped',

  // Platform substitutions: autocorrect, spellcheck suggestions, autofill, and
  // text expanders. Deliberately its own origin — treating a text expander as a
  // paste would penalise assistive tooling.
  insertReplacementText: 'replaced',

  // Ordinary authoring.
  insertText: 'typed',
  insertLineBreak: 'typed',
  insertParagraph: 'typed',
  insertCompositionText: 'composed',
  insertFromComposition: 'composed',

  // Undo and redo resurrect text whose provenance we can no longer vouch for.
  historyUndo: 'unknown',
  historyRedo: 'unknown',
}

export interface ClassificationHints {
  /** An explicit hint from the host application, e.g. its own dictation button. Wins over everything. */
  readonly hinted?: Origin | undefined
  /** A `paste` event fired in this same turn. */
  readonly pendingPaste: boolean
  /** A `drop` event fired in this same turn. */
  readonly pendingDrop: boolean
  /** The field is mid-IME-composition. */
  readonly composing: boolean
  /** Grapheme count of the inserted text, used only as a last-resort heuristic. */
  readonly graphemes: number
}

/**
 * Decide where an insertion came from.
 *
 * Clipboard and drop events outrank `inputType` because they are corroborating
 * evidence from a different source: if a `paste` event just fired, the text came
 * from the clipboard regardless of what the user agent called the input type.
 * Several mobile browsers have historically reported `insertText` for a paste.
 */
export function classify(inputType: string | undefined, hints: ClassificationHints): Origin {
  if (hints.hinted !== undefined) return hints.hinted
  if (hints.pendingDrop) return 'dropped'
  if (hints.pendingPaste) return 'pasted'

  if (inputType !== undefined && inputType !== '') {
    const mapped = INPUT_TYPE_ORIGINS[inputType]
    if (mapped !== undefined) return mapped
    // Deletions carry no insertion, so their origin is never used for a run.
    if (inputType.startsWith('delete')) return 'unknown'
    // Rich-text formatting in contenteditable, and anything the spec adds later.
    return 'unknown'
  }

  if (hints.composing) return 'composed'

  // No `inputType` at all — a very old browser, or a synthetic event. A single
  // grapheme is almost certainly a key press; a block of text could be anything.
  return hints.graphemes === 1 ? 'typed' : 'unknown'
}

/** True when this input type only removes text, so the field's value shrinks. */
export function isDeletion(inputType: string | undefined): boolean {
  return inputType !== undefined && inputType.startsWith('delete')
}
