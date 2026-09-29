import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  createModalModuleFrameOverrides,
  createModalModuleInstance
} from '@open-pencil/core/plugins'

import { RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { createSelectionPresentation, isPresentedNode } from '#core/editor/selection/presentation'
import { collectGraphFontRequirements } from '#core/text/requirements'

test('Modal content stays editable data without covering or intercepting the ordinary trigger', () => {
  const editor = createEditor()
  try {
    const modal = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      ...createModalModuleFrameOverrides({ triggerLabel: '编辑资料', contentChildName: 'Body' }),
      width: 320,
      height: 52
    })
    const body = editor.graph.createNode('FORM', modal.id, {
      name: 'Body',
      width: 320,
      height: 300
    })
    for (let index = 0; index < 40; index++)
      editor.graph.createNode('TEXT', body.id, { text: '姓名', width: 80, height: 20 })
    const before = structuredClone(body)
    expect(editor.hitTestPageAtPoint(10, 10)?.id).toBe(modal.id)
    expect(editor.hitTestPageAtPoint(10, 200)).toBeNull()
    expect(editor.getCanvasSelectionChildren(modal.id)).toEqual([])
    expect(editor.getCanvasSelectionChildren(body.id)).toEqual([])
    const contentView = createSelectionPresentation(editor.graph, body.id)
    expect(isPresentedNode(editor.graph, body, contentView)).toBe(true)
    const nested = editor.graph.getChildren(body.id)[0]
    expect(isPresentedNode(editor.graph, nested, contentView)).toBe(true)
    expect(isPresentedNode(editor.graph, modal, contentView)).toBe(false)
    const { index } = RenderChunkIndex.build(editor.graph, editor.state.currentPageId)
    try {
      expect(index.getChunksForNode(modal.id)[0]?.kind).toBe('subtree')
      expect(index.getChunksForNode(body.id)).toEqual([])
    } finally {
      index.dispose()
    }
    const fonts = collectGraphFontRequirements(editor.graph, [modal.id])
    for (const letter of '编辑资料') expect(fonts.characters).toContain(letter)
    expect(fonts.scripts).toContain('cjk-sc')
    expect(body).toEqual(before)
  } finally {
    editor.dispose()
  }
})

test('legacy v1 trigger children remain visible, and deleting the new field restores that presentation', () => {
  const editor = createEditor()
  try {
    const module = createModalModuleInstance()
    delete module.config.contentChildName
    const modal = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      ...createModalModuleFrameOverrides(),
      interactiveProps: { module },
      width: 320,
      height: 52
    })
    const child = editor.graph.createNode('TEXT', modal.id, {
      text: '旧按钮',
      width: 80,
      height: 20
    })
    expect(editor.hitTestPageAtPoint(10, 10)?.id).toBe(child.id)
    expect(editor.getCanvasSelectionChildren(modal.id).map((node) => node.id)).toEqual([child.id])
    editor.graph.updateNode(modal.id, { interactiveProps: { module: createModalModuleInstance() } })
    expect(editor.hitTestPageAtPoint(10, 10)?.id).toBe(modal.id)
    expect(editor.getCanvasSelectionChildren(modal.id)).toEqual([])
    editor.graph.updateNode(modal.id, { interactiveProps: { module } })
    expect(editor.hitTestPageAtPoint(10, 10)?.id).toBe(child.id)
  } finally {
    editor.dispose()
  }
})
