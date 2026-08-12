# @cpd/dom

Binds [`@cpd/core`](../core) to real form fields — `<textarea>`, textual `<input>`, and
`contenteditable` hosts.

```ts
import { observe } from '@cpd/dom'

observe('textarea[data-cpd]')
```

Every matching field now carries its verdict as attributes:

```html
<textarea data-cpd-state="review" data-cpd-score="56" data-cpd-pasted="1.00"></textarea>
```

```css
textarea[data-cpd-state='review'] { border-color: orange }
textarea[data-cpd-state='suspicious'] { border-color: red }
```

## How it decides

Two sources of truth, used together — because each covers the other's blind spot.

**`InputEvent.inputType`** says what the user meant to do. It is specified by Input Events Level 2,
and the spec requires a `paste` event to precede any `insertFromPaste`. It is the best signal
available, but it is absent or wrong often enough to matter.

**A diff of the value** against the last known one says what actually happened. Anything that
changes a field without announcing itself — extensions, password managers, framework re-renders,
automation drivers — shows up here and nowhere else.

`beforeinput` fires before the value changes, which gives a checkpoint: if the value already differs
from what we last recorded, something rewrote it out of band. That delta is attributed to `unknown`
rather than `programmatic`, because a framework normalising a value on re-render looks exactly like
an automation driver from here, and calling the first one "written by script" would put points on
the board for ordinary React apps. Turn on `detectProgrammatic` when you need the stronger claim —
see the caveat on that option.

Clipboard and drop events outrank `inputType`, and vouch for exactly one insertion each. Several
mobile browsers have historically reported `insertText` for a paste.

## Options

```ts
new InputProvenanceDetector(element, {
  // …all @cpd/core SessionOptions: privacy, accessibilityMode, thresholds, weights

  reflect: { prefix: 'data-cpd', attributes: ['state', 'score', 'pasted'] },
  hiddenInput: { include: 'summary' },   // or 'log' / 'both'
  emitEvents: true,                      // cpd:paste, cpd:report, cpd:flag
  updateDebounceMs: 250,
  detectProgrammatic: false,
  allowSyntheticEvents: false,
  onReport(report, element) {},
})
```

### `hiddenInput`

Adds `<input type="hidden" name="_cpd_<fieldname>">` to the field's form, refreshed on submit. A
server that only ever sees the form post can read the verdict without any client integration.

`include: 'summary'` is small and constant-sized but a client can edit it before posting.
`include: 'log'` carries the raw event stream so the server can recompute with `replay()` — worth
far more, at roughly 40 bytes per keystroke. Payloads over `maxBytes` **drop the log and set
`truncated: true`** rather than posting a partial one, so a server never mistakes an incomplete log
for a verified one.

### `detectProgrammatic`

Intercepts the element's `value` setter to catch script writes as they happen. Off by default, and
deliberately: React installs its own instance-level `value` descriptor for change tracking, and
whichever library defines its property last wins. Without this, script writes are still caught at
the next checkpoint — just attributed to `unknown`.

### `allowSyntheticEvents`

`isTrusted` is worth watching, since form-filling spam scripts routinely set `value` and dispatch a
synthetic `input`. But it is blunt: browser automation driven through CDP (Playwright, Puppeteer,
Selenium) produces *trusted* events and sails past it, while testing libraries and component kits
that dispatch their own events get caught. Turn this on if your app legitimately synthesises input.

## Input the browser cannot describe

There is no `inputType` for speech-to-text. If your application provides its own dictation control,
say so — otherwise a dictated paragraph is indistinguishable from a paste and users who dictate get
penalised for it:

```ts
micButton.addEventListener('click', () => detector.hintNextInsert('dictated'))
```

## Password fields

`observe()` skips `input[type=password]` unless you pass `includeSensitive: true`. Watching what
people paste into a password box is how password managers get penalised and how credentials end up
in telemetry. Constructing a detector on one directly is allowed, but its text is never retained
regardless of the privacy mode requested.

## Testing

The suite here uses happy-dom to exercise the wiring: which listener fires, how the diff resolves,
what lands on the element. That is genuinely useful — it caught a bug where a `paste` event vouched
for more than one insertion — but it is **not** sufficient.

No DOM implementation outside a browser generates authentic `beforeinput` sequences for IME
composition, swipe keyboards, autocorrect or dictation, and those are exactly the cases where
getting it wrong means penalising someone for how they type. Real coverage needs Playwright against
Chromium, Firefox and WebKit, plus mobile emulation. That is not written yet.

## API

- `observe(target, options)` → `ObserverHandle` — bind every matching field, now and as they appear
- `InputProvenanceDetector` — watch one field; `.report()`, `.ranges()`, `.events`, `.sync()`,
  `.hintNextInsert()`, `.reset()`, `.destroy()`
- `classify(inputType, hints)` — the provenance decision, usable on its own
- `reflect` / `clearReflection` — attribute writing
- `buildPayload` / `syncHiddenInput` — form payload construction
- `isTextField` / `isSensitiveField` / `findForm`
