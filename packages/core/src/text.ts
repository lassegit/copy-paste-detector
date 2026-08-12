/**
 * Grapheme counting.
 *
 * The ledger works in UTF-16 code units because that is what `selectionStart`
 * and friends speak. Typing-speed maths, on the other hand, has to work in
 * graphemes: an emoji is two code units and a Devanagari cluster can be five,
 * and counting those as separate "characters" would report a user as typing at
 * several hundred words per minute for writing their own name.
 */

const segmenter: Intl.Segmenter | undefined =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined

/** Number of user-perceived characters in `text`. Falls back to code points where `Intl.Segmenter` is unavailable. */
export function countGraphemes(text: string): number {
  if (text.length === 0) return 0
  // Fast path: no surrogates and no combining marks means code units are graphemes.
  if (!hasComplexScript(text)) return text.length
  if (segmenter === undefined) {
    let count = 0
    for (const _ of text) count++
    return count
  }
  let count = 0
  for (const _ of segmenter.segment(text)) count++
  return count
}

/** True when `text` contains anything that could make code-unit length disagree with grapheme length. */
function hasComplexScript(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // Surrogates, combining marks, ZWJ, variation selectors, and regional indicators.
    if (code > 0x02ff) return true
  }
  return false
}
