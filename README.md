# copy-paste-detector

Detect how text got into a field — pasted, dropped, dictated, typed, or written by script — and
surface it as a provenance breakdown rather than a yes/no flag.

```
typed:42 | pasted:880
```

Paste a hundred characters and rewrite half, and you get fifty typed and fifty pasted. Delete the
paste entirely and the pasted ratio returns to zero, because that is the honest answer.

## Packages

| Package                        | What it does                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`@cpd/core`](packages/core)   | Headless engine. Zero deps, no DOM, no I/O. Also runs server-side for verification.                      |
| [`@cpd/dom`](packages/dom)     | Binds the core to `<textarea>`, `<input>` and `contenteditable`; reflects state onto `data-` attributes. |
| [`@cpd/react`](packages/react) | `useProvenance()` hook and `<ProvenanceHighlight>`.                                                      |
| [`apps/website`](apps/website) | Live playground and docs, on [rshono](https://www.rshono.com).                                           |

## Development

Requires Node ≥ 22.18 and pnpm.

```bash
pnpm install
pnpm test           # all packages
pnpm typecheck
pnpm build          # packages only
pnpm site:dev       # the demo, at http://localhost:3000
```

The website consumes the packages' built `dist`, so run `pnpm build` before `pnpm site:dev`.

## Design in one paragraph

Two sources of truth, used together. `InputEvent.inputType` says what the user meant to do — the spec
requires a `paste` event to precede any `insertFromPaste`. A diff of the value against the last known
one says what actually happened, which is the only way to catch anything that changes a field without
announcing itself: extensions, password managers, framework re-renders, automation drivers.
Underneath is a piece table with provenance attached, spliced on every edit, so the breakdown always
describes the text as it currently stands rather than a history of events.

## What this is not

It is not a lie detector, a plagiarism checker, or an AI-content detector.

- **It cannot detect a ghostwriter.** Someone transcribing text from a phone beside their keyboard
  produces an entirely ordinary typing profile. This measures _how text entered a field_, never _who
  composed it_.
- **It is client-side.** Server-side `replay()` raises the cost of a forgery; it does not eliminate it.
- **It withholds timing signals rather than downweighting them** for IME, swipe keyboards, dictation
  and assistive input. Scoring those on typing dynamics would not detect misconduct, it would detect
  not typing English on a laptop.
- **It keeps no text and makes no network calls** by default. Keystroke timing is behavioural
  biometric data.

See [the core's limitations section](packages/core/README.md#limitations).

## Status

Working and tested, but **not yet verified in real browsers**. The suites use happy-dom, which
validates the wiring and has already caught real bugs — but no DOM implementation outside a browser
generates authentic `beforeinput` sequences for IME composition, swipe keyboards, autocorrect or
dictation. Those are exactly the cases where being wrong means penalising someone for how they type,
and they need Playwright across Chromium, Firefox and WebKit plus mobile emulation.

The `@cpd` npm scope is a placeholder and is not claimed. Note that "copy-paste detector" already
means source-code duplication detection in npm-land (jscpd), so a rename is worth considering before
publishing.
