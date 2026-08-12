import { describe, expect, it } from 'vitest'
import { ProvenanceLedger } from '../src/ledger.ts'
import { AUTHORED_ORIGINS, IMPORTED_ORIGINS, type Origin } from '../src/types.ts'

const PASTED: ReadonlySet<Origin> = new Set<Origin>(['pasted'])

function insert(ledger: ProvenanceLedger, start: number, length: number, origin: Origin, at = 0): void {
  ledger.splice({ start, removed: 0, inserted: length, origin, at })
}

describe('ProvenanceLedger', () => {
  it('starts empty', () => {
    const ledger = new ProvenanceLedger()
    expect(ledger.length).toBe(0)
    expect(ledger.runs).toEqual([])
    expect(ledger.ratioOf(PASTED)).toBe(0)
  })

  it('attributes pre-existing content to `initial`', () => {
    const ledger = new ProvenanceLedger(10)
    expect(ledger.length).toBe(10)
    expect(ledger.runs[0]?.origin).toBe('initial')
  })

  it('coalesces neighbouring runs of the same origin', () => {
    const ledger = new ProvenanceLedger()
    for (let i = 0; i < 5; i++) insert(ledger, i, 1, 'typed', i * 100)
    expect(ledger.runs).toHaveLength(1)
    expect(ledger.runs[0]).toEqual({ origin: 'typed', length: 5, at: 0 })
  })

  it('splits a run when text of another origin lands inside it', () => {
    const ledger = new ProvenanceLedger()
    insert(ledger, 0, 10, 'typed')
    insert(ledger, 4, 6, 'pasted', 500)

    expect(ledger.length).toBe(16)
    expect(ledger.runs).toEqual([
      { origin: 'typed', length: 4, at: 0 },
      { origin: 'pasted', length: 6, at: 500 },
      { origin: 'typed', length: 6, at: 0 },
    ])
  })

  it('removes text across run boundaries', () => {
    const ledger = new ProvenanceLedger()
    insert(ledger, 0, 5, 'typed')
    insert(ledger, 5, 5, 'pasted')
    insert(ledger, 10, 5, 'typed')

    // Removes the tail of the first run, all of the paste, and the head of the last.
    ledger.splice({ start: 3, removed: 9, inserted: 0, origin: 'typed', at: 0 })

    expect(ledger.length).toBe(6)
    expect(ledger.runs).toEqual([{ origin: 'typed', length: 6, at: 0 }])
    expect(ledger.ratioOf(PASTED)).toBe(0)
  })

  it('reattributes pasted text that the user rewrites', () => {
    const ledger = new ProvenanceLedger()
    insert(ledger, 0, 100, 'pasted')
    expect(ledger.ratioOf(PASTED)).toBe(1)

    // The user selects the first half and types over it.
    ledger.splice({ start: 0, removed: 50, inserted: 0, origin: 'typed', at: 10 })
    for (let i = 0; i < 50; i++) insert(ledger, i, 1, 'typed', 20 + i)

    expect(ledger.length).toBe(100)
    expect(ledger.ratioOf(PASTED)).toBe(0.5)
    expect(ledger.ratioOf(AUTHORED_ORIGINS)).toBe(0.5)
  })

  it('reports the largest surviving imported run, not the largest ever pasted', () => {
    const ledger = new ProvenanceLedger()
    insert(ledger, 0, 200, 'pasted')
    ledger.splice({ start: 20, removed: 160, inserted: 0, origin: 'typed', at: 0 })

    expect(ledger.largestRun(IMPORTED_ORIGINS)).toBe(40)
  })

  it('clamps out-of-range splices and flags itself desynced', () => {
    const ledger = new ProvenanceLedger()
    insert(ledger, 0, 10, 'typed')
    expect(ledger.desynced).toBe(false)

    ledger.splice({ start: 50, removed: 5, inserted: 3, origin: 'pasted', at: 0 })

    expect(ledger.desynced).toBe(true)
    expect(ledger.length).toBe(13)
  })

  it('reconciles to a known length when something changed the value silently', () => {
    const ledger = new ProvenanceLedger()
    insert(ledger, 0, 10, 'typed')

    ledger.reconcile(30, 100, 'programmatic')
    expect(ledger.length).toBe(30)
    expect(ledger.lengthOf(new Set<Origin>(['programmatic']))).toBe(20)
    // A known-programmatic write is explained, so it is not a desync.
    expect(ledger.desynced).toBe(false)

    ledger.reconcile(5, 200)
    expect(ledger.length).toBe(5)
    expect(ledger.desynced).toBe(true)
  })

  it('exposes absolute ranges for highlighting', () => {
    const ledger = new ProvenanceLedger()
    insert(ledger, 0, 3, 'typed')
    insert(ledger, 3, 4, 'pasted', 99)

    expect(ledger.ranges()).toEqual([
      { start: 0, end: 3, origin: 'typed', at: 0 },
      { start: 3, end: 7, origin: 'pasted', at: 99 },
    ])
  })
})
