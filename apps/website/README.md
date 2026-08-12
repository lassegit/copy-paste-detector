# @cpd/website

Live playground and documentation, built with [rshono](https://www.rshono.com) — Hono + Rspack + React
Server Components.

```bash
pnpm --filter @cpd/website dev      # http://localhost:3000
pnpm --filter @cpd/website build
pnpm --filter @cpd/website start
```

The workspace packages must be built first (`pnpm build` from the root); the app consumes their `dist`
output, not their source.

## What the page shows

- **A field you can type and paste into**, with a live breakdown of what the text is made of.
- **Provenance highlighting** via `<ProvenanceHighlight>` — the pasted parts are visibly pasted, and
  they stop being pasted when you rewrite them.
- **The full verdict**: every signal with its weight and the sentence explaining it, withheld signals
  with their reason, and the caveats.
- **Server-side re-scoring**. `POST /api/verify` in `src/server.ts` takes the raw event log and
  replays it with `@cpd/core`, the same engine that ran in the browser. This is the whole argument
  for a headless core: the client's score is advisory, so the client posts its *log* and the server
  recomputes.

The demo sets `privacy: 'forensic'` so it can show your text back to you. **A real deployment should
not** — the default keeps no text at all.

## Structure

```
src/routes.ts              the route table, the one file rshono requires
src/server.ts              Hono middleware + POST /api/verify
src/components/home.tsx    server component: the page
src/components/playground.tsx   'use client': the interactive demo
rshono.config.ts           deploy target + the monorepo externals fix
```

## The monorepo externals fix

`rshono.config.ts` stops the server build from externalising `@cpd/*`.

A Node server build externalises bare specifiers by default — right for real dependencies, wrong for
workspace packages. Left external, `@cpd/react` is loaded by Node at runtime from `packages/react/dist`,
where it resolves its own copy of `react` rather than the one the RSC server bundle set up. Two React
instances means two internal dispatchers, and a hook called from the library half finds the half that
is not currently rendering:

```
TypeError: Cannot read properties of null (reading 'useRef')
```

Bundling them puts the library and the renderer on the same React.

Aliasing `react` itself also collapses the instances, but it defeats the `exports` conditions and the
server build then fails with *"the react-server condition must be enabled"*. This is a monorepo
concern only — an app installing these from npm gets one copy and needs none of it.
