import { describe, expect, test } from 'bun:test'

import { pageViewportTargetWarnings } from '#compiler/page-viewport-policy'

import { compile, withDefaults, type CompilerTarget } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { SceneGraph } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

const SOURCE_ONLY_TARGETS = [
  'expo',
  'wechat-miniprogram',
  'taro',
  'uni-app',
  'mpx'
] as const satisfies readonly CompilerTarget[]

function fixture() {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'page')
  graph.createNode('FRAME', page.id, { width: 360, height: 740 })
  return { graph, page }
}

describe('unsupported source-only page viewport policy', () => {
  for (const target of SOURCE_ONLY_TARGETS) {
    test(`${target} warns for both adaptive modes and keeps generated files identical`, () => {
      const { graph, page } = fixture()
      const options = withDefaults({ target, devMode: false })
      const legacy = compile({ graph, pageIds: [page.id], options })
      expect(
        legacy.warnings.some((warning) => warning.code === 'page-viewport-target-unsupported')
      ).toBe(false)
      for (const mode of ['responsive', 'fit-width'] as const) {
        graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode } })
        const adaptive = compile({ graph, pageIds: [page.id], options })
        const warnings = adaptive.warnings.filter(
          (warning) => warning.code === 'page-viewport-target-unsupported'
        )
        expect(warnings).toHaveLength(1)
        expect(warnings[0]?.nodeId).toBe(page.id)
        expect(warnings[0]?.message).toContain(target)
        expect(warnings[0]?.message).toContain(mode)
        expect(adaptive.files).toEqual(legacy.files)
      }
      graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'fixed' } })
      const fixed = compile({ graph, pageIds: [page.id], options })
      expect(fixed.files).toEqual(legacy.files)
      expect(fixed.warnings).toEqual(legacy.warnings)
    })
  }

  test('supported React, Vue and Flutter never receive unsupported policy diagnostics', () => {
    const { graph, page } = fixture()
    graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'responsive' } })
    const ir = collectTree(graph, page.id)
    for (const target of ['react', 'vue', 'flutter'] as const)
      expect(pageViewportTargetWarnings([ir], target)).toEqual([])
  })
})
