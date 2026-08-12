import { afterEach, describe, expect, it } from 'vitest'
import { observe, type ObserverHandle } from '../src/observe.ts'
import { mount, paste, text } from './dom.ts'

let handle: ObserverHandle | undefined

afterEach(() => {
  handle?.disconnect()
  handle = undefined
})

describe('observe', () => {
  it('binds every matching field', () => {
    mount('<textarea data-cpd></textarea><textarea data-cpd></textarea><textarea></textarea>')
    handle = observe('textarea[data-cpd]', { allowSyntheticEvents: true, updateDebounceMs: 0 })

    expect(handle.detectors.size).toBe(2)
  })

  it('picks up fields added later', async () => {
    mount('<div id="host"></div>')
    handle = observe('textarea[data-cpd]', { allowSyntheticEvents: true, updateDebounceMs: 0 })
    expect(handle.detectors.size).toBe(0)

    const host = document.querySelector('#host')
    host?.insertAdjacentHTML('beforeend', '<textarea data-cpd></textarea>')
    await waitForMutations()

    expect(handle.detectors.size).toBe(1)
  })

  it('tears down detectors for fields that are removed', async () => {
    mount('<div id="host"><textarea data-cpd></textarea></div>')
    handle = observe('textarea[data-cpd]', { allowSyntheticEvents: true, updateDebounceMs: 0 })
    expect(handle.detectors.size).toBe(1)

    document.querySelector('#host')?.replaceChildren()
    await waitForMutations()

    expect(handle.detectors.size).toBe(0)
  })

  it('refuses to watch password fields unless asked explicitly', () => {
    mount('<input type="password" data-cpd><input type="text" data-cpd>')
    handle = observe('[data-cpd]', { allowSyntheticEvents: true })

    expect(handle.detectors.size).toBe(1)

    handle.disconnect()
    handle = observe('[data-cpd]', { allowSyntheticEvents: true, includeSensitive: true })
    expect(handle.detectors.size).toBe(2)
  })

  it('ignores elements that hold no free text', () => {
    mount('<input type="checkbox" data-cpd><input type="range" data-cpd><div data-cpd></div>')
    handle = observe('[data-cpd]', { allowSyntheticEvents: true })

    expect(handle.detectors.size).toBe(0)
  })

  it('binds contenteditable hosts', () => {
    mount('<div contenteditable="true" data-cpd></div>')
    handle = observe('[data-cpd]', { allowSyntheticEvents: true })

    expect(handle.detectors.size).toBe(1)
  })

  it('exposes the detector for a given element', () => {
    mount('<form><textarea name="answer" data-cpd></textarea></form>')
    handle = observe('textarea[data-cpd]', { allowSyntheticEvents: true, updateDebounceMs: 0 })

    const element = document.querySelector('textarea')
    if (element === null) throw new Error('missing fixture')
    paste(element, text(600))

    expect(handle.get(element)?.report().composition.pastedRatio).toBe(1)
  })

  it('stops watching when disconnected', () => {
    mount('<textarea data-cpd></textarea>')
    const local = observe('textarea[data-cpd]', { allowSyntheticEvents: true, updateDebounceMs: 0 })
    const element = document.querySelector('textarea')
    if (element === null) throw new Error('missing fixture')

    paste(element, text(600))
    local.disconnect()

    expect(local.detectors.size).toBe(0)
    expect(element.hasAttribute('data-cpd-state')).toBe(false)
  })
})

function waitForMutations(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
