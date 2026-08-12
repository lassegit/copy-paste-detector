import { InputProvenanceDetector, type DetectorOptions } from './detector.ts'
import { isSensitiveField, isTextField, type ProvenanceTarget } from './target.ts'

export interface ObserveOptions extends DetectorOptions {
  /** Where to look, and what to watch for new fields. Defaults to `document`. */
  readonly root?: ParentNode
  /** Keep watching for matching fields added later. On by default. */
  readonly watch?: boolean
  /**
   * Bind password fields too.
   *
   * Off by default. Watching what people paste into a password box is how
   * password managers get penalised and how credentials end up in telemetry,
   * and there is no good reason to do it by accident.
   */
  readonly includeSensitive?: boolean
}

export interface ObserverHandle {
  readonly detectors: ReadonlyMap<Element, InputProvenanceDetector>
  get(element: Element): InputProvenanceDetector | undefined
  /** Stop watching and tear down every detector this handle created. */
  disconnect(): void
}

const NOOP_HANDLE: ObserverHandle = {
  detectors: new Map(),
  get: () => undefined,
  disconnect: () => {},
}

/**
 * Attach a detector to every field matching `target`, now and as they appear.
 *
 * Returns a no-op handle when there is no DOM, so calling this at module scope
 * in a server-rendered app is safe.
 */
export function observe(
  target: string | Element | Iterable<Element>,
  options: ObserveOptions = {},
): ObserverHandle {
  if (typeof document === 'undefined') return NOOP_HANDLE

  const root = options.root ?? document
  const detectors = new Map<Element, InputProvenanceDetector>()

  const attach = (element: Element): void => {
    if (detectors.has(element)) return
    if (!isTextField(element)) return
    if (isSensitiveField(element) && options.includeSensitive !== true) return
    detectors.set(element, new InputProvenanceDetector(element as ProvenanceTarget, options))
  }

  const detach = (element: Element): void => {
    const detector = detectors.get(element)
    if (detector === undefined) return
    detector.destroy()
    detectors.delete(element)
  }

  const selector = typeof target === 'string' ? target : null
  if (typeof target === 'string') {
    for (const element of root.querySelectorAll(target)) attach(element)
  } else if (target instanceof Element) {
    attach(target)
  } else {
    for (const element of target) attach(element)
  }

  let mutationObserver: MutationObserver | undefined
  if (selector !== null && options.watch !== false) {
    mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches(selector)) attach(node)
          for (const descendant of node.querySelectorAll(selector)) attach(descendant)
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue
          if (detectors.has(node)) detach(node)
          for (const descendant of node.querySelectorAll(selector)) detach(descendant)
        }
      }
    })
    mutationObserver.observe(root instanceof Document ? root.documentElement : (root as Node), {
      childList: true,
      subtree: true,
    })
  }

  return {
    detectors,
    get: (element) => detectors.get(element),
    disconnect: () => {
      mutationObserver?.disconnect()
      for (const detector of detectors.values()) detector.destroy()
      detectors.clear()
    },
  }
}
