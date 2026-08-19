import { describe, expect, test } from 'bun:test'

import {
  compile,
  withDefaults,
  type CompilerRouter,
  type MiniProgramCompilerTarget
} from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const TARGETS: ReadonlyArray<{
  marker: string
  router: CompilerRouter
  target: MiniProgramCompilerTarget
}> = [
  { marker: 'app.json', router: 'wechat-native', target: 'wechat-miniprogram' },
  { marker: 'config/index.ts', router: 'taro-router', target: 'taro' },
  { marker: 'pages.json', router: 'uni-pages', target: 'uni-app' },
  { marker: 'src/app.mpx', router: 'mpx-router', target: 'mpx' }
]

describe('mini-program compiler target selection', () => {
  for (const fixture of TARGETS) {
    test(`dispatches ${fixture.target} through its dedicated shared-IR adapter`, () => {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      graph.createNode('TEXT', pageId, { text: `Hello ${fixture.target}` })

      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({
          packageName: 'mini-program-demo',
          productName: 'Mini Program Demo',
          target: fixture.target,
          router: fixture.router,
          devMode: false
        })
      })

      expect(output.files.has(fixture.marker)).toBe(true)
      expect(output.files.size).toBeGreaterThan(1)
      expect(output.warnings.map(({ code }) => code)).not.toContain('target-not-implemented')
      expect(
        [...output.files.values()]
          .filter((value): value is string => typeof value === 'string')
          .join('\n')
      ).toContain(`Hello ${fixture.target}`)
    })
  }

  test('reports incompatible router options instead of silently changing semantics', () => {
    for (const fixture of TARGETS) {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({
          packageName: 'mini-program-demo',
          target: fixture.target,
          router: 'react-router-v6',
          devMode: false
        })
      })

      expect(output.warnings.map(({ code }) => code)).toContain(
        `${fixture.target}-router-option-unsupported`
      )
    }
  })
})
