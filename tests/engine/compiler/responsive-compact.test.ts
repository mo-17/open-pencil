import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('compact shared IR in React and Vue', () => {
  for (const target of ['react', 'vue'] as const) {
    test(`${target}: hidden mobile navigation is emitted with an accessible name and fluid root`, () => {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      const root = graph.createNode('FRAME', pageId, {
        width: 1200,
        height: 800,
        layoutMode: 'FREE',
        responsiveOverrides: {
          compact: {
            layoutMode: 'VERTICAL',
            layoutPositioning: 'AUTO',
            primaryAxisSizing: 'HUG',
            counterAxisSizing: 'FILL'
          }
        }
      })
      graph.createNode('SELECT', root.id, {
        visible: false,
        width: 320,
        height: 44,
        interactiveProps: { ariaLabel: ' 页面导航 ', options: ['商品', '订单'] },
        responsiveOverrides: { compact: { visible: true, counterAxisSizing: 'FILL' } }
      })
      const out = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({
          target,
          packageName: 'compact-application',
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
        })
      })
      const extension = target === 'vue' ? '.vue' : '.tsx'
      const source = [...out.files]
        .filter(([path]) => path.endsWith(extension))
        .map(([, content]) => content)
        .join('\n')
      expect(source).toContain('max-xl:w-full')
      expect(source).toContain('max-xl:h-auto')
      expect(source).toContain('max-xl:static')
      expect(source).toContain('max-xl:block')
      expect(source).toContain('aria-label="页面导航"')
      expect(source).toContain('<select')
      expect(source).toContain('商品')
    })

    test(`${target}: ariaLabel is bounded to native controls and does not forward arbitrary attributes`, () => {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      for (const [type, ariaLabel] of [
        ['BUTTON', '保存'],
        ['INPUT', '名称'],
        ['TEXTAREA', '备注'],
        ['FRAME', 'not-a-control'],
        ['SELECT', '   ']
      ] as const)
        graph.createNode(type, pageId, {
          interactiveProps: { ariaLabel, 'data-unreviewed': 'must-not-forward' }
        })
      const out = compile({ graph, pageIds: [pageId], options: withDefaults({ target }) })
      const source = [...out.files]
        .filter(([path]) => /\.(tsx|vue)$/.test(path))
        .map(([, content]) => content)
        .join('\n')
      for (const label of ['保存', '名称', '备注'])
        expect(source).toContain(`aria-label="${label}"`)
      expect(source).not.toContain('aria-label="not-a-control"')
      expect(source).not.toContain('aria-label="   "')
      expect(source).not.toContain('must-not-forward')
    })
  }
})
