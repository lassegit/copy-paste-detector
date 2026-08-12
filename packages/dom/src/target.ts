/** Anything this package can watch. */
export type ProvenanceTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement

/** `<input>` types that hold free text worth tracking. */
const TEXTUAL_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'number',
  'password',
])

export interface TargetAdapter {
  /** Current text content of the field. */
  read(): string
  readonly kind: 'input' | 'textarea' | 'contenteditable'
  /** True for password fields, which are never allowed to retain their text. */
  readonly sensitive: boolean
}

export function isTextField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLInputElement) return TEXTUAL_INPUT_TYPES.has(element.type)
  return element instanceof HTMLElement && element.isContentEditable
}

/** True for fields `observe()` refuses to bind automatically. */
export function isSensitiveField(element: Element): boolean {
  return element instanceof HTMLInputElement && element.type === 'password'
}

export function createAdapter(element: ProvenanceTarget): TargetAdapter {
  if (element instanceof HTMLTextAreaElement) {
    return { kind: 'textarea', sensitive: false, read: () => element.value }
  }
  if (element instanceof HTMLInputElement) {
    return {
      kind: 'input',
      sensitive: element.type === 'password',
      read: () => element.value,
    }
  }
  return {
    kind: 'contenteditable',
    sensitive: false,
    // `textContent` rather than `innerHTML`: provenance is about the text a
    // reader will see, and offsets stay comparable to a plain-text field.
    read: () => element.textContent ?? '',
  }
}

/** The form this field would submit with, if any. */
export function findForm(element: ProvenanceTarget): HTMLFormElement | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.form
  }
  return element.closest('form')
}
