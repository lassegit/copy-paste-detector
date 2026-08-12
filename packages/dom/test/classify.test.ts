import { describe, expect, it } from 'vitest'
import { classify, isDeletion } from '../src/classify.ts'

const BASE = { pendingPaste: false, pendingDrop: false, composing: false, graphemes: 1 } as const

describe('classify', () => {
  it('maps the clipboard input types', () => {
    expect(classify('insertFromPaste', BASE)).toBe('pasted')
    expect(classify('insertFromPasteAsQuotation', BASE)).toBe('pasted')
    expect(classify('insertFromYank', BASE)).toBe('pasted')
    expect(classify('insertFromDrop', BASE)).toBe('dropped')
  })

  it('keeps platform substitutions distinct from pastes', () => {
    // Autocorrect, spellcheck, autofill and text expanders all land here.
    // Calling them pastes would penalise assistive tooling.
    expect(classify('insertReplacementText', BASE)).toBe('replaced')
  })

  it('maps ordinary authoring', () => {
    expect(classify('insertText', BASE)).toBe('typed')
    expect(classify('insertLineBreak', BASE)).toBe('typed')
    expect(classify('insertParagraph', BASE)).toBe('typed')
    expect(classify('insertCompositionText', BASE)).toBe('composed')
  })

  it('refuses to vouch for undo and redo', () => {
    expect(classify('historyUndo', BASE)).toBe('unknown')
    expect(classify('historyRedo', BASE)).toBe('unknown')
  })

  it('lets a clipboard event override a mislabelled input type', () => {
    // Several mobile browsers have reported `insertText` for a paste.
    expect(classify('insertText', { ...BASE, pendingPaste: true, graphemes: 200 })).toBe('pasted')
    expect(classify('insertText', { ...BASE, pendingDrop: true, graphemes: 200 })).toBe('dropped')
  })

  it('lets the host application declare an origin it alone can know', () => {
    // There is no input type for speech-to-text.
    expect(classify('insertText', { ...BASE, hinted: 'dictated', graphemes: 300 })).toBe('dictated')
  })

  it('falls back to composition state when no input type is given', () => {
    expect(classify(undefined, { ...BASE, composing: true, graphemes: 3 })).toBe('composed')
  })

  it('guesses conservatively without an input type', () => {
    expect(classify(undefined, { ...BASE, graphemes: 1 })).toBe('typed')
    // A block of text with no provenance information is not assumed innocent
    // or guilty — `unknown` counts towards neither ratio.
    expect(classify(undefined, { ...BASE, graphemes: 400 })).toBe('unknown')
  })

  it('recognises deletions', () => {
    expect(isDeletion('deleteContentBackward')).toBe(true)
    expect(isDeletion('deleteByCut')).toBe(true)
    expect(isDeletion('insertText')).toBe(false)
    expect(isDeletion(undefined)).toBe(false)
  })
})
