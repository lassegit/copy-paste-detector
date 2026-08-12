# @cpd/react

React bindings for [`@cpd/dom`](../dom).

```tsx
'use client'
import { useProvenance } from '@cpd/react'

function Answer() {
  const { ref, report } = useProvenance<HTMLTextAreaElement>()

  return (
    <>
      <textarea ref={ref} name="answer" />
      {report?.state === 'review' && <p>Most of this came from the clipboard.</p>}
    </>
  )
}
```

## `useProvenance(options)`

Takes everything `@cpd/dom`'s `DetectorOptions` takes, and returns:

| | |
|---|---|
| `ref` | Attach to the field you want watched |
| `report` | Latest verdict, or `null` before mount |
| `ranges` | Character ranges by origin, for highlighting |
| `getEvents()` | Snapshot the replayable log — a function, not a value, so the tree does not re-render on every keystroke to carry it |
| `detector` | The underlying detector, `null` until mount |
| `hintNextInsert(origin)` | Declare the origin of the next insertion, e.g. from your own dictation button |
| `sync()` / `reset()` | |

The detector is created when the element mounts and destroyed when it unmounts, and **never recreated in between**. Options are read through a ref, so calling the hook the normal way — with a fresh object literal each render — does not throw away the session and everything it has recorded. There is a test for exactly that.

## `<ProvenanceHighlight>`

Renders the field's text split by provenance. Each segment carries `data-origin`, and styling is entirely yours:

```tsx
<ProvenanceHighlight value={value} ranges={ranges} />
```

```css
[data-origin='pasted'] { background: #e8a33d40 }
[data-origin='typed']  { background: #8fb99640 }
```

The library has no idea whether pasted text should be highlighted red, faintly shaded, or not at all, and that is a decision with real consequences for the person on the other end. Showing someone which parts of their own text were pasted is the least adversarial use of this data, and worth building first: it makes the measurement visible to the person being measured.

If the ranges do not sum to the text length, the component renders the text as one undifferentiated block rather than mis-attributing it.

## React Server Components

The package is a client module — it watches DOM events, so there is nothing here a server component could usefully render. `'use client'` is preserved in the built output, and a test asserts it stays there, because losing it would break RSC consumers silently rather than failing anything in this repo.

**In a monorepo**, a bundler that externalises workspace packages in its server build will load this one at runtime with its own copy of React, giving you two dispatchers and `Cannot read properties of null (reading 'useRef')` during SSR. See [`apps/website/rshono.config.ts`](../../apps/website/rshono.config.ts) for the fix. Apps consuming this from npm get one copy in their own `node_modules` and need none of it.

## Peer dependencies

`react >= 18`. React is never bundled.
