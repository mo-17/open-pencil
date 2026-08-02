import { describe, expect, test } from 'bun:test'

import { SceneGraph, SkiaRenderer } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import {
  canObserveFontReadiness,
  isNodeFontLoaded,
  retryNodeFontReadiness
} from '#core/canvas/text'
import { fontManager } from '#core/text/fonts'
import { fontCoverageDemand, fontResolver } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'

describe('canvas text font readiness', () => {
  test('requires the exact requested font weight before rendering text', () => {
    const family = `ExactWeight_${Date.now()}`
    const node = {
      type: 'TEXT',
      text: 'Bold title',
      fontFamily: family,
      fontWeight: 700,
      italic: false,
      styleRuns: []
    } as SceneNode

    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(8))
    expect(isNodeFontLoaded({} as Parameters<typeof isNodeFontLoaded>[0], node)).toBe(false)

    fontManager.markLoaded(family, 'Bold', new ArrayBuffer(8))
    expect(isNodeFontLoaded({} as Parameters<typeof isNodeFontLoaded>[0], node)).toBe(true)
  })
})

describe('font readiness retries', () => {
  test('requires a loaded live font provider before readiness is externally observable', () => {
    expect(canObserveFontReadiness({ ck: {}, fontProvider: {}, fontsLoaded: false } as never)).toBe(
      false
    )
    expect(
      canObserveFontReadiness({ ck: {}, fontProvider: null, fontsLoaded: true } as never)
    ).toBe(false)
    expect(canObserveFontReadiness({ ck: {}, fontProvider: {}, fontsLoaded: true } as never)).toBe(
      true
    )
  })

  test('restarts an exhausted glyph-coverage demand instead of only counting an attempt', async () => {
    const ck = await initCanvasKit()
    const surface = expectDefined(ck.MakeSurface(200, 50), 'CanvasKit surface')
    const fontProvider = ck.TypefaceFontProvider.Make()
    fontManager.attachProvider(ck, fontProvider)
    const interData = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    fontManager.markLoaded('Inter', 'Regular', interData)
    const renderer = new SkiaRenderer(ck, surface)
    renderer.fontsLoaded = true
    renderer.fontProvider = fontProvider
    const graph = new SceneGraph()
    const source = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: '𠀀',
      fontFamily: 'Inter',
      fontWeight: 400,
      width: 200,
      height: 50
    })
    const node = expectDefined(graph.getNode(source.id), 'text node')
    const demand = fontCoverageDemand('cjk-sc', ['𠀀'])
    fontResolver.exhaust(demand)

    try {
      const retry = retryNodeFontReadiness(renderer, node)

      expect(retry.requested).toBe(true)
      expect(retry.demandKeys).toContain(demand.key)
      expect(fontResolver.state(demand).state).toBe('loading')
      await fontResolver.demand(demand)
    } finally {
      fontResolver.reset(demand)
      renderer.fontProvider = null
      fontManager.detachProvider(fontProvider)
      fontProvider.delete()
      surface.delete()
    }
  })
})
