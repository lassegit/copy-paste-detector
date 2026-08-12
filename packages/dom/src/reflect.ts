import type { Report } from '@cpd/core'
import type { ProvenanceTarget } from './target.ts'

/** Which facts get written back onto the element as attributes. */
export type ReflectedAttribute = 'state' | 'score' | 'pasted' | 'imported'

export interface ReflectOptions {
  /** Attribute namespace. `'data-cpd'` yields `data-cpd-state`, `data-cpd-score`, … */
  readonly prefix: string
  readonly attributes: readonly ReflectedAttribute[]
  /** Also set a `--<prefix>-score` custom property, for styling by score. Off by default; it writes inline styles. */
  readonly cssVariable: boolean
}

export const DEFAULT_REFLECT_OPTIONS: ReflectOptions = {
  prefix: 'data-cpd',
  attributes: ['state', 'score', 'pasted'],
  cssVariable: false,
}

/**
 * Write the current verdict onto the element.
 *
 * Attributes rather than classes, so the values are readable as data
 * (`[data-cpd-state="suspicious"]` for styling, `dataset` for scripting) and a
 * server-rendered page can carry the same shape without this library running.
 */
export function reflect(element: ProvenanceTarget, report: Report, options: ReflectOptions): void {
  const { prefix } = options
  for (const attribute of options.attributes) {
    element.setAttribute(`${prefix}-${attribute}`, format(attribute, report))
  }
  if (options.cssVariable) {
    element.style.setProperty(`--${prefix.replace(/^data-/, '')}-score`, String(Math.round(report.score)))
  }
}

export function clearReflection(element: ProvenanceTarget, options: ReflectOptions): void {
  for (const attribute of options.attributes) {
    element.removeAttribute(`${options.prefix}-${attribute}`)
  }
  if (options.cssVariable) {
    element.style.removeProperty(`--${options.prefix.replace(/^data-/, '')}-score`)
  }
}

function format(attribute: ReflectedAttribute, report: Report): string {
  switch (attribute) {
    case 'state':
      return report.state
    case 'score':
      return String(Math.round(report.score))
    case 'pasted':
      return report.composition.pastedRatio.toFixed(2)
    case 'imported':
      return report.composition.importedRatio.toFixed(2)
  }
}
