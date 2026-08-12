import type { ProvenanceSession } from '../src/session.ts'
import { countGraphemes } from '../src/text.ts'
import type { Origin } from '../src/types.ts'

/**
 * A deterministic input simulator.
 *
 * Real browsers are the only honest test of the DOM layer, but the core is
 * event-in / report-out, so the scenarios worth arguing about — a person
 * writing, a bot typing, an IME user, a swipe keyboard — can be expressed
 * exactly and reproducibly here.
 */
export class Keyboard {
  readonly #session: ProvenanceSession
  #t = 0
  #pos = 0
  #seed: number

  constructor(session: ProvenanceSession, seed = 42) {
    this.#session = session
    this.#seed = seed
  }

  get t(): number {
    return this.#t
  }

  get pos(): number {
    return this.#pos
  }

  #random(): number {
    this.#seed = (Math.imul(this.#seed, 1664525) + 1013904223) >>> 0
    return this.#seed / 0x1_0000_0000
  }

  /** Human typing: one grapheme at a time, with the burstiness real typists have. */
  type(text: string, meanIki = 160): this {
    for (const char of text) {
      this.#t += Math.max(1, Math.round(meanIki * (0.3 + 1.7 * this.#random())))
      this.#insert(char, 'typed', 1)
    }
    return this
  }

  /** Metronomic typing: what an automation driver produces. */
  typeSteady(text: string, iki = 10): this {
    for (const char of text) {
      this.#t += iki
      this.#insert(char, 'typed', 1)
    }
    return this
  }

  /** An IME composition session committing one word. */
  compose(text: string, thinkMs = 400): this {
    this.#session.dispatch({ kind: 'composition', t: this.#t, phase: 'start' })
    this.#t += thinkMs
    this.#insert(text, 'composed', countGraphemes(text))
    this.#session.dispatch({ kind: 'composition', t: this.#t, phase: 'end' })
    return this
  }

  /** A swipe/glide keyboard or predictive-text tap: a whole word arrives at once. */
  swipe(text: string, ms = 320): this {
    this.#t += ms
    this.#insert(text, 'typed', countGraphemes(text))
    return this
  }

  dictate(text: string, ms = 1200): this {
    this.#t += ms
    this.#insert(text, 'dictated', countGraphemes(text))
    return this
  }

  paste(text: string, thinkMs = 300): this {
    this.#t += thinkMs
    this.#insert(text, 'pasted', countGraphemes(text))
    return this
  }

  backspace(count: number, meanIki = 110): this {
    for (let i = 0; i < count && this.#pos > 0; i++) {
      this.#t += Math.max(1, Math.round(meanIki * (0.4 + 1.2 * this.#random())))
      this.#session.dispatch({
        kind: 'edit',
        t: this.#t,
        start: this.#pos - 1,
        removed: 1,
        inserted: 0,
        origin: 'typed',
      })
      this.#pos -= 1
    }
    return this
  }

  #insert(text: string, origin: Origin, graphemes: number): void {
    this.#session.dispatch({
      kind: 'edit',
      t: this.#t,
      start: this.#pos,
      removed: 0,
      inserted: text.length,
      graphemes,
      origin,
      text,
    })
    this.#pos += text.length
  }

  wait(ms: number): this {
    this.#t += ms
    return this
  }

  blur(): this {
    this.#session.dispatch({ kind: 'blur', t: this.#t })
    return this
  }

  focus(): this {
    this.#session.dispatch({ kind: 'focus', t: this.#t })
    return this
  }

  hide(): this {
    this.#session.dispatch({ kind: 'visibility', t: this.#t, visible: false })
    return this
  }

  show(): this {
    this.#session.dispatch({ kind: 'visibility', t: this.#t, visible: true })
    return this
  }
}

const SAMPLE =
  'The quick brown fox jumps over the lazy dog while the team reviews the quarterly numbers again. '

/** Deterministic filler text of exactly `length` characters. */
export function text(length: number): string {
  let out = ''
  while (out.length < length) out += SAMPLE
  return out.slice(0, length)
}
