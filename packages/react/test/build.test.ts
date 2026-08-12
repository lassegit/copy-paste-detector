import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the packaging, not the behaviour.
 *
 * An RSC app decides what ships to the browser by reading the 'use client'
 * directive off the built module. If a bundler upgrade ever drops it, nothing
 * in this repo would fail — the break would surface in someone else's app, as a
 * hook called during a server render. Skipped when `dist/` has not been built.
 */
const dist = (file: string): string => fileURLToPath(new URL(`../dist/${file}`, import.meta.url))

async function readDist(file: string): Promise<string | null> {
  try {
    return await readFile(dist(file), 'utf8')
  } catch {
    return null
  }
}

describe('built output', () => {
  it.each(['index.js', 'index.cjs'])('keeps the "use client" directive in %s', async (file) => {
    const source = await readDist(file)
    if (source === null) return // not built yet
    expect(source.trimStart().startsWith(`"use client"`) || source.trimStart().startsWith(`'use client'`)).toBe(
      true,
    )
  })

  it('leaves react and the sibling packages external', async () => {
    const source = await readDist('index.js')
    if (source === null) return
    expect(source).toContain('from "@cpd/dom"')
    expect(source).toContain('from "react')
    // Bundling React would give a consumer two copies and break hooks.
    expect(source).not.toContain('useSyncExternalStore')
  })
})
