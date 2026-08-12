# @cpd/core

Headless engine for tracking **where the text in a field came from** and **how it got there**.

Zero dependencies, no DOM access, no network access. Consumes a stream of normalised events and
produces a `Report`. Bind it to real elements with `@cpd/dom`, or replay a submitted log on a server
with `replay()`.

## The mental model

Most "paste detectors" answer a yes/no question: *did a paste happen?* That question is close to
useless. Pasting a URL and pasting an entire cover letter are the same event under that model, and a
user who pastes a reference then writes around it looks identical to one who pasted the whole answer.

This library answers a different question: **what is this text made of, right now?**

It maintains a piece table with provenance attached — a list of contiguous runs that always sums to
the field's length:

```
typed:42 | pasted:880
```

Because it is spliced on every edit, it reflects the text as it currently stands. Paste 100
characters and rewrite half, and you get `typed:50 | pasted:50`. Delete the paste entirely and the
pasted ratio returns to zero, which is the honest answer.

## Usage

```ts
import { ProvenanceSession } from '@cpd/core'

const session = new ProvenanceSession()

session.dispatch({
  kind: 'edit',
  t: 1200,          // ms since session start
  start: 0,
  removed: 0,
  inserted: 880,
  graphemes: 880,
  origin: 'pasted',
})

const report = session.report()
report.state                     // 'suspicious'
report.score                     // 78.81
report.composition.pastedRatio   // 0.954
report.signals                   // why, in order of contribution
```

### Reports explain themselves

A score is never allowed to be a bare number. Every point is attributable:

```
 32.81  paste.ratio         — 95% of the final text came from the clipboard.
    24  paste.after-away    — 1 paste(s) landed within moments of the user returning, after 14.0s away.
    22  paste.large         — A single paste inserted 880 characters.
```

`state` is a coarse verdict for CSS hooks and triage: `clean` → `pasted` → `review` → `suspicious`.
Note that a field which is 100% pasted lands on `review`, not `suspicious`. Someone may legitimately
have drafted in another editor; it takes corroborating evidence — a trip away from the page,
impossible typing speed — to reach the top band. Tune with `thresholds` and `weights` if your
context calls for something stricter.

## Signals

| Code | Fires when |
|---|---|
| `paste.large` | A single paste exceeded the character threshold |
| `paste.ratio` | Too much of the final text came from the clipboard |
| `paste.after-away` | A large import landed right after the user returned from elsewhere |
| `typing.impossible-speed` | Sustained rate above the fastest recorded human typing |
| `typing.robotic` | Keystroke rhythm too uniform to be human |
| `typing.no-corrections` | Long text produced with essentially no backspacing |
| `input.programmatic` | Script wrote the value rather than a user entering it |
| `input.untrusted` | Events were synthesised rather than user-generated |

## Caveats withhold signals

Caveats are not tuning knobs — they are correctness requirements. Timing signals are withheld
entirely when the input method makes them meaningless:

- **`ime-composition`** — an IME user composing Japanese produces multi-character inserts with
  meaningless inter-key intervals. Scoring them on typing dynamics would not detect misconduct, it
  would detect not typing in English on a laptop.
- **`wordwise-input`** — swipe and predictive keyboards deliver whole words at once.
- **`dictation`** — speech-to-text arrives in large chunks by design.
- **`accessibility-mode`** — set this when a user relies on switch access, word prediction or text
  expansion. Opt in via `new ProvenanceSession({ accessibilityMode: true })`.
- **`insufficient-timing-data`** — too few keystrokes to say anything.

Withheld signals still appear in `report.signals` with `weight: 0` and a `suppressedBy` field, so a
reviewer can see what was considered and why it was discounted.

## Privacy

Keystroke timing is behavioural biometric data. Under GDPR it becomes special-category data the
moment it is used to identify a person, and even short of that it is personal data. The defaults are
the least revealing mode that still works.

| Mode | Text retained | Timestamp resolution |
|---|---|---|
| `strict` | no | 50 ms |
| `balanced` *(default)* | no | 10 ms |
| `forensic` | yes | 1 ms |

The library performs no I/O of any kind. It never sends anything anywhere.

Timestamps are coarsened **on ingest**, so a replayed log scores identically to the live session.

## Server-side verification

Client-side scores are advisory — anyone can edit the number before it is posted. Post the *log*
instead and recompute:

```ts
import { replay } from '@cpd/core'

const report = replay(JSON.parse(submittedLog))
```

Forgery now requires an internally consistent event stream with a plausible distribution of
inter-keystroke intervals, rather than a single flipped integer. That is a much higher bar. It is
still not proof.

## Limitations

Read these before you build anything on top of it.

- **It cannot detect a ghostwriter.** Someone transcribing text from a phone beside their keyboard
  produces a perfectly ordinary typing profile. This library detects *how text entered a field*, not
  *who composed it*.
- **It is client-side.** JavaScript can be disabled, the payload edited, the events synthesised.
  `replay()` raises the cost of forgery; it does not eliminate it.
- **A high score is a reason to look, not a reason to reject.** Wiring this to an automated rejection
  would be both unfair and, in an employment or education context, likely unlawful under GDPR
  Article 22.
- **Legitimate paste is extremely common.** Calibrate on your own traffic before trusting thresholds.

## API

- `ProvenanceSession` — accumulate events, produce reports
- `replay(events, options)` — re-score a submitted log
- `ProvenanceLedger` — the provenance piece table, usable on its own
- `diffSplice(prev, next)` — derive a minimal splice between two strings
- `evaluate(facts, caveats, config)` — the scorer, usable on its own
- `countGraphemes(text)` — grapheme counting used by the timing maths
- `DEFAULT_THRESHOLDS`, `DEFAULT_WEIGHTS`, `DEFAULT_TIMING_CONFIG`
