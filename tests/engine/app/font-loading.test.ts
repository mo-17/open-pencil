import { describe, expect, test } from 'bun:test'

import {
  collectGraphFontRequirements,
  fontManager,
  missingGraphFontScripts,
  type FontFallbackScript
} from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

import { ensureGraphFonts } from '@/app/editor/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

describe('app font loading', () => {
  test('requests platform fallback before parsing large native primary fonts', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, {
      text: '현대 소나타',
      fontFamily: 'Native Arial',
      fontSize: 32
    })
    const requirements = collectGraphFontRequirements(graph, [text.id])

    expect(missingGraphFontScripts(requirements, { treatUnknownCoverageAsMissing: true })).toEqual([
      'cjk-kr'
    ])
  })

  test('ensureGraphFonts loads fallback packs when loaded primary font misses CJK glyphs', async () => {
    const interData = await Bun.file(repoPath('public/Inter-Regular.ttf')).arrayBuffer()
    fontManager.markLoaded('Inter', 'Regular', interData)

    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, {
      text: '你好世界',
      fontFamily: 'Inter',
      fontSize: 32,
      textPicture: new Uint8Array([1, 2, 3])
    })

    const originalEnsureFallbackPack = fontManager.ensureFallbackPack.bind(fontManager)
    let requestedScripts: FontFallbackScript[] = []
    fontManager.ensureFallbackPack = async (scripts = ['cjk', 'arabic']) => {
      requestedScripts = [...scripts]
      return { cjk: ['Regression CJK Fallback'], arabic: [] }
    }

    try {
      const changed = await ensureGraphFonts(graph, [text.id])

      expect(changed).toBe(true)
      expect(requestedScripts).toEqual(['cjk-sc'])
      expect(expectDefined(graph.getNode(text.id), 'text node').textPicture).toBeNull()
    } finally {
      fontManager.ensureFallbackPack = originalEnsureFallbackPack
    }
  })

  test('keeps the containing frame visible without releasing a text block it does not own', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Visible while fonts load',
      width: 320,
      height: 200
    })
    const text = graph.createNode('TEXT', frame.id, {
      text: 'Still visible',
      fontFamily: `Pending Font ${Date.now()}`,
      fontSize: 24
    })
    const controller = new AbortController()
    const originalLoadFont = fontManager.loadFont.bind(fontManager)
    let receivedSignal: AbortSignal | undefined

    fontManager.blockNodesUntilFontsResolve([text.id])
    fontManager.loadFont = async (_family, _style, _characters, options) => {
      receivedSignal = options?.signal
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            const reason = options.signal?.reason
            reject(reason instanceof Error ? reason : new Error('aborted'))
          },
          { once: true }
        )
      })
    }

    try {
      const pending = ensureGraphFonts(graph, [frame.id], null, controller.signal)
      await Promise.resolve()

      expect(receivedSignal).toBe(controller.signal)
      expect(fontManager.isNodeBlocked(frame.id)).toBe(false)
      expect(fontManager.isNodeBlocked(text.id)).toBe(true)

      controller.abort(new Error('AI drawing stopped'))
      await expect(pending).rejects.toThrow('AI drawing stopped')
      expect(fontManager.isNodeBlocked(frame.id)).toBe(false)
      expect(fontManager.isNodeBlocked(text.id)).toBe(true)
    } finally {
      fontManager.loadFont = originalLoadFont
      fontManager.unblockNodes([text.id])
    }
  })

  test('preserves an independently owned text block when font loading fails', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, {
      text: 'Failure cleanup',
      fontFamily: `Failing Font ${Date.now()}`,
      fontSize: 24
    })
    const originalLoadFont = fontManager.loadFont.bind(fontManager)

    fontManager.blockNodesUntilFontsResolve([text.id])
    fontManager.loadFont = async () => {
      throw new Error('font transport failed')
    }

    try {
      await expect(ensureGraphFonts(graph, [text.id])).rejects.toThrow('font transport failed')
      expect(fontManager.isNodeBlocked(text.id)).toBe(true)
    } finally {
      fontManager.loadFont = originalLoadFont
      fontManager.unblockNodes([text.id])
    }
  })
})
