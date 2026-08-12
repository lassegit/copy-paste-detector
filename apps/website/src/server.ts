import { replay, type ProvenanceEvent } from '@cpd/core'
import { onServerError, publicUrl } from '@rshono/core/server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { csrf } from 'hono/csrf'
import { trimTrailingSlash } from 'hono/trailing-slash'

const server = new Hono()

onServerError((error, { source, request }) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[error] ${source} ${new URL(request.url).pathname}: ${message}`)
})

server.use(bodyLimit({ maxSize: 1024 * 1024 }))
server.use(csrf({ origin: (origin, c) => origin === publicUrl(c).origin }))
server.use(trimTrailingSlash({ alwaysRedirect: true }))

/**
 * Re-score a submitted event log.
 *
 * This is the whole argument for shipping a headless core. The browser's score
 * is advisory — anyone can edit a number before posting it — so the client posts
 * its *log* instead and the server recomputes the verdict with the same code.
 * Forging that now means producing an internally consistent event stream with a
 * plausible distribution of inter-keystroke intervals, rather than flipping one
 * integer.
 *
 * It raises the cost of a forgery. It is not proof, and the page says so.
 */
server.post('/api/verify', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'expected a JSON body' }, 400)
  }

  const events = (body as { events?: unknown }).events
  if (!Array.isArray(events)) {
    return c.json({ error: 'expected { events: ProvenanceEvent[] }' }, 400)
  }

  const report = replay(events as ProvenanceEvent[])
  return c.json({
    state: report.state,
    score: report.score,
    length: report.length,
    pastedRatio: report.composition.pastedRatio,
    caveats: report.caveats,
    signals: report.signals.map((signal) => ({ code: signal.code, weight: signal.weight })),
    eventCount: events.length,
  })
})

export default server

export type AppType = typeof server
