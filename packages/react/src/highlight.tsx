'use client'

import type { Origin } from '@cpd/dom'
import type { CSSProperties, ReactElement } from 'react'
import type { ProvenanceRange } from './use-provenance.ts'

export interface ProvenanceHighlightProps {
  /** The field's current text. */
  readonly value: string
  /** Ranges from `useProvenance().ranges`. */
  readonly ranges: readonly ProvenanceRange[]
  readonly className?: string
  readonly style?: CSSProperties
  /** Per-origin class names, merged onto each segment. */
  readonly originClassName?: Partial<Record<Origin, string>>
  /** Rendered when the field is empty. */
  readonly placeholder?: string
}

/**
 * Render the field's text split by provenance.
 *
 * Each segment carries `data-origin`, so styling is entirely the caller's — the
 * library has no idea whether pasted text should be highlighted red, faintly
 * shaded, or not at all, and that is a decision with real consequences for the
 * person on the other end.
 *
 * Showing someone which parts of their own text were pasted is the least
 * adversarial use of this data, and the one worth building first: it makes the
 * measurement visible to the person being measured.
 */
export function ProvenanceHighlight({
  value,
  ranges,
  className,
  style,
  originClassName,
  placeholder = '',
}: ProvenanceHighlightProps): ReactElement {
  if (value.length === 0) {
    return (
      <div className={className} style={style} data-provenance-highlight="">
        {placeholder}
      </div>
    )
  }

  // Fall back to one undifferentiated block if the ranges do not line up with
  // the text — better to show the text plainly than to mis-attribute it.
  const total = ranges.reduce((sum, range) => sum + (range.end - range.start), 0)
  const segments: readonly ProvenanceRange[] =
    total === value.length ? ranges : [{ start: 0, end: value.length, origin: 'unknown', at: 0 }]

  return (
    <div className={className} style={style} data-provenance-highlight="">
      {segments.map((range) => (
        <span
          key={`${range.start}-${range.origin}`}
          data-origin={range.origin}
          className={originClassName?.[range.origin]}
        >
          {value.slice(range.start, range.end)}
        </span>
      ))}
    </div>
  )
}
