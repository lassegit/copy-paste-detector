/**
 * @cpd/dom — binds the provenance engine to real form fields.
 *
 * ```ts
 * import { observe } from '@cpd/dom'
 *
 * observe('textarea[data-cpd]')
 * ```
 *
 * Each watched field gets `data-cpd-state`, `data-cpd-score` and
 * `data-cpd-pasted` attributes, and — when asked — a hidden input carrying the
 * verdict so a server that only sees the form post can read it.
 *
 * Nothing here performs network I/O.
 */

export { classify, isDeletion, type ClassificationHints } from './classify.ts'
export { InputProvenanceDetector, type DetectorOptions } from './detector.ts'
export {
  DEFAULT_HIDDEN_INPUT_OPTIONS,
  buildPayload,
  syncHiddenInput,
  type HiddenInputOptions,
  type HiddenPayload,
} from './hidden-input.ts'
export { observe, type ObserveOptions, type ObserverHandle } from './observe.ts'
export {
  DEFAULT_REFLECT_OPTIONS,
  clearReflection,
  reflect,
  type ReflectOptions,
  type ReflectedAttribute,
} from './reflect.ts'
export {
  createAdapter,
  findForm,
  isSensitiveField,
  isTextField,
  type ProvenanceTarget,
  type TargetAdapter,
} from './target.ts'

export type {
  AttentionStats,
  CaveatCode,
  CompositionStats,
  FieldState,
  Origin,
  PasteStats,
  ProvenanceEvent,
  Report,
  Run,
  Signal,
  SignalCode,
  TimingStats,
} from '@cpd/core'
