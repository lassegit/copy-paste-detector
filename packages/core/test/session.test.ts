import { describe, expect, it } from 'vitest'
import { ProvenanceSession, replay } from '../src/session.ts'
import type { SignalCode } from '../src/types.ts'
import { Keyboard, text } from './keyboard.ts'

function codes(signals: readonly { code: SignalCode; weight: number }[]): SignalCode[] {
  return signals.filter((signal) => signal.weight > 0).map((signal) => signal.code)
}

describe('a person writing normally', () => {
  it('is not flagged', () => {
    const session = new ProvenanceSession()
    new Keyboard(session).type(text(400)).backspace(30).type(text(40))

    const report = session.report()
    expect(report.state).toBe('clean')
    expect(report.score).toBe(0)
    expect(report.composition.authoredRatio).toBe(1)
    expect(report.composition.pastedRatio).toBe(0)
    expect(report.timing.peakWpm).toBeLessThan(220)
    expect(report.timing.ikiCv).toBeGreaterThan(0.2)
    expect(report.timing.correctionRatio).toBeGreaterThan(0.01)
  })

  it('is not flagged for pasting a URL into their own writing', () => {
    const session = new ProvenanceSession()
    new Keyboard(session)
      .type(text(500))
      .backspace(20)
      .type(text(20))
      .paste('https://example.com/docs/v2')
      .type(text(80))

    const report = session.report()
    // The paste is visible, but nothing about it is alarming.
    expect(report.state).toBe('pasted')
    expect(report.score).toBe(0)
    expect(report.composition.pastedRatio).toBeLessThan(0.05)
  })
})

describe('wholesale pasting', () => {
  it('is surfaced for review, not condemned outright', () => {
    const session = new ProvenanceSession()
    new Keyboard(session).paste(text(900))

    const report = session.report()
    expect(report.composition.pastedRatio).toBe(1)
    expect(codes(report.signals)).toEqual(expect.arrayContaining(['paste.ratio', 'paste.large']))
    // Someone may legitimately have drafted in another editor. 'review' is the
    // honest answer; it takes corroborating evidence to reach 'suspicious'.
    expect(report.state).toBe('review')
  })

  it('reaches "suspicious" when the text arrives straight after a trip away', () => {
    const session = new ProvenanceSession()
    const keyboard = new Keyboard(session)

    keyboard.type(text(100)).blur().hide().wait(11_000).show().focus().wait(500).paste(text(900))

    const report = session.report()
    expect(report.paste.afterAwayCount).toBe(1)
    expect(report.attention.msAwayBeforeLargestImport).toBeGreaterThanOrEqual(11_000)
    expect(codes(report.signals)).toContain('paste.after-away')
    expect(report.state).toBe('suspicious')
  })

  it('halves the pasted ratio when the user rewrites half of it', () => {
    const session = new ProvenanceSession()
    const keyboard = new Keyboard(session)

    keyboard.paste(text(100))
    keyboard.backspace(50)
    keyboard.type(text(50))

    const report = session.report()
    expect(report.length).toBe(100)
    expect(report.composition.pastedRatio).toBe(0.5)
    // The paste still happened, and the history still records it.
    expect(report.paste.largestChars).toBe(100)
  })

  it('drops the ratio to zero when the pasted text is deleted entirely', () => {
    const session = new ProvenanceSession()
    const keyboard = new Keyboard(session)

    keyboard.type(text(200)).paste(text(300)).backspace(300)

    const report = session.report()
    expect(report.composition.pastedRatio).toBe(0)
    expect(report.state).toBe('clean')
    expect(report.paste.count).toBe(1)
  })
})

describe('automated input', () => {
  it('is flagged on speed and rhythm together', () => {
    const session = new ProvenanceSession()
    new Keyboard(session).typeSteady(text(600), 10)

    const report = session.report()
    expect(report.timing.peakWpm).toBeGreaterThan(1000)
    expect(report.timing.ikiCv).toBe(0)
    expect(codes(report.signals)).toEqual(
      expect.arrayContaining(['typing.impossible-speed', 'typing.robotic', 'typing.no-corrections']),
    )
    expect(report.state).toBe('suspicious')
  })

  it('is flagged when script writes the value directly', () => {
    const session = new ProvenanceSession()
    session.reconcile(500, 10, 'programmatic')

    const report = session.report()
    expect(codes(report.signals)).toContain('input.programmatic')
    expect(report.composition.importedRatio).toBe(1)
  })

  it('is flagged when events are synthesised', () => {
    const session = new ProvenanceSession()
    session.dispatch({
      kind: 'edit',
      t: 5,
      start: 0,
      removed: 0,
      inserted: 200,
      origin: 'typed',
      trusted: false,
    })

    expect(codes(session.report().signals)).toContain('input.untrusted')
  })
})

describe('input methods that are not a Latin keyboard', () => {
  it('withholds every timing signal from an IME user', () => {
    const session = new ProvenanceSession()
    const keyboard = new Keyboard(session)
    // Fast, chunked, perfectly regular — the exact shape the timing signals hunt for.
    for (let i = 0; i < 120; i++) keyboard.compose('日本語', 30)

    const report = session.report()
    expect(report.caveats).toContain('ime-composition')
    expect(report.score).toBe(0)
    expect(report.state).toBe('clean')
    for (const signal of report.signals) {
      expect(signal.weight).toBe(0)
      expect(signal.suppressedBy).toBeDefined()
    }
  })

  it('withholds timing signals from a swipe keyboard', () => {
    const session = new ProvenanceSession()
    const keyboard = new Keyboard(session)
    for (let i = 0; i < 80; i++) keyboard.swipe('quarterly', 40)

    const report = session.report()
    expect(report.caveats).toContain('wordwise-input')
    expect(codes(report.signals)).not.toContain('typing.impossible-speed')
  })

  it('treats dictation as authored text, not as an import', () => {
    const session = new ProvenanceSession()
    new Keyboard(session).dictate(text(600))

    const report = session.report()
    expect(report.composition.authoredRatio).toBe(1)
    expect(report.composition.pastedRatio).toBe(0)
    expect(report.caveats).toContain('dictation')
    expect(report.state).toBe('clean')
  })

  it('withholds timing signals entirely in accessibility mode', () => {
    const session = new ProvenanceSession({ accessibilityMode: true })
    new Keyboard(session).typeSteady(text(600), 10)

    const report = session.report()
    expect(report.caveats).toContain('accessibility-mode')
    expect(report.score).toBe(0)
  })
})

describe('privacy', () => {
  it('keeps no text in the log by default', () => {
    const session = new ProvenanceSession()
    new Keyboard(session).type('hunter2 is my password').paste('4111 1111 1111 1111')

    for (const event of session.events) {
      expect(event).not.toHaveProperty('text')
    }
    expect(session.report().caveats).toContain('redacted')
  })

  it('retains text only in forensic mode', () => {
    const session = new ProvenanceSession({ privacy: 'forensic' })
    new Keyboard(session).paste('the quick brown fox')

    const edits = session.events.filter((event) => event.kind === 'edit')
    expect(edits.at(-1)).toHaveProperty('text', 'the quick brown fox')
    expect(session.report().caveats).not.toContain('redacted')
  })

  it('coarsens timestamps according to the privacy mode', () => {
    const strict = new ProvenanceSession({ privacy: 'strict' })
    strict.dispatch({ kind: 'edit', t: 1234, start: 0, removed: 0, inserted: 1, origin: 'typed' })
    expect(strict.events[0]?.t).toBe(1250)

    const balanced = new ProvenanceSession({ privacy: 'balanced' })
    balanced.dispatch({ kind: 'edit', t: 1234, start: 0, removed: 0, inserted: 1, origin: 'typed' })
    expect(balanced.events[0]?.t).toBe(1230)
  })

  it('can be told not to retain a log at all', () => {
    const session = new ProvenanceSession({ keepLog: false })
    const keyboard = new Keyboard(session)
    keyboard.type(text(50)).blur().wait(100).focus()

    expect(session.events).toHaveLength(0)
    // Statistics still work; only the replayable log is gone.
    expect(session.report().attention.blurCount).toBe(1)
  })
})

describe('server-side replay', () => {
  it('reproduces the client report exactly', () => {
    const session = new ProvenanceSession()
    const keyboard = new Keyboard(session)
    keyboard.type(text(120)).blur().wait(9_000).focus().wait(400).paste(text(700)).type(text(60))

    const submitted = JSON.parse(JSON.stringify(session.events))
    const recomputed = replay(submitted)

    expect(recomputed).toEqual(session.report())
  })

  it('is unaffected by a client that lies about its score', () => {
    const session = new ProvenanceSession()
    new Keyboard(session).paste(text(900))

    const forged = { ...session.report(), score: 0, state: 'clean' as const }
    expect(forged.score).toBe(0)
    // The log still tells the truth, because the log is the evidence.
    expect(replay(session.events).score).toBeGreaterThan(50)
  })
})

describe('the ledger under stress', () => {
  it('survives an unexplained value change and says so', () => {
    const session = new ProvenanceSession()
    new Keyboard(session).type(text(100))

    session.reconcile(400, 5_000)

    const report = session.report()
    expect(report.caveats).toContain('ledger-desynced')
    expect(report.length).toBe(400)
  })

  it('counts graphemes, not code units, when judging speed', () => {
    const session = new ProvenanceSession()
    const keyboard = new Keyboard(session)
    // Ten emoji are twenty code units. Treating them as twenty characters would
    // double this user's apparent typing speed.
    keyboard.type('👍👍👍👍👍👍👍👍👍👍', 200)

    const report = session.report()
    expect(report.length).toBe(20)
    expect(report.timing.insertedChars).toBe(10)
  })
})
