import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputProvenanceDetector } from '../src/detector.ts'
import { autocorrect, backspace, compose, drop, field, paste, retype, text, type } from './dom.ts'

const OPTIONS = { allowSyntheticEvents: true, updateDebounceMs: 0 } as const

let detectors: InputProvenanceDetector[] = []

function watch(element: HTMLTextAreaElement, options = {}): InputProvenanceDetector {
  const detector = new InputProvenanceDetector(element, { ...OPTIONS, ...options })
  detectors.push(detector)
  return detector
}

afterEach(() => {
  for (const detector of detectors) detector.destroy()
  detectors = []
})

describe('provenance', () => {
  it('attributes typing to the person typing', () => {
    const element = field()
    const detector = watch(element)
    type(element, text(120))

    const report = detector.report()
    expect(report.length).toBe(120)
    expect(report.composition.authoredRatio).toBe(1)
    expect(report.state).toBe('clean')
  })

  it('attributes a paste to the clipboard', () => {
    const element = field()
    const detector = watch(element)
    paste(element, text(500))

    const report = detector.report()
    expect(report.composition.pastedRatio).toBe(1)
    expect(report.paste.count).toBe(1)
    expect(report.paste.largestChars).toBe(500)
  })

  it('attributes a drop separately from a paste', () => {
    const element = field()
    const detector = watch(element)
    drop(element, text(300))

    const report = detector.report()
    expect(report.runs[0]?.origin).toBe('dropped')
    expect(report.composition.importedRatio).toBe(1)
  })

  it('does not treat autocorrect as an import', () => {
    const element = field()
    const detector = watch(element)
    type(element, 'this is teh ')
    autocorrect(element, 'teh ', 'the ')

    const report = detector.report()
    expect(report.composition.importedRatio).toBe(0)
    expect(report.runs.some((run) => run.origin === 'replaced')).toBe(true)
  })

  it('reattributes pasted text the user rewrites', () => {
    const element = field()
    const detector = watch(element)
    paste(element, text(100))
    retype(element, 0, 50, text(50))

    const report = detector.report()
    expect(report.length).toBe(100)
    expect(report.composition.pastedRatio).toBe(0.5)
  })

  it('forgets a paste that was deleted again', () => {
    const element = field()
    const detector = watch(element)
    type(element, text(60))
    paste(element, text(100))
    backspace(element, 100)

    const report = detector.report()
    expect(report.composition.pastedRatio).toBe(0)
    expect(report.state).toBe('clean')
    // The event still happened, and the history still says so.
    expect(report.paste.count).toBe(1)
  })

  it('records an IME composition as authored, and caveats the timing', () => {
    const element = field()
    const detector = watch(element)
    for (let i = 0; i < 10; i++) compose(element, '日本語')

    const report = detector.report()
    expect(report.composition.authoredRatio).toBe(1)
    expect(report.caveats).toContain('ime-composition')
  })

  it('accepts an application hint for input the browser cannot describe', () => {
    const element = field()
    const detector = watch(element)

    detector.hintNextInsert('dictated')
    paste(element, text(400)) // as far as the DOM is concerned, this is a paste

    const report = detector.report()
    expect(report.composition.pastedRatio).toBe(0)
    expect(report.composition.authoredRatio).toBe(1)
    expect(report.caveats).toContain('dictation')
  })
})

describe('changes nothing announced', () => {
  it('notices a silent value change at the next checkpoint', () => {
    const element = field()
    const detector = watch(element)
    type(element, text(40))

    // A framework re-render, an extension, an automation driver.
    element.value = `${element.value}${text(200)}`
    detector.sync()

    const report = detector.report()
    expect(report.length).toBe(240)
    // We do not know what did it, so we do not claim to — but we do say that
    // part of the text is unaccounted for.
    expect(report.caveats).toContain('unattributed-content')
    expect(report.runs.some((run) => run.origin === 'unknown')).toBe(true)
    expect(report.composition.importedRatio).toBe(0)
  })

  it('names it as programmatic when the value setter is intercepted', () => {
    const element = field()
    const detector = watch(element, { detectProgrammatic: true })
    type(element, text(40))

    element.value = `${element.value}${text(200)}`

    const report = detector.report()
    expect(report.runs.some((run) => run.origin === 'programmatic')).toBe(true)
    expect(report.signals.map((signal) => signal.code)).toContain('input.programmatic')
  })

  it('flags synthetic events when not told to allow them', () => {
    const element = field()
    const detector = new InputProvenanceDetector(element, { updateDebounceMs: 0 })
    detectors.push(detector)
    type(element, text(30))

    expect(detector.report().signals.map((signal) => signal.code)).toContain('input.untrusted')
  })
})

describe('reflection', () => {
  it('writes the verdict onto the element', () => {
    const element = field()
    const detector = watch(element)
    paste(element, text(900))
    detector.sync()

    expect(element.getAttribute('data-cpd-state')).toBe('review')
    expect(Number(element.getAttribute('data-cpd-score'))).toBeGreaterThan(50)
    expect(element.getAttribute('data-cpd-pasted')).toBe('1.00')
  })

  it('honours a custom prefix and attribute set', () => {
    const element = field()
    const detector = watch(element, { reflect: { prefix: 'data-prov', attributes: ['state'] } })
    paste(element, text(900))
    detector.sync()

    expect(element.getAttribute('data-prov-state')).toBe('review')
    expect(element.hasAttribute('data-prov-score')).toBe(false)
  })

  it('removes its attributes when destroyed', () => {
    const element = field()
    const detector = watch(element)
    paste(element, text(900))
    detector.sync()
    detector.destroy()

    expect(element.hasAttribute('data-cpd-state')).toBe(false)
    // And stops listening.
    type(element, 'more text')
    expect(element.hasAttribute('data-cpd-state')).toBe(false)
  })

  it('can be turned off entirely', () => {
    const element = field()
    const detector = watch(element, { reflect: false })
    paste(element, text(900))
    detector.sync()

    expect(element.hasAttribute('data-cpd-state')).toBe(false)
  })
})

describe('form integration', () => {
  it('carries a summary in a hidden field', () => {
    const element = field()
    const detector = watch(element, { hiddenInput: true })
    paste(element, text(900))
    detector.sync()

    const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"][name="_cpd_answer"]')
    expect(hidden).not.toBeNull()

    const payload = JSON.parse(hidden?.value ?? '{}')
    expect(payload.v).toBe(1)
    expect(payload.summary.state).toBe('review')
    expect(payload.summary.composition.pastedRatio).toBe(1)
    expect(payload.log).toBeUndefined()
  })

  it('can carry the replayable log instead', () => {
    const element = field()
    const detector = watch(element, { hiddenInput: { include: 'both' } })
    type(element, text(50))
    detector.sync()

    const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"]')
    const payload = JSON.parse(hidden?.value ?? '{}')
    expect(Array.isArray(payload.log)).toBe(true)
    expect(payload.log.length).toBeGreaterThan(0)
  })

  it('drops the log rather than truncating it past the size limit', () => {
    const element = field()
    const detector = watch(element, { hiddenInput: { include: 'both', maxBytes: 200 } })
    type(element, text(80))
    detector.sync()

    const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"]')
    const payload = JSON.parse(hidden?.value ?? '{}')
    expect(payload.truncated).toBe(true)
    expect(payload.log).toBeUndefined()
  })

  it('refreshes the hidden field at the moment of submit', () => {
    const element = field()
    watch(element, { hiddenInput: true, updateDebounceMs: 10_000 })
    paste(element, text(900))

    const form = document.querySelector('form')
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"]')
    const payload = JSON.parse(hidden?.value ?? '{}')
    expect(payload.summary.composition.pastedRatio).toBe(1)
  })

  it('reuses one hidden field rather than accumulating them', () => {
    const element = field()
    const detector = watch(element, { hiddenInput: true })
    type(element, text(30))
    detector.sync()
    paste(element, text(200))
    detector.sync()

    expect(document.querySelectorAll('input[type="hidden"]')).toHaveLength(1)
  })
})

describe('custom events', () => {
  it('announces pastes and escalations', () => {
    const element = field()
    const onPaste = vi.fn()
    const onFlag = vi.fn()
    element.addEventListener('cpd:paste', onPaste)
    element.addEventListener('cpd:flag', onFlag)

    const detector = watch(element)
    paste(element, text(900))
    detector.sync()

    expect(onPaste).toHaveBeenCalledTimes(1)
    expect(onFlag).toHaveBeenCalledTimes(1)
    expect(onFlag.mock.calls[0]?.[0].detail.report.state).toBe('review')
  })

  it('calls onReport with each recomputed verdict', () => {
    const element = field()
    const onReport = vi.fn()
    watch(element, { onReport })
    type(element, text(20))

    expect(onReport).toHaveBeenCalled()
  })
})
