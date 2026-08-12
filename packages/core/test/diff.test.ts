import { describe, expect, it } from 'vitest'
import { diffSplice } from '../src/diff.ts'
import { countGraphemes } from '../src/text.ts'

describe('diffSplice', () => {
  it('reports no change for identical strings', () => {
    expect(diffSplice('hello', 'hello')).toMatchObject({ start: 5, removed: 0, inserted: 0 })
  })

  it('finds an insertion', () => {
    expect(diffSplice('helloworld', 'hello brave world')).toMatchObject({
      start: 5,
      removed: 0,
      insertedText: ' brave ',
    })
  })

  it('finds a deletion', () => {
    expect(diffSplice('hello brave world', 'hello world')).toMatchObject({
      start: 6,
      removed: 6,
      inserted: 0,
    })
  })

  it('finds a replacement', () => {
    expect(diffSplice('the cat sat', 'the dog sat')).toMatchObject({
      start: 4,
      removed: 3,
      insertedText: 'dog',
    })
  })

  it('handles insertion into an empty field', () => {
    expect(diffSplice('', 'pasted text')).toMatchObject({
      start: 0,
      removed: 0,
      inserted: 11,
      insertedText: 'pasted text',
    })
  })

  it('handles clearing a field', () => {
    expect(diffSplice('some text', '')).toMatchObject({ start: 0, removed: 9, inserted: 0 })
  })

  it('never splits a surrogate pair', () => {
    const result = diffSplice('a👍b', 'a👎b')
    expect(result.insertedText).toBe('👎')
    expect(result.removed).toBe(2)
    expect(countGraphemes(result.insertedText)).toBe(1)
    // A split pair would leave a lone surrogate behind.
    expect(result.insertedText.codePointAt(0)).toBeGreaterThan(0xffff)
  })

  it('counts graphemes of the inserted text', () => {
    expect(diffSplice('', '👨‍👩‍👧‍👦').graphemes).toBe(1)
  })

  it('reports repeated characters as a minimal range', () => {
    // 'aa' -> 'aaa' is ambiguous; any single-character insert is correct.
    const result = diffSplice('aa', 'aaa')
    expect(result.removed).toBe(0)
    expect(result.inserted).toBe(1)
  })
})
