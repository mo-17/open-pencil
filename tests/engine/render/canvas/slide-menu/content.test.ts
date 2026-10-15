import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createSlideMenuModuleFrameOverrides } from '@open-pencil/core/plugins'

import { renderSlideMenuModulePreview } from '#core/canvas/modules'
import { RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { modalHidesContent, resolveModalContent } from '#core/plugins/content/modal'
import { collectGraphFontRequirements } from '#core/text/requirements'

import { canvasMock, createMockCanvas } from '#tests/engine/render/canvas/effects/helpers'
import { asCanvas } from '#tests/engine/render/canvas/helpers'
import { expectModuleInstance } from '#tests/helpers/assert'

import { moduleTextRenderer, paragraphText } from '../modules/helpers'

test('mapped drawer content stays in its own editable layout and cannot intercept the closed trigger', () => {
  const editor = createEditor()
  try {
    const host = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      ...createSlideMenuModuleFrameOverrides({
        contentChildName: 'Drawer form',
        triggerLabel: '编辑抽屉'
      }),
      layoutMode: 'HORIZONTAL'
    })
    const body = editor.graph.createNode('FORM', host.id, {
      name: 'Drawer form',
      width: 400,
      height: 280,
      layoutMode: 'VERTICAL',
      itemSpacing: 12
    })
    const first = editor.graph.createNode('INPUT', body.id, { width: 360, height: 44 })
    const field = editor.graph.createNode('INPUT', body.id, { width: 360, height: 44 })
    editor.runLayoutForNode(host.id)
    expect(host).toMatchObject({ width: 180, height: 48 })
    expect(body).toMatchObject({ width: 400, height: 280 })
    expect(field.y - first.y).toBe(56)
    expect(modalHidesContent(host)).toBe(true)
    expect(resolveModalContent(editor.graph, host)?.id).toBe(body.id)
    expect(editor.hitTestPageAtPoint(10, 10)?.id).toBe(host.id)
    expect(editor.hitTestPageAtPoint(10, 180)).toBeNull()
    expect(editor.getCanvasSelectionChildren(host.id)).toEqual([])
    const { index } = RenderChunkIndex.build(editor.graph, editor.state.currentPageId)
    try {
      expect(index.getChunksForNode(body.id)).toEqual([])
    } finally {
      index.dispose()
    }
    for (const character of '编辑抽屉')
      expect(collectGraphFontRequirements(editor.graph, [host.id]).characters).toContain(character)
    const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(renderSlideMenuModulePreview(moduleTextRenderer(), asCanvas(canvas), host)).toBe(true)
    expect(canvas.drawParagraph.mock.calls.map((call) => paragraphText(call[0]))).toEqual([
      '编辑抽屉'
    ])
    expect(editor.enterContentEdit(body.id)).toBe(true)
    editor.exitContentEdit()
    editor.graph.createNode('FORM', host.id, { name: body.name, visible: false })
    expect(resolveModalContent(editor.graph, host)).toBeNull()
    expect(editor.enterContentEdit(body.id)).toBe(false)
  } finally {
    editor.dispose()
  }
})

test('unreviewed frames and legacy drawer children preserve ordinary presentation', () => {
  const editor = createEditor()
  try {
    const host = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createSlideMenuModuleFrameOverrides()
    )
    const child = editor.graph.createNode('TEXT', host.id, {
      text: 'Authored trigger',
      width: 100,
      height: 30
    })
    expect(modalHidesContent(host)).toBe(false)
    expect(editor.getCanvasSelectionChildren(host.id).map((node) => node.id)).toEqual([child.id])
    const module = expectModuleInstance(host.interactiveProps?.module)
    if (!module) throw new Error('Drawer envelope unavailable')
    editor.graph.updateNode(host.id, {
      interactiveProps: {
        module: {
          ...module,
          pluginId: 'unknown.drawer',
          config: { ...module.config, contentChildName: child.name }
        }
      }
    })
    expect(modalHidesContent(host)).toBe(false)
    expect(resolveModalContent(editor.graph, host)).toBeNull()
  } finally {
    editor.dispose()
  }
})
