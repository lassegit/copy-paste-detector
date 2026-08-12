'use client'

import { ProvenanceHighlight, useProvenance, type Report } from '@cpd/react'
import { useCallback, useState } from 'react'

interface VerifiedResult {
  readonly state: string
  readonly score: number
  readonly eventCount: number
}

const ORIGIN_LABELS: Record<string, string> = {
  typed: 'typed',
  composed: 'composed (IME)',
  dictated: 'dictated',
  pasted: 'pasted',
  dropped: 'dropped',
  replaced: 'autocorrected',
  programmatic: 'written by script',
  initial: 'pre-filled',
  unknown: 'unaccounted for',
}

export function Playground(): React.ReactElement {
  const [value, setValue] = useState('')
  const [verified, setVerified] = useState<VerifiedResult | null>(null)
  const [verifying, setVerifying] = useState(false)

  const { ref, report, ranges, getEvents, hintNextInsert, reset } = useProvenance<HTMLTextAreaElement>({
    updateDebounceMs: 120,
    // The demo needs to show the text back to you, so it has to keep it. A real
    // deployment should leave this at the default, where no text is retained.
    privacy: 'forensic',
    hiddenInput: false,
  })

  const verify = useCallback(async () => {
    setVerifying(true)
    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: getEvents() }),
      })
      setVerified(response.ok ? ((await response.json()) as VerifiedResult) : null)
    } catch {
      setVerified(null)
    } finally {
      setVerifying(false)
    }
  }, [getEvents])

  const clear = useCallback(() => {
    setValue('')
    setVerified(null)
    reset()
  }, [reset])

  return (
    <section className="playground">
      <div className="playground-grid">
        <div className="pane">
          <div className="pane-head">
            <h3>Write something</h3>
            <div className="pane-actions">
              <button type="button" onClick={() => hintNextInsert('dictated')}>
                Next insert is dictation
              </button>
              <button type="button" onClick={clear}>
                Clear
              </button>
            </div>
          </div>
          <textarea
            ref={ref}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            aria-label="Try typing and pasting here"
            placeholder="Type a sentence. Then paste one in from somewhere else and watch the breakdown change."
          />
          <p className="hint">
            Try it three ways: type normally, paste a block in, then delete the pasted part again. The
            breakdown follows the text as it stands, not the history of what happened to it.
          </p>
        </div>

        <div className="pane">
          <div className="pane-head">
            <h3>What it&rsquo;s made of</h3>
          </div>
          <ProvenanceHighlight
            className="highlight"
            value={value}
            ranges={ranges}
            placeholder="Nothing yet."
          />
          <Legend ranges={ranges} />
        </div>
      </div>

      <Verdict report={report} />

      <div className="verify">
        <div>
          <h3>Verify it on the server</h3>
          <p>
            The score above came from the browser, so a determined user could edit it before posting.
            This sends the raw <strong>event log</strong> to <code>/api/verify</code>, where the same
            engine recomputes the verdict from scratch.
          </p>
        </div>
        <div className="verify-action">
          <button type="button" onClick={verify} disabled={verifying || value.length === 0}>
            {verifying ? 'Verifying…' : 'Recompute on the server'}
          </button>
          {verified !== null && (
            <p className="verify-result">
              Server replayed <strong>{verified.eventCount}</strong> events →{' '}
              <span className={`badge badge-${verified.state}`}>{verified.state}</span> at{' '}
              <strong>{Math.round(verified.score)}</strong>
              {report !== null && Math.round(verified.score) === Math.round(report.score)
                ? ' — identical to the client.'
                : ' — this differs from the client, which is itself worth knowing.'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function Legend({ ranges }: { ranges: readonly { origin: string; start: number; end: number }[] }): React.ReactElement | null {
  const totals = new Map<string, number>()
  for (const range of ranges) {
    totals.set(range.origin, (totals.get(range.origin) ?? 0) + (range.end - range.start))
  }
  if (totals.size === 0) return null

  const total = [...totals.values()].reduce((sum, n) => sum + n, 0)
  return (
    <ul className="legend">
      {[...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([origin, count]) => (
          <li key={origin}>
            <span className="swatch" data-origin={origin} />
            {ORIGIN_LABELS[origin] ?? origin}
            <span className="legend-count">
              {count} char{count === 1 ? '' : 's'} · {Math.round((count / total) * 100)}%
            </span>
          </li>
        ))}
    </ul>
  )
}

function Verdict({ report }: { report: Report | null }): React.ReactElement {
  if (report === null || report.length === 0) {
    return (
      <div className="verdict verdict-empty">
        <p>The verdict appears once there is something to judge.</p>
      </div>
    )
  }

  return (
    <div className="verdict">
      <div className="verdict-head">
        <span className={`badge badge-${report.state}`}>{report.state}</span>
        <div className="score">
          <div className="score-bar">
            <div className="score-fill" style={{ width: `${Math.min(100, report.score)}%` }} />
          </div>
          <span className="score-value">{Math.round(report.score)}/100</span>
        </div>
      </div>

      {report.signals.length === 0 ? (
        <p className="verdict-none">No signals fired.</p>
      ) : (
        <ul className="signals">
          {report.signals.map((signal) => (
            <li key={signal.code} className={signal.suppressedBy ? 'signal suppressed' : 'signal'}>
              <span className="signal-weight">{signal.suppressedBy ? '—' : `+${Math.round(signal.weight)}`}</span>
              <span className="signal-body">
                <code>{signal.code}</code>
                <span className="signal-detail">{signal.detail}</span>
                {signal.suppressedBy && (
                  <em className="signal-suppressed">Withheld: {signal.suppressedBy.replace(/-/g, ' ')}</em>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.caveats.length > 0 && (
        <p className="caveats">
          <strong>Caveats:</strong> {report.caveats.map((caveat) => caveat.replace(/-/g, ' ')).join(' · ')}
        </p>
      )}

      <dl className="stats">
        <Stat label="Characters" value={String(report.length)} />
        <Stat label="Pasted" value={`${Math.round(report.composition.pastedRatio * 100)}%`} />
        <Stat
          label="Peak speed"
          value={report.timing.peakWpm === null ? '—' : `${Math.round(report.timing.peakWpm)} wpm`}
        />
        <Stat label="Corrections" value={`${Math.round(report.timing.correctionRatio * 100)}%`} />
        <Stat label="Keystrokes" value={String(report.timing.keystrokes)} />
        <Stat label="Time away" value={`${(report.attention.awayMs / 1000).toFixed(1)}s`} />
      </dl>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
