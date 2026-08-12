import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProvenanceHighlight } from '../src/highlight.tsx'
import { useProvenance } from '../src/use-provenance.ts'
import { paste, text, type } from './dom.ts'

afterEach(cleanup)

const OPTIONS = { allowSyntheticEvents: true, updateDebounceMs: 0 } as const

function Field({ options = {} }: { options?: Record<string, unknown> }): React.ReactElement {
  const { ref, report, ranges } = useProvenance<HTMLTextAreaElement>({ ...OPTIONS, ...options })
  return (
    <form>
      <textarea ref={ref} name="answer" aria-label="answer" />
      <output data-testid="state">{report?.state ?? 'none'}</output>
      <output data-testid="pasted">{report?.composition.pastedRatio ?? -1}</output>
      <output data-testid="runs">{ranges.map((range) => `${range.origin}:${range.end - range.start}`).join('|')}</output>
    </form>
  )
}

function field(): HTMLTextAreaElement {
  return screen.getByLabelText('answer') as HTMLTextAreaElement
}

describe('useProvenance', () => {
  it('reports before anything is typed', () => {
    render(<Field />)
    expect(screen.getByTestId('state').textContent).toBe('clean')
  })

  it('tracks typing as authored', () => {
    render(<Field />)
    act(() => type(field(), text(60)))

    expect(screen.getByTestId('state').textContent).toBe('clean')
    expect(screen.getByTestId('runs').textContent).toBe('typed:60')
  })

  it('tracks a paste and exposes it as ranges', () => {
    render(<Field />)
    act(() => {
      type(field(), text(40))
      paste(field(), text(600))
    })

    expect(screen.getByTestId('state').textContent).toBe('review')
    expect(screen.getByTestId('runs').textContent).toBe('typed:40|pasted:600')
  })

  it('reattributes pasted text the user overwrites', () => {
    render(<Field />)
    act(() => paste(field(), text(100)))
    expect(screen.getByTestId('pasted').textContent).toBe('1')

    act(() => {
      const element = field()
      element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true }))
      element.value = element.value.slice(0, 50)
      element.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }))
      type(element, text(50))
    })

    expect(screen.getByTestId('pasted').textContent).toBe('0.5')
  })

  it('survives a fresh options object on every render', () => {
    // The natural way to call this hook is with an object literal, which has a
    // new identity every render. Recreating the detector would discard the
    // session and every keystroke it had recorded.
    function Churning(): React.ReactElement {
      const renders = useRef(0)
      renders.current += 1
      const { ref, report } = useProvenance<HTMLTextAreaElement>({
        ...OPTIONS,
        thresholds: { largePasteChars: 40 },
      })
      return (
        <>
          <textarea ref={ref} aria-label="answer" />
          <output data-testid="length">{report?.length ?? -1}</output>
        </>
      )
    }

    render(<Churning />)
    act(() => type(field(), text(30)))
    act(() => type(field(), text(30)))

    expect(screen.getByTestId('length').textContent).toBe('60')
  })

  it('tears the detector down on unmount', () => {
    const { unmount } = render(<Field />)
    const element = field()
    act(() => paste(element, text(600)))
    expect(element.getAttribute('data-cpd-state')).toBe('review')

    unmount()
    expect(element.hasAttribute('data-cpd-state')).toBe(false)
  })
})

describe('ProvenanceHighlight', () => {
  it('splits the text by origin', () => {
    render(
      <ProvenanceHighlight
        value="abcdef"
        ranges={[
          { start: 0, end: 3, origin: 'typed', at: 0 },
          { start: 3, end: 6, origin: 'pasted', at: 10 },
        ]}
      />,
    )

    const segments = document.querySelectorAll('[data-origin]')
    expect(segments).toHaveLength(2)
    expect(segments[0]?.getAttribute('data-origin')).toBe('typed')
    expect(segments[0]?.textContent).toBe('abc')
    expect(segments[1]?.getAttribute('data-origin')).toBe('pasted')
    expect(segments[1]?.textContent).toBe('def')
  })

  it('shows the text plainly rather than mis-attributing it when ranges do not fit', () => {
    render(<ProvenanceHighlight value="abcdef" ranges={[{ start: 0, end: 2, origin: 'pasted', at: 0 }]} />)

    const segments = document.querySelectorAll('[data-origin]')
    expect(segments).toHaveLength(1)
    expect(segments[0]?.getAttribute('data-origin')).toBe('unknown')
    expect(segments[0]?.textContent).toBe('abcdef')
  })

  it('renders a placeholder when empty', () => {
    render(<ProvenanceHighlight value="" ranges={[]} placeholder="Nothing yet" />)
    expect(screen.getByText('Nothing yet')).toBeTruthy()
  })

  it('applies per-origin class names', () => {
    render(
      <ProvenanceHighlight
        value="abcdef"
        ranges={[
          { start: 0, end: 3, origin: 'typed', at: 0 },
          { start: 3, end: 6, origin: 'pasted', at: 0 },
        ]}
        originClassName={{ pasted: 'flagged' }}
      />,
    )

    expect(document.querySelector('.flagged')?.textContent).toBe('def')
  })
})
