import { expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPopoverModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

for (const target of ['react', 'vue'] as const) {
  test(`${target} Popover compiles only a uniquely mapped direct child; ambiguous mapping fails closed`, () => {
    const graph = new SceneGraph(),
      pageId = graph.getPages()[0].id
    const host = graph.createNode(
      'FRAME',
      pageId,
      createPopoverModuleFrameOverrides({ contentChildName: 'Body', content: 'FALLBACK_BODY' })
    )
    const body = graph.createNode('TEXT', host.id, {
      name: 'Body',
      text: 'SLOTTED_BODY',
      width: 200,
      height: 30
    })
    graph.createNode('TEXT', host.id, { text: 'UNMAPPED_BODY' })
    const render = () => {
      const result = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target, router: 'none', devMode: false })
      })
      const page = result.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
      if (typeof page !== 'string') throw new Error('Missing generated page')
      return { ...result, page }
    }
    const result = render()
    expect(result.page).toContain('SLOTTED_BODY')
    expect(result.page).not.toContain('UNMAPPED_BODY')
    expect(result.page).toContain(target === 'react' ? ' content={<>' : '<template #content>')
    const ir = collectTree(graph, pageId).children.find(
      (node) => node.kind === 'element' && node.sourceId === host.id
    )
    expect(ir && 'module' in ir && ir.module?.contentSlots).toEqual([
      { name: 'content', sourceId: body.id }
    ])
    graph.createNode('TEXT', host.id, { name: 'Body', text: 'AMBIGUOUS_BODY' })
    const invalid = render()
    expect(
      invalid.warnings.some((warning) => warning.code === 'module-content-child-invalid')
    ).toBe(true)
    expect(invalid.page).not.toContain('SLOTTED_BODY')
    expect(invalid.page).not.toContain('AMBIGUOUS_BODY')
    expect(invalid.page).not.toContain('UNMAPPED_BODY')
    expect(graph.getNode(body.id)?.text).toBe('SLOTTED_BODY')
  })
}
