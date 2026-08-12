'use client'

/**
 * @cpd/react — React bindings for the provenance detector.
 *
 * ```tsx
 * 'use client'
 * import { useProvenance } from '@cpd/react'
 *
 * function Answer() {
 *   const { ref, report } = useProvenance()
 *   return (
 *     <>
 *       <textarea ref={ref} name="answer" />
 *       {report?.state === 'suspicious' && <p>Most of this was pasted.</p>}
 *     </>
 *   )
 * }
 * ```
 *
 * The whole package is a client module: it watches DOM events, so there is
 * nothing here a server component could usefully render.
 */

export { ProvenanceHighlight, type ProvenanceHighlightProps } from './highlight.tsx'
export {
  useProvenance,
  type ProvenanceRange,
  type UseProvenanceOptions,
  type UseProvenanceResult,
} from './use-provenance.ts'

export type {
  AttentionStats,
  CaveatCode,
  CompositionStats,
  DetectorOptions,
  FieldState,
  InputProvenanceDetector,
  Origin,
  PasteStats,
  ProvenanceEvent,
  ProvenanceTarget,
  Report,
  Run,
  Signal,
  SignalCode,
  TimingStats,
} from '@cpd/dom'
