import type { FontManager } from '@open-pencil/core/text'
import type { SceneNode } from '@open-pencil/scene-graph'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

test.use({ viewport: { width: 1400, height: 1000 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: closed selects show labels and track their initial state without graph edits`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    await trackFontModuleResources(page)
    await mockFontsource(page, [])
    await page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const ids = await page.evaluate(async () => {
      const editor = window.openPencil.getStore()
      const graph = editor.graph
      const moduleURL = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
      if (!moduleURL) throw new Error('Font manager module not observed')
      const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
        fontManager: FontManager
      }
      const response = await fetch('/tests/fixtures/fonts/NotoSansSC-Regular.ttf')
      if (!response.ok) throw new Error('Licensed CJK font fixture unavailable')
      fontManager.markLoaded('Noto Sans SC', 'Regular', await response.arrayBuffer())
      fontManager.setCJKFallbackFamily('Noto Sans SC')
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: 'team' }]
      })
      graph.updateNode(editor.state.currentPageId, {
        state: [
          {
            id: 'choices',
            name: 'choices',
            type: 'array',
            defaultValue: [
              { id: 'team', label: '团队方案' },
              { id: 'personal', label: '个人方案' }
            ]
          }
        ]
      })
      const root = graph.createNode('FRAME', editor.state.currentPageId, {
        name: 'Select initial appearances',
        width: 500,
        height: 328,
        clipsContent: true,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
      })
      const control = (
        x: number,
        y: number,
        properties: Record<string, unknown>,
        overrides: Partial<SceneNode> = {}
      ) =>
        graph.createNode('SELECT', root.id, {
          x,
          y,
          width: 224,
          height: 44,
          cornerRadius: 8,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 4,
          paddingBottom: 4,
          fontFamily: 'Inter',
          fontSize: 14,
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
          strokes: [
            {
              color: { r: 0.78, g: 0.82, b: 0.89, a: 1 },
              weight: 1,
              opacity: 1,
              visible: true,
              align: 'INSIDE'
            }
          ],
          interactiveProps: properties,
          ...overrides
        })
      const options = [
        { label: '团队方案 Team', value: 'team_id' },
        { label: '个人方案 Personal', value: 'person_id' }
      ]
      control(16, 16, { options, value: 'team_id' })
      control(260, 16, { options, placeholder: '请选择一个方案' })
      control(16, 80, { options, value: 'person_id', disabled: true })
      control(260, 80, {
        options: [{ label: 'Disabled first', value: 'no', disabled: true }, 'First available']
      })
      control(16, 144, { options, allowClear: true })
      control(260, 144, {
        options: [{ label: '所有团队', value: '' }, ...options],
        value: '',
        placeholder: '请选择'
      })
      const bound = control(
        16,
        208,
        {
          value: 'ignored-static',
          placeholder: 'Loading',
          optionsSource: {
            kind: 'ref',
            stateId: 'choices',
            valueExpr: 'item.id',
            labelExpr: 'item.label'
          }
        },
        { bindings: { value: { kind: 'docState', docStateName: 'plan' } } }
      )
      control(
        260,
        208,
        { options: ['Very long label 超出可用宽度'], value: 'Very long label 超出可用宽度' },
        { width: 114 }
      )
      control(16, 272, {
        options: ['Should never appear'],
        value: 'Should never appear',
        placeholder: '等待运行时数据',
        optionsSource: { kind: 'ref', stateId: 'missing', labelExpr: 'item.toString()' }
      })
      control(260, 272, { options, value: 'team_id' }, { width: 28, height: 28 })
      await editor.loadFontsForNodes([root.id])
      editor.zoomToBounds(-24, -24, 524, 352)
      editor.requestRender()
      return { root: root.id, bound: bound.id, authored: structuredClone(bound.interactiveProps) }
    })
    await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
    await canvas.canvas.screenshot({ path: info.outputPath(`${renderer}-select-live-initial.png`) })
    const initial = await page.evaluate(async (id) => {
      const png = await window.openPencil.getStore().renderExportImage([id], 1, 'PNG')
      if (!png) throw new Error('Select PNG export unavailable')
      return Array.from(png)
    }, ids.root)
    expect(Buffer.from(initial)).toMatchSnapshot('select-initial.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    await page.evaluate(async () => {
      const editor = window.openPencil.getStore()
      const graph = editor.graph
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [
          { id: 'plan', name: 'plan', type: 'string', defaultValue: 'personal' }
        ]
      })
      graph.updateNode(editor.state.currentPageId, {
        state: [
          {
            id: 'choices',
            name: 'choices',
            type: 'array',
            defaultValue: [
              { id: 'team', label: '团队方案' },
              { id: 'personal', label: '个人新方案 Updated' }
            ]
          }
        ]
      })
      await editor.loadFontsForNodes(
        graph.getChildren(editor.state.currentPageId).map((node) => node.id)
      )
      editor.requestRender()
    })
    await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
    await canvas.canvas.screenshot({ path: info.outputPath(`${renderer}-select-live-updated.png`) })
    const updated = await page.evaluate(async (ids) => {
      const editor = window.openPencil.getStore()
      const png = await editor.renderExportImage([ids.root], 1, 'PNG')
      if (!png) throw new Error('Updated select PNG export unavailable')
      const node = editor.graph.getNode(ids.bound)
      return {
        png: Array.from(png),
        type: node?.type,
        children: node?.childIds,
        props: node?.interactiveProps
      }
    }, ids)
    expect(Buffer.from(updated.png)).toMatchSnapshot('select-updated.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    expect(updated.png).not.toEqual(initial)
    expect(updated).toMatchObject({ type: 'SELECT', children: [], props: ids.authored })
    canvas.assertNoErrors()
  })
}
