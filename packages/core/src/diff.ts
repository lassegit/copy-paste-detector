import { countGraphemes } from './text.ts'

/** A minimal single-range edit describing how one string became another. */
export interface Splice {
  /** Offset of the change, in UTF-16 code units. */
  readonly start: number
  readonly removed: number
  readonly inserted: number
  readonly insertedText: string
  readonly graphemes: number
}

/**
 * Derive the splice that turns `prev` into `next` by trimming the common prefix
 * and suffix.
 *
 * This is the safety net under the whole library. `beforeinput` tells us what
 * the user *meant* to do, but plenty of things change a field's value without
 * announcing themselves — extensions, password managers, framework re-renders,
 * automation drivers. Diffing the value on every `input` event means the ledger
 * stays anchored to reality even when no event explained the change.
 *
 * The result is the *minimal* single range, so it will under-report a change
 * that happens to share edges with the old text (typing "b" in "aa" -> "aba"
 * reads as inserting "b" at 1, which is right, but "ab" -> "ba" reads as
 * replacing the whole string). That is the correct trade-off here: we need a
 * cheap, deterministic O(n) reconciliation, not a minimal edit script.
 */
export function diffSplice(prev: string, next: string): Splice {
  const maxPrefix = Math.min(prev.length, next.length)
  let prefix = 0
  while (prefix < maxPrefix && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++
  // Never cut between a surrogate pair's halves.
  if (prefix > 0 && prefix < maxPrefix && isHighSurrogate(prev.charCodeAt(prefix - 1))) prefix--

  const maxSuffix = Math.min(prev.length - prefix, next.length - prefix)
  let suffix = 0
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++
  }
  if (suffix > 0 && suffix < maxSuffix && isLowSurrogate(next.charCodeAt(next.length - suffix))) suffix--

  const insertedText = next.slice(prefix, next.length - suffix)
  return {
    start: prefix,
    removed: prev.length - prefix - suffix,
    inserted: insertedText.length,
    insertedText,
    graphemes: countGraphemes(insertedText),
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}
