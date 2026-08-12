/**
 * Synthetic DOM interaction helpers.
 *
 * These exercise the wiring — which listener fires, how the diff resolves, what
 * ends up on the element — by dispatching the event sequences a browser
 * produces. They are not a substitute for running the real thing: no DOM
 * implementation outside a browser generates authentic `beforeinput` sequences
 * for IME composition, swipe keyboards or autocorrect, which is exactly where
 * this package earns its keep. Those need Playwright against Chromium, Firefox
 * and WebKit.
 *
 * Event ordering matters and is easy to get wrong. `beforeinput` fires *before*
 * the value changes and `input` after, which is what lets the detector tell a
 * user's own edit apart from something that rewrote the field behind its back.
 */

export function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

export function field(html = '<form><textarea name="answer"></textarea></form>'): HTMLTextAreaElement {
  mount(html)
  const element = document.querySelector('textarea')
  if (element === null) throw new Error('no textarea in fixture')
  return element
}

/** beforeinput → mutate → input, in the order a user agent does it. */
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

/** Type text one character at a time, as a keyboard would. */
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

/** Paste at the caret: the `paste` event, then the insertion, exactly as the spec orders them. */
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

export function drop(element: HTMLTextAreaElement, text: string): void {
  element.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
  edit(
    element,
    'insertFromDrop',
    () => {
      element.value += text
    },
    text,
  )
}

/** Autocorrect or a spellcheck suggestion replacing the trailing word. */
export function autocorrect(element: HTMLTextAreaElement, from: string, to: string): void {
  edit(
    element,
    'insertReplacementText',
    () => {
      element.value = element.value.replace(new RegExp(`${from}$`), to)
    },
    to,
  )
}

/** An IME composition session committing `text`. */
export function compose(element: HTMLTextAreaElement, text: string): void {
  element.dispatchEvent(new Event('compositionstart', { bubbles: true }))
  edit(
    element,
    'insertCompositionText',
    () => {
      element.value += text
    },
    text,
  )
  element.dispatchEvent(new Event('compositionend', { bubbles: true }))
}

export function backspace(element: HTMLTextAreaElement, count: number): void {
  for (let i = 0; i < count && element.value.length > 0; i++) {
    edit(element, 'deleteContentBackward', () => {
      element.value = element.value.slice(0, -1)
    })
  }
}

/** Select a range and type over it. */
export function retype(element: HTMLTextAreaElement, start: number, end: number, text: string): void {
  const before = element.value.slice(0, start)
  const after = element.value.slice(end)

  edit(element, 'deleteContentBackward', () => {
    element.value = before + after
  })

  let written = ''
  for (const char of text) {
    written += char
    const next = before + written + after
    edit(
      element,
      'insertText',
      () => {
        element.value = next
      },
      char,
    )
  }
}

const SAMPLE = 'Reviewing the quarterly figures took longer than anyone expected this time around. '

export function text(length: number): string {
  let out = ''
  while (out.length < length) out += SAMPLE
  return out.slice(0, length)
}
