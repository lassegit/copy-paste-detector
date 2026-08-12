/**
 * Minimal synthetic input helpers.
 *
 * Deliberately duplicated from `@cpd/dom`'s suite rather than shared: test
 * helpers are not part of either package's contract, and importing across
 * package test boundaries makes the dependency graph lie.
 *
 * `beforeinput` fires before the value changes and `input` after, which is the
 * ordering the detector relies on to tell a user's edit apart from something
 * that rewrote the field behind its back.
 */

function edit(
  element: HTMLTextAreaElement,
  inputType: string,
  mutate: () => void,
  data: string | null = null,
): void {
  element.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }))
  mutate()
  element.dispatchEvent(new InputEvent('input', { inputType, data, bubbles: true }))
}

export function type(element: HTMLTextAreaElement, text: string): void {
  for (const char of text) {
    edit(
      element,
      'insertText',
      () => {
        element.value += char
      },
      char,
    )
  }
}

export function paste(element: HTMLTextAreaElement, text: string): void {
  element.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))
  edit(
    element,
    'insertFromPaste',
    () => {
      element.value += text
    },
    text,
  )
}

const SAMPLE = 'Reviewing the quarterly figures took longer than anyone expected this time around. '

export function text(length: number): string {
  let out = ''
  while (out.length < length) out += SAMPLE
  return out.slice(0, length)
}
