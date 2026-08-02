import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick } from 'vue'

import { SceneGraph } from '@open-pencil/core'
import { fontFaceDemand, fontManager, fontResolver } from '@open-pencil/core/text'

import { useNodeFontStatus } from '#vue/shared/font-status/use'

function textNode(family: string) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  return graph.createNode('TEXT', page.id, {
    fontFamily: family,
    fontWeight: 400,
    text: 'Font status'
  })
}

describe('useNodeFontStatus', () => {
  test('keeps a resolving face pending and reacts when it loads', async () => {
    const family = `PendingFont_${Date.now()}`
    const node = textNode(family)
    const demand = fontFaceDemand(family, 'Regular', node.text)
    const fontData = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    fontResolver.reset(demand)
    const resolution = fontResolver.demand(demand)
    const scope = effectScope()
    const status = scope.run(() => useNodeFontStatus(() => node))
    if (!status) throw new Error('Font status scope did not initialize')

    expect(status.pendingFonts.value).toEqual([family])
    expect(status.missingFonts.value).toEqual([])

    fontManager.markLoaded(family, 'Regular', fontData)
    await resolution
    await nextTick()
    expect(status.pendingFonts.value).toEqual([])
    expect(status.missingFonts.value).toEqual([])
    scope.stop()
    fontResolver.reset(demand)
  })

  test('reports a family only after resolution is terminal', () => {
    const family = `MissingFont_${Date.now()}`
    const node = textNode(family)
    const demand = fontFaceDemand(family, 'Regular', node.text)
    fontResolver.exhaust(demand)
    const scope = effectScope()
    const status = scope.run(() => useNodeFontStatus(() => node))
    if (!status) throw new Error('Font status scope did not initialize')

    expect(status.pendingFonts.value).toEqual([])
    expect(status.missingFonts.value).toEqual([family])
    scope.stop()
    fontResolver.reset(demand)
  })

  test('retries an exhausted face and switches the warning back to pending', async () => {
    const family = `RetryFont_${Date.now()}`
    const node = textNode(family)
    const demand = fontFaceDemand(family, 'Regular', node.text)
    const fontData = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    fontResolver.exhaust(demand)
    const scope = effectScope()
    const status = scope.run(() => useNodeFontStatus(() => node))
    if (!status) throw new Error('Font status scope did not initialize')

    expect(status.missingFonts.value).toEqual([family])
    const retry = status.retryMissingFonts()
    expect(status.pendingFonts.value).toEqual([family])
    expect(status.missingFonts.value).toEqual([])

    fontManager.markLoaded(family, 'Regular', fontData)
    await retry
    await nextTick()
    expect(status.pendingFonts.value).toEqual([])
    expect(status.missingFonts.value).toEqual([])
    scope.stop()
    fontResolver.reset(demand)
  })

  test('loaded family data takes precedence over a terminal resolver state', async () => {
    const family = `LoadedFont_${Date.now()}`
    const node = textNode(family)
    const demand = fontFaceDemand(family, 'Regular', node.text)
    fontResolver.exhaust(demand)
    fontManager.markLoaded(
      family,
      'Regular',
      await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    )
    const scope = effectScope()
    const status = scope.run(() => useNodeFontStatus(() => node))
    if (!status) throw new Error('Font status scope did not initialize')

    expect(status.pendingFonts.value).toEqual([])
    expect(status.missingFonts.value).toEqual([])
    scope.stop()
    fontResolver.reset(demand)
  })

  test('joins an in-progress manual retry instead of resolving a repeated action early', async () => {
    const family = `JoinedRetryFont_${Date.now()}`
    const node = textNode(family)
    const demand = fontFaceDemand(family, 'Regular', node.text)
    const fontData = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    let release: ((data: ArrayBuffer | null) => void) | undefined
    fontManager.setHostFontLoader(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    fontResolver.exhaust(demand)
    const scope = effectScope()
    const status = scope.run(() => useNodeFontStatus(() => node))
    if (!status) throw new Error('Font status scope did not initialize')

    try {
      const first = status.retryMissingFonts()
      const second = status.retryMissingFonts()
      let secondSettled = false
      void second.then(() => {
        secondSettled = true
        return undefined
      })

      await Promise.resolve()
      expect(secondSettled).toBe(false)
      release?.(fontData)
      await Promise.all([first, second])
      expect(status.missingFonts.value).toEqual([])
      expect(fontManager.isStyleLoaded(family, 'Regular')).toBe(true)
    } finally {
      scope.stop()
      fontResolver.reset(demand)
      fontManager.setHostFontLoader(null)
    }
  })
})
