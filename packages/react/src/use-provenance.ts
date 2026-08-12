'use client'

import {
  InputProvenanceDetector,
  type DetectorOptions,
  type Origin,
  type ProvenanceEvent,
  type ProvenanceTarget,
  type Report,
} from '@cpd/dom'
import { useCallback, useEffect, useRef, useState } from 'react'

/** A run of characters in the field, with where it came from. */
export interface ProvenanceRange {
  readonly start: number
  readonly end: number
  readonly origin: Origin
  readonly at: number
}

export interface UseProvenanceOptions extends DetectorOptions {
  /** Called whenever the verdict is recomputed. */
  readonly onReport?: (report: Report) => void
}

export interface UseProvenanceResult<T extends ProvenanceTarget> {
  /** Attach to the field you want watched: `<textarea ref={provenance.ref} />` */
  readonly ref: (element: T | null) => void
  /** Latest verdict, or `null` before the field mounts. */
  readonly report: Report | null
  /** Character ranges by origin, for highlighting. Empty before mount. */
  readonly ranges: readonly ProvenanceRange[]
  /**
   * Snapshot the replayable event log, for submitting to a server that will
   * re-score it. A function rather than a value: the log grows on every
   * keystroke, and re-rendering the tree that often to carry it would be a poor
   * trade for something only read at submit time.
   */
  readonly getEvents: () => readonly ProvenanceEvent[]
  /** The underlying detector, for anything the hook does not surface. `null` until the field mounts. */
  readonly detector: InputProvenanceDetector | null
  /** Declare the origin of the next insertion — e.g. from your own dictation button. */
  readonly hintNextInsert: (origin: Origin) => void
  /** Recompute against the field's current contents right now. */
  readonly sync: () => void
  readonly reset: () => void
}

/**
 * Watch a field's provenance from React.
 *
 * The detector is created when the element mounts and destroyed when it
 * unmounts, and never recreated in between: options are read through a ref, so
 * passing a fresh object literal on every render — which is the normal way to
 * call a hook — does not throw away the session and everything it has recorded.
 */
export function useProvenance<T extends ProvenanceTarget = HTMLTextAreaElement>(
  options: UseProvenanceOptions = {},
): UseProvenanceResult<T> {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  // The element is held in state rather than a ref so that mounting it triggers
  // the effect below. A plain ref would not re-render, and the detector would
  // never be created.
  const [element, setElement] = useState<T | null>(null)
  const detectorRef = useRef<InputProvenanceDetector | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [ranges, setRanges] = useState<readonly ProvenanceRange[]>([])

  useEffect(() => {
    if (element === null) return undefined

    const detector = new InputProvenanceDetector(element, {
      ...optionsRef.current,
      onReport: (next) => {
        setReport(next)
        setRanges(detector.ranges())
        optionsRef.current.onReport?.(next)
      },
    })
    detectorRef.current = detector
    setReport(detector.report())
    setRanges(detector.ranges())

    return () => {
      detector.destroy()
      detectorRef.current = null
      setReport(null)
      setRanges([])
    }
  }, [element])

  const sync = useCallback((): void => {
    detectorRef.current?.sync()
  }, [])

  const reset = useCallback((): void => {
    detectorRef.current?.reset()
  }, [])

  const hintNextInsert = useCallback((origin: Origin): void => {
    detectorRef.current?.hintNextInsert(origin)
  }, [])

  const getEvents = useCallback((): readonly ProvenanceEvent[] => {
    return detectorRef.current?.events ?? []
  }, [])

  return {
    ref: setElement,
    report,
    ranges,
    getEvents,
    detector: detectorRef.current,
    hintNextInsert,
    sync,
    reset,
  }
}
