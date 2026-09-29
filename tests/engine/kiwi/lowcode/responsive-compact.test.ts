import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import { SceneGraph, type ResponsiveOverrides } from '@open-pencil/scene-graph'

describe('compact responsive .fig contract', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('editable desktop geometry, mobile grid / text fields, and named navigation survive round-trip', async () => {
    const graph = new SceneGraph()
    const overrides: ResponsiveOverrides = {
      compact: {
        layoutMode: 'GRID',
        layoutPositioning: 'AUTO',
        x: 0,
        y: 0,
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'FILL',
        primaryAxisAlign: 'MIN',
        gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
        gridTemplateRows: [{ sizing: 'AUTO', value: 0 }],
        gridColumnGap: 0,
        gridRowGap: 16,
        fontSize: 18,
        lineHeight: 28,
        minWidth: 0,
        maxWidth: null,
        minHeight: 44,
        maxHeight: null,
        clipsContent: false
      },
      md: { itemSpacing: 24 },
      xl: { itemSpacing: 8 }
    }
    const root = graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Desktop and mobile',
      x: 24,
      y: 32,
      width: 1200,
      height: 800,
      responsiveOverrides: overrides
    })
    graph.createNode('SELECT', root.id, {
      name: 'Mobile navigation',
      visible: false,
      interactiveProps: { ariaLabel: '页面导航', options: ['首页', '账号'] },
      responsiveOverrides: { compact: { visible: true, counterAxisSizing: 'FILL', minHeight: 44 } }
    })
    const archive = await exportFigFile(graph)
    const restored = await parseFigFile(archive.buffer)
    const restoredRoot = [...restored.getAllNodes()].find((node) => node.name === root.name)
    const nav = [...restored.getAllNodes()].find((node) => node.name === 'Mobile navigation')
    expect(restoredRoot).toMatchObject({ width: 1200, height: 800, x: 24, y: 32 })
    expect(restoredRoot?.responsiveOverrides).toEqual(overrides)
    expect(nav).toMatchObject({
      type: 'SELECT',
      visible: false,
      interactiveProps: { ariaLabel: '页面导航', options: ['首页', '账号'] },
      responsiveOverrides: { compact: { visible: true, counterAxisSizing: 'FILL', minHeight: 44 } }
    })
    for (const target of ['react', 'vue'] as const) {
      const compiled = compile({
        graph: restored,
        pageIds: restored.getPages().map((page) => page.id),
        options: withDefaults({ target })
      })
      const source = [...compiled.files]
        .filter(([path]) => /\.(tsx|vue)$/.test(path))
        .map(([, content]) => content)
        .join('\n')
      expect(source).toContain('max-xl:grid-cols-1')
      expect(source).toContain('max-xl:[align-content:start]')
      expect(source).toContain('max-xl:w-full')
      expect(source).toContain('max-xl:h-auto')
      expect(source).toContain('max-xl:relative')
      expect(source).toContain('aria-label="页面导航"')
    }
  })
})
