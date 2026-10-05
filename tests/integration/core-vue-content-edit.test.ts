import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createSceneGeometry } from '@open-pencil/core/geometry'
import { createModalModuleInstance } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { handleDrawMove, startShapeDraw } from '#vue/shared/input/draw'
import { reparentOutsideNodes } from '#vue/shared/input/drop-target'
import type { DragState } from '#vue/shared/input/types'

function fixture() {
  const editor = createEditor()
  const hostId = editor.createShape('FRAME', 100, 200, 200, 52, undefined, 'Modal', {
    interactiveProps: { module: createModalModuleInstance({ contentChildName: 'Body' }) }
  })
  const rootId = editor.createShape('FRAME', 12, 24, 400, 300, hostId, 'Body')
  const childId = editor.createShape('INPUT', 30, 40, 100, 40, rootId)
  const outsideId = editor.createShape('RECTANGLE', 1000, 1000, 100, 100)
  return { editor, hostId, rootId, childId, outsideId }
}

describe('isolated Modal content editing', () => {
  test('finishes a body path before exiting and a later Enter cannot create a page vector', () => {
    const { editor, rootId } = fixture()
    const pageChildren = editor.graph.getChildren(editor.state.currentPageId).map((node) => node.id)
    editor.enterContentEdit(rootId)
    editor.setTool('PEN')
    editor.penAddVertex(130, 260)
    editor.penAddVertex(180, 290)
    editor.exitContentEdit()
    const paths = editor.graph.getChildren(rootId).filter((node) => node.type === 'VECTOR')
    expect(paths).toHaveLength(1)
    expect(paths[0].vectorNetwork?.vertices).toHaveLength(2)
    expect(editor.state.penState).toBeNull()
    expect(editor.state.activeTool).toBe('SELECT')
    const size = editor.graph.nodes.size
    editor.penCommit(false)
    expect(editor.graph.nodes.size).toBe(size)
    expect(editor.graph.getChildren(editor.state.currentPageId).map((node) => node.id)).toEqual(
      pageChildren
    )
    editor.dispose()
  })

  test('discards a single unfinished anchor and preserves an external selection when finishing a path', () => {
    const { editor, rootId, outsideId } = fixture()
    editor.enterContentEdit(rootId)
    editor.penAddVertex(130, 260)
    editor.exitContentEdit()
    expect(editor.state.penState).toBeNull()
    expect(editor.graph.getChildren(rootId).filter((node) => node.type === 'VECTOR')).toHaveLength(
      0
    )
    editor.enterContentEdit(rootId)
    editor.penAddVertex(130, 260)
    editor.penAddVertex(180, 290)
    editor.select([outsideId])
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state.selectedIds).toEqual(new Set([outsideId]))
    expect(editor.graph.getChildren(rootId).filter((node) => node.type === 'VECTOR')).toHaveLength(
      1
    )
    editor.dispose()
  })

  test('a text body cannot start a pen path or throw when Enter is pressed', () => {
    const { editor, rootId } = fixture()
    editor.graph.updateNode(rootId, { type: 'TEXT', text: 'Editable content' })
    editor.enterContentEdit(rootId)
    editor.setTool('PEN')
    const size = editor.graph.nodes.size
    editor.penAddVertex(130, 260)
    editor.penAddVertex(180, 290)
    expect(editor.state.penState).toBeNull()
    expect(() => editor.penCommit(false)).not.toThrow()
    expect(editor.graph.nodes.size).toBe(size)
    editor.dispose()
  })

  test('entering body editing finishes an existing page path before changing its insertion target', () => {
    const { editor, rootId } = fixture()
    editor.penAddVertex(10, 10)
    editor.penAddVertex(30, 30)
    editor.enterContentEdit(rootId)
    expect(editor.state.penState).toBeNull()
    expect(
      editor.graph.getChildren(editor.state.currentPageId).filter((node) => node.type === 'VECTOR')
    ).toHaveLength(1)
    expect(editor.graph.getChildren(rootId).filter((node) => node.type === 'VECTOR')).toHaveLength(
      0
    )
    editor.dispose()
  })

  test('normal exit commits typed body text with undo and closes the text editor', () => {
    const { editor, rootId } = fixture()
    const renderer = {} as Parameters<typeof editor.setCanvasKit>[1]
    editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
    editor.removeCanvasRenderer(renderer)
    const label = editor.graph.createNode('TEXT', rootId, { text: 'Body' })
    editor.enterContentEdit(rootId)
    editor.startTextEditing(label.id)
    editor.textEditor?.insert(' updated', label)
    editor.exitContentEdit()
    expect(editor.graph.getNode(label.id)?.text).toBe('Body updated')
    expect(editor.state.editingTextId).toBeNull()
    expect(editor.textEditor?.isActive).toBe(false)
    editor.undo.undo()
    expect(editor.graph.getNode(label.id)?.text).toBe('Body')
    editor.dispose()
  })

  test('replacement documents with reused IDs never receive stale pen or text edits', () => {
    const { editor, rootId } = fixture()
    const renderer = {} as Parameters<typeof editor.setCanvasKit>[1]
    editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
    editor.removeCanvasRenderer(renderer)
    const label = editor.graph.createNode('TEXT', rootId, { text: 'Old body' })
    editor.enterContentEdit(rootId)
    editor.startTextEditing(label.id)
    editor.textEditor?.insert(' changed', label)
    editor.penAddVertex(130, 260)
    editor.penAddVertex(180, 290)
    const replacement = new SceneGraph()
    const nextLabel = replacement.createNode('TEXT', replacement.getPages()[0].id, {
      id: label.id,
      text: 'New document'
    })
    editor.replaceGraph(replacement)
    const size = replacement.nodes.size
    editor.penCommit(false)
    editor.commitTextEdit()
    expect(editor.state.penState).toBeNull()
    expect(editor.state.editingTextId).toBeNull()
    expect(editor.textEditor?.isActive).toBe(false)
    expect(replacement.nodes.size).toBe(size)
    expect(replacement.getNode(nextLabel.id)?.text).toBe('New document')
    editor.dispose()
  })

  test('edits the original graph and restores the viewport and trigger without creating history', () => {
    const { editor, rootId, hostId, childId } = fixture()
    const graph = editor.graph
    editor.state.panX = 44
    editor.state.panY = 55
    editor.state.zoom = 2
    const sceneBefore = editor.state.sceneVersion
    expect(editor.enterContentEdit(rootId)).toBe(true)
    expect(editor.state.sceneVersion).toBeGreaterThan(sceneBefore)
    expect(editor.graph).toBe(graph)
    expect(editor.state.enteredContainerId).toBe(rootId)
    editor.select([childId])
    editor.updateNodeWithUndo(childId, { width: 180 })
    const sceneBeforeExit = editor.state.sceneVersion
    editor.exitContentEdit()
    expect(editor.state.sceneVersion).toBeGreaterThan(sceneBeforeExit)
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state).toMatchObject({ panX: 44, panY: 55, zoom: 2 })
    expect(editor.state.selectedIds).toEqual(new Set([hostId]))
    editor.undo.undo()
    expect(graph.getNode(childId)?.width).toBe(100)
    editor.dispose()
  })

  test('selection and hit tests stay within content; selecting an external layer exits', () => {
    const { editor, rootId, childId, outsideId } = fixture()
    editor.enterContentEdit(rootId)
    editor.selectAll()
    expect(editor.state.selectedIds).toEqual(new Set([childId]))
    editor.selectInverse()
    expect(editor.state.selectedIds.size).toBe(0)
    expect(editor.hitTestPageAtPoint(147, 269)?.id).toBe(childId)
    expect(editor.hitTestPageAtPoint(1050, 1050)).toBeNull()
    editor.exitContainer()
    expect(editor.state.enteredContainerId).toBe(rootId)
    editor.select([outsideId])
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state.selectedIds).toEqual(new Set([outsideId]))
    editor.dispose()
  })

  test('duplicate and redo selections outside the root exit while preserving the requested selection', () => {
    const { editor, rootId } = fixture()
    editor.state.panX = 44
    editor.state.panY = 55
    editor.state.zoom = 2
    editor.enterContentEdit(rootId)
    editor.select([rootId])
    editor.duplicateSelected(editor.getSelectedNodes())
    const duplicateId = [...editor.state.selectedIds][0]
    expect(editor.graph.getNode(duplicateId)?.name).toBe('Body copy')
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state).toMatchObject({ panX: 44, panY: 55, zoom: 2 })
    expect(editor.state.selectedIds).toEqual(new Set([duplicateId]))
    editor.undo.undo()
    expect(editor.state.selectedIds).toEqual(new Set([rootId]))
    editor.enterContentEdit(rootId)
    editor.undo.redo()
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state.selectedIds).toEqual(new Set([duplicateId]))
    expect(editor.state).toMatchObject({ panX: 44, panY: 55, zoom: 2 })
    editor.dispose()
  })

  test('undo and additive external selections preserve their exact selection on scope exit', () => {
    const { editor, rootId, childId, outsideId } = fixture()
    editor.select([outsideId])
    editor.duplicateSelected(editor.getSelectedNodes())
    editor.enterContentEdit(rootId)
    editor.undo.undo()
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state.selectedIds).toEqual(new Set([outsideId]))
    editor.enterContentEdit(rootId)
    editor.select([childId])
    editor.select([outsideId], true)
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state.selectedIds).toEqual(new Set([childId, outsideId]))
    editor.dispose()
  })

  test('drawing in a transformed host stores local coordinates and cannot drag-reparent outside', () => {
    const { editor, rootId, hostId } = fixture()
    editor.graph.updateNode(hostId, { rotation: 30, flipX: true })
    editor.enterContentEdit(rootId)
    const root = editor.graph.getNode(rootId)
    if (!root) throw new Error('Missing content root')
    const geometry = createSceneGeometry(editor.graph)
    const start = geometry.toWorld(root, { x: 40, y: 50 })
    const end = geometry.toWorld(root, { x: 140, y: 120 })
    editor.setTool('RECTANGLE')
    let drag: DragState | undefined
    startShapeDraw(start.x, start.y, editor, (value) => {
      drag = value
    })
    if (drag?.type !== 'draw') throw new Error('Missing draw gesture')
    handleDrawMove(drag, end.x, end.y, false)
    drag.commit()
    const created = editor.graph.getNode(drag.nodeId)
    expect(created?.parentId).toBe(rootId)
    expect(created?.x).toBeCloseTo(40)
    expect(created?.y).toBeCloseTo(50)
    expect(created?.width).toBeCloseTo(100)
    expect(created?.height).toBeCloseTo(70)
    editor.graph.updateNode(drag.nodeId, { x: 900 })
    reparentOutsideNodes(editor)
    expect(editor.graph.getNode(drag.nodeId)?.parentId).toBe(rootId)
    editor.dispose()
  })

  test('invalidated mappings, deleted content and replacement documents release the view', () => {
    for (const invalidate of ['rename', 'delete', 'replace', 'duplicate'] as const) {
      const { editor, rootId, hostId } = fixture()
      editor.enterContentEdit(rootId)
      if (invalidate === 'rename') editor.graph.updateNode(rootId, { name: 'Unmapped' })
      else if (invalidate === 'duplicate') editor.createShape('FRAME', 0, 0, 50, 50, hostId, 'Body')
      else if (invalidate === 'delete') editor.graph.deleteNode(rootId)
      else editor.replaceGraph(new SceneGraph())
      expect(editor.state.contentEdit).toBeNull()
      expect(editor.state.enteredContainerId).toBeNull()
      editor.dispose()
    }
  })

  test('page switching never saves the temporary content viewport as the page viewport', async () => {
    const { editor, rootId } = fixture()
    const originalPage = editor.state.currentPageId
    const other = editor.graph.createNode('CANVAS', editor.graph.rootId, { name: 'Other page' })
    editor.state.panX = 44
    editor.state.panY = 55
    editor.state.zoom = 2
    editor.enterContentEdit(rootId)
    await editor.switchPage(other.id)
    expect(editor.state.contentEdit).toBeNull()
    await editor.switchPage(originalPage)
    expect(editor.state).toMatchObject({ panX: 44, panY: 55, zoom: 2 })
    editor.dispose()
  })

  test('a file finishing after content editing ends cannot insert into the page', async () => {
    const { editor, rootId } = fixture()
    editor.enterContentEdit(rootId)
    let finishRead: (value: string) => void = () => undefined
    const file = new File([''], 'late.svg', { type: 'image/svg+xml' })
    file.text = () =>
      new Promise<string>((resolve) => {
        finishRead = resolve
      })
    const before = editor.graph.nodes.size
    const placing = editor.placeFiles([file], 200, 250)
    editor.exitContentEdit()
    finishRead('<svg width="10" height="10"><rect width="10" height="10" fill="#f00"/></svg>')
    await placing
    expect(editor.graph.nodes.size).toBe(before)
    editor.dispose()
  })

  test('a text content root remains editable and rejects child insertion', () => {
    const { editor, rootId } = fixture()
    editor.graph.updateNode(rootId, { type: 'TEXT', text: 'Editable content' })
    editor.enterContentEdit(rootId)
    expect(editor.hitTestPageAtPoint(120, 230)?.id).toBe(rootId)
    expect(editor.getContentEditInsertionParent()).toBeNull()
    editor.selectAll()
    expect(editor.state.selectedIds).toEqual(new Set([rootId]))
    const before = editor.graph.nodes.size
    editor.setTool('RECTANGLE')
    startShapeDraw(120, 230, editor, () => {
      throw new Error('Should not begin a draw')
    })
    expect(editor.graph.nodes.size).toBe(before)
    editor.select([rootId])
    editor.updateNodeWithUndo(rootId, { text: 'Updated content' })
    expect(editor.graph.getNode(rootId)?.text).toBe('Updated content')
    expect(editor.state.contentEdit?.rootId).toBe(rootId)
    editor.dispose()
  })

  test('locked, internal, instance and ambiguous content is rejected', () => {
    for (const kind of ['locked', 'internal', 'instance', 'duplicate'] as const) {
      const { editor, hostId, rootId } = fixture()
      if (kind === 'locked') editor.graph.updateNode(hostId, { locked: true })
      else if (kind === 'internal') editor.graph.updateNode(hostId, { internalOnly: true })
      else if (kind === 'instance') editor.graph.updateNode(hostId, { type: 'INSTANCE' })
      else editor.createShape('FRAME', 0, 0, 10, 10, hostId, 'Body')
      expect(editor.enterContentEdit(rootId)).toBe(false)
      expect(editor.state.contentEdit).toBeNull()
      editor.dispose()
    }
  })
})
