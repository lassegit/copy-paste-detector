import type { PageProps } from "@rshono/core";
import { Layout } from "./layout";
import { Playground } from "./playground";

export default function Home(_props: PageProps<"/">) {
  return (
    <Layout description="Track where the text in a form field came from — pasted, dropped, dictated, typed, or written by script.">
      <section className="hero">
        <h1>Where did this text come from?</h1>
        <p className="lede">
          Most paste detectors answer a yes/no question. That question is close
          to useless: pasting a URL and pasting an entire cover letter are the
          same event under that model. This one keeps a running breakdown of{" "}
          <em>what the text is made of</em>, and updates it as the text changes.
        </p>
      </section>

      <Playground />

      <section className="prose">
        <h2>How it decides</h2>
        <p>
          Two sources of truth, used together, because each covers the
          other&rsquo;s blind spot. <code>InputEvent.inputType</code> says what
          the user meant to do — the spec requires a <code>paste</code> event to
          precede any <code>insertFromPaste</code>. A diff of the value against
          the last known one says what actually happened, which is the only way
          to catch anything that changes a field without announcing itself:
          extensions, password managers, framework re-renders, automation
          drivers.
        </p>
        <p>
          Underneath is a piece table with provenance attached — a list of runs
          that always sums to the field&rsquo;s length. Paste a hundred
          characters and rewrite half, and you get fifty typed and fifty pasted.
          Delete the paste entirely and the pasted ratio returns to zero,
          because that is the honest answer.
        </p>

        <h2>What it deliberately does not do</h2>
        <ul className="constraints">
          <li>
            <strong>
              It withholds timing signals rather than downweighting them.
            </strong>{" "}
            An IME user composing Japanese produces multi-character inserts with
            meaningless inter-key intervals; a swipe keyboard delivers whole
            words; dictation arrives in large chunks. Scoring those on typing
            dynamics would not detect misconduct, it would detect not typing
            English on a laptop. The same applies to{" "}
            <code>accessibilityMode</code>, for users on switch access, word
            prediction or text expansion.
          </li>
          <li>
            <strong>It keeps no text and makes no network calls.</strong>{" "}
            Keystroke timing is behavioural biometric data; under GDPR it
            becomes special-category data the moment it is used to identify
            someone. The default retains lengths and timings only, with clocks
            coarsened to 10&nbsp;ms. This demo page overrides that so it can
            show your text back to you — a real deployment should not.
          </li>
          <li>
            <strong>A score is never a bare number.</strong> Every point is
            attributable to a named signal with a sentence explaining it, and
            withheld signals stay visible with their reason. A reviewer can see
            what was considered and what was discounted.
          </li>
          <li>
            <strong>
              A fully pasted field scores &ldquo;review&rdquo;, not
              &ldquo;suspicious&rdquo;.
            </strong>{" "}
            Someone may legitimately have drafted in another editor. It takes
            corroborating evidence — a trip away from the page, impossible
            typing speed — to reach the top band.
          </li>
        </ul>

        <h2>The limits, plainly</h2>
        <p>
          It cannot detect a ghostwriter. Someone transcribing text from a phone
          beside their keyboard produces an entirely ordinary typing profile.
          This measures <em>how text entered a field</em>, never{" "}
          <em>who composed it</em>.
        </p>
        <p>
          It is client-side. JavaScript can be disabled, the payload edited, the
          events synthesised. Server-side replay raises the cost of a forgery;
          it does not eliminate it.
        </p>
      </section>
    </Layout>
  );
}
