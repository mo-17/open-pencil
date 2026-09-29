import { beforeAll, describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { createModalModuleFrameOverrides, resolveModalModule } from '@open-pencil/core/plugins'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

function nodeNamed(graph: SceneGraph, name: string): SceneNode {
  const matches = [...graph.getAllNodes()].filter((node) => node.name === name)
  if (matches.length !== 1) throw new Error('Expected one restored node named ' + name)
  return matches[0]
}

async function roundTrip(graph: SceneGraph): Promise<SceneGraph> {
  const bytes = await exportFigFile(graph)
  return parseFigFile(Uint8Array.from(bytes).buffer)
}

describe('Modal custom content FIG round trips', () => {
  beforeAll(initCodec)

  test.each(['FRAME', 'FORM', 'TEXT'] as const)(
    '%s mapping and authored content survive two save/reopen cycles',
    async (type) => {
      let graph = new SceneGraph()
      const pageId = graph.getPages()[0].id
      const bodyName = '正文 "Profile" 组件'
      const modal = graph.createNode('FRAME', pageId, {
        ...createModalModuleFrameOverrides({
          triggerLabel: '编辑资料',
          content: '旧版说明',
          contentChildName: bodyName
        }),
        name: 'Custom content modal'
      })
      const body = graph.createNode(type, modal.id, {
        name: bodyName,
        x: 80,
        y: 60,
        width: 320,
        height: 120,
        ...(type === 'TEXT'
          ? { text: '中文与 English custom content' }
          : { layoutMode: 'VERTICAL', itemSpacing: 12 })
      })
      if (type !== 'TEXT') {
        graph.createNode('INPUT', body.id, {
          name: 'Custom field',
          width: 280,
          height: 44,
          interactiveProps: { placeholder: '请输入内容', validation: { required: true } }
        })
      }
      const expectedModule = structuredClone(modal.interactiveProps?.module)
      for (let cycle = 0; cycle < 2; cycle++) {
        graph = await roundTrip(graph)
        const restoredModal = nodeNamed(graph, modal.name)
        const restoredBody = nodeNamed(graph, bodyName)
        expect(restoredModal.interactiveProps?.module).toEqual(expectedModule)
        const resolution = resolveModalModule(restoredModal.interactiveProps?.module)
        if (!resolution?.ok) throw new Error('Restored Modal configuration is invalid')
        expect(resolution.config.contentChildName).toBe(bodyName)
        expect(restoredBody).toMatchObject({
          type,
          x: 80,
          y: 60,
          width: 320,
          height: 120,
          visible: true,
          parentId: restoredModal.id
        })
        if (type === 'TEXT') expect(restoredBody.text).toBe('中文与 English custom content')
        else {
          expect(restoredBody.layoutMode).toBe('VERTICAL')
          expect(nodeNamed(graph, 'Custom field')).toMatchObject({
            parentId: restoredBody.id,
            interactiveProps: { placeholder: '请输入内容', validation: { required: true } }
          })
        }
        const ir = collectTree(graph, graph.getPages()[0].id)
        const element = ir.children.find(
          (node) => node.kind === 'element' && node.sourceId === restoredModal.id
        )
        if (element?.kind !== 'element') throw new Error('Restored Modal IR is missing')
        expect(element.module?.contentSlots).toEqual([
          { name: 'content', sourceId: restoredBody.id }
        ])
        expect(ir.warnings.filter((warning) => warning.code.startsWith('module-content'))).toEqual(
          []
        )
      }
    }
  )

  test('preserves hidden duplicate names as invalid instead of silently choosing a body', async () => {
    const graph = new SceneGraph()
    const modal = graph.createNode(
      'FRAME',
      graph.getPages()[0].id,
      createModalModuleFrameOverrides({ contentChildName: 'Body' })
    )
    graph.createNode('FRAME', modal.id, { name: 'Body', visible: true })
    graph.createNode('TEXT', modal.id, { name: 'Body', visible: false, text: 'Hidden duplicate' })
    const restored = await roundTrip(graph)
    const restoredModal = nodeNamed(restored, modal.name)
    const children = restored.getChildren(restoredModal.id)
    expect(children.map((child) => ({ name: child.name, visible: child.visible }))).toEqual([
      { name: 'Body', visible: true },
      { name: 'Body', visible: false }
    ])
    const ir = collectTree(restored, restored.getPages()[0].id)
    const element = ir.children.find(
      (node) => node.kind === 'element' && node.sourceId === restoredModal.id
    )
    if (element?.kind !== 'element') throw new Error('Restored Modal IR is missing')
    expect(element.module?.contentSlots).toEqual([{ name: 'content', sourceId: null }])
    expect(ir.warnings.some((warning) => warning.code === 'module-content-child-invalid')).toBe(
      true
    )
  })
})
