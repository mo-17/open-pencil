import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor/create'
import { pickEditorViewState } from '#core/editor/state/view'
import { createTabsModuleFrameOverrides } from '#core/plugins/tabs'

function fixture() {
  const editor = createEditor()
  const host = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    ...createTabsModuleFrameOverrides({
      tabs: [
        { id: 'one', label: 'One', content: '', contentChildName: 'First' },
        { id: 'two', label: 'Two', content: '', contentChildName: 'Second' }
      ],
      initialTabId: 'one'
    }),
    width: 320,
    height: 300
  })
  const panels = ['First', 'Second'].map((name) => {
    const panel = editor.graph.createNode('FRAME', host.id, {
      name,
      x: 16,
      y: 70,
      width: 288,
      height: 200
    })
    const child = editor.graph.createNode('RECTANGLE', panel.id, { width: 100, height: 100 })
    return { panel, child }
  })
  editor.select([host.id])
  return { editor, host, panels }
}

describe('temporary Tabs canvas preview', () => {
  test('changes hit testing, drop and selection presentation without changing document or undo', () => {
    const { editor, host, panels } = fixture()
    const before = structuredClone([...editor.graph.getAllNodes()])
    const sceneVersion = editor.state.sceneVersion
    expect(editor.hitTestPageAtPoint(30, 90)?.id).toBe(panels[0].child.id)
    expect(editor.previewTabsTab(host.id, 'two')).toBe(true)
    expect(editor.getTabsTabPreview(host.id)).toBe('two')
    expect(editor.hitTestPageAtPoint(30, 90)?.id).toBe(panels[1].child.id)
    expect(editor.hitTestFrameAtPoint(30, 90, new Set())?.id).toBe(panels[1].panel.id)
    expect(editor.getCanvasSelectionChildren(host.id).map((node) => node.id)).toEqual([
      panels[1].panel.id
    ])
    expect(editor.getCanvasSelectionChildren(panels[0].panel.id)).toEqual([])
    expect([...editor.graph.getAllNodes()]).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
    expect(editor.state.sceneVersion).toBe(sceneVersion)
    editor.clearTabsTabPreview('other')
    expect(editor.getTabsTabPreview(host.id)).toBe('two')
    editor.clearTabsTabPreview(host.id)
    expect(editor.hitTestPageAtPoint(30, 90)?.id).toBe(panels[0].child.id)
    expect(editor.getTabsTabPreview(host.id)).toBeUndefined()
    editor.dispose()
  })

  test('hidden selections and entered containers cannot keep editing the previous panel', () => {
    const { editor, host, panels } = fixture()
    editor.select([panels[0].child.id])
    editor.enterContainer(panels[0].panel.id)
    editor.previewTabsTab(host.id, 'two')
    expect(editor.state.selectedIds).toEqual(new Set([host.id]))
    expect(editor.state.enteredContainerId).toBeNull()
    editor.enterContainer(panels[0].panel.id)
    expect(editor.state.enteredContainerId).toBeNull()
    editor.select([panels[0].child.id])
    expect(editor.state.selectedIds).toEqual(new Set([host.id]))
    editor.select([panels[1].child.id])
    editor.clearTabsTabPreview()
    expect(editor.state.selectedIds).toEqual(new Set([host.id]))
    editor.dispose()
  })

  test('keeps preview while editing its content, clears on selecting elsewhere', () => {
    const { editor, host, panels } = fixture()
    editor.previewTabsTab(host.id, 'two')
    expect(editor.enterContentEdit(panels[1].panel.id)).toBe(true)
    expect(editor.state.selectedIds.size).toBe(0)
    expect(editor.getTabsTabPreview(host.id)).toBe('two')
    editor.exitContentEdit()
    expect(editor.getTabsTabPreview(host.id)).toBe('two')
    const outside = editor.graph.createNode('RECTANGLE', editor.state.currentPageId)
    editor.select([outside.id])
    expect(editor.getTabsTabPreview(host.id)).toBeUndefined()
    expect(editor.state.selectedIds).toEqual(new Set([outside.id]))
    editor.dispose()
  })

  test('replacing the graph with reused IDs cannot receive a preview text draft', () => {
    const { editor, host, panels } = fixture()
    const renderer = {} as Parameters<typeof editor.setCanvasKit>[1]
    editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
    editor.removeCanvasRenderer(renderer)
    const label = editor.graph.createNode('TEXT', panels[1].panel.id, { text: 'Original' })
    editor.previewTabsTab(host.id, 'two')
    editor.startTextEditing(label.id)
    editor.textEditor?.insert(' changed', label)
    const replacement = new SceneGraph()
    const replacementLabel = replacement.createNode('TEXT', replacement.getPages()[0].id, {
      id: label.id,
      text: 'Replacement'
    })
    editor.replaceGraph(replacement)
    editor.commitTextEdit()
    expect(replacementLabel.text).toBe('Replacement')
    expect(editor.textEditor?.isActive).toBe(false)
    expect(editor.state.editingTextId).toBeNull()
    expect(editor.state.tabsPreview).toBeNull()
    editor.dispose()
  })

  test('restoring a different page pane preserves its own text draft when clearing preview', () => {
    const { editor, host, panels } = fixture()
    const renderer = {} as Parameters<typeof editor.setCanvasKit>[1]
    editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
    editor.removeCanvasRenderer(renderer)
    const label = editor.graph.createNode('TEXT', panels[1].panel.id, { text: 'First pane' })
    editor.previewTabsTab(host.id, 'two')
    const firstPane = pickEditorViewState(editor.state)
    const otherPage = editor.graph.addPage('Second page')
    const otherHost = editor.graph.createNode(
      'FRAME',
      otherPage.id,
      createTabsModuleFrameOverrides()
    )
    editor.state.currentPageId = otherPage.id
    editor.previewTabsTab(otherHost.id, 'details')
    Object.assign(editor.state, pickEditorViewState({ ...editor.state, ...firstPane }))
    editor.startTextEditing(label.id)
    editor.textEditor?.insert(' updated', label)
    editor.clearTabsTabPreview()
    expect(label.text).toBe('First pane updated')
    expect(editor.textEditor?.isActive).toBe(false)
    editor.dispose()
  })

  test('remapping the previewed tab finishes text before the old panel becomes hidden', () => {
    const { editor, host, panels } = fixture()
    const renderer = {} as Parameters<typeof editor.setCanvasKit>[1]
    editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
    editor.removeCanvasRenderer(renderer)
    const label = editor.graph.createNode('TEXT', panels[1].panel.id, { text: 'Original' })
    editor.previewTabsTab(host.id, 'two')
    editor.startTextEditing(label.id)
    editor.textEditor?.insert(' changed', label)
    const nextPanel = editor.graph.createNode('FRAME', host.id, { name: 'Replacement panel' })
    editor.graph.updateNode(
      host.id,
      createTabsModuleFrameOverrides({
        tabs: [
          { id: 'one', label: 'One', content: '', contentChildName: 'First' },
          { id: 'two', label: 'Two', content: '', contentChildName: nextPanel.name }
        ],
        initialTabId: 'one'
      })
    )
    expect(label.text).toBe('Original changed')
    expect(editor.textEditor?.isActive).toBe(false)
    expect(editor.state.editingTextId).toBeNull()
    expect(editor.getCanvasSelectionChildren(host.id).map((node) => node.id)).toEqual([
      nextPanel.id
    ])
    editor.dispose()
  })

  test('manual clearing commits an actual text edit before hiding its panel', () => {
    const { editor, host, panels } = fixture()
    const renderer = {} as Parameters<typeof editor.setCanvasKit>[1]
    editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
    editor.removeCanvasRenderer(renderer)
    const label = editor.graph.createNode('TEXT', panels[1].panel.id, { text: 'Original' })
    editor.previewTabsTab(host.id, 'two')
    editor.startTextEditing(label.id)
    editor.textEditor?.insert(' changed', label)
    editor.clearTabsTabPreview()
    expect(label.text).toBe('Original changed')
    expect(editor.textEditor?.isActive).toBe(false)
    editor.undo.undo()
    expect(label.text).toBe('Original')
    editor.dispose()
  })

  test.each(['hidden', 'renamed', 'duplicate'] as const)('rejects %s mapped content', (kind) => {
    const { editor, host, panels } = fixture()
    if (kind === 'hidden') editor.graph.updateNode(panels[1].panel.id, { visible: false })
    if (kind === 'renamed') editor.graph.updateNode(panels[1].panel.id, { name: 'Moved' })
    if (kind === 'duplicate') editor.graph.updateNode(panels[0].panel.id, { name: 'Second' })
    expect(editor.previewTabsTab(host.id, 'two')).toBe(false)
    editor.dispose()
  })

  test('rejects invalid targets and clears when host config becomes invalid', () => {
    const { editor, host } = fixture()
    expect(editor.previewTabsTab(host.id, 'missing')).toBe(false)
    expect(editor.previewTabsTab(editor.state.currentPageId, 'one')).toBe(false)
    editor.previewTabsTab(host.id, 'two')
    editor.graph.updateNode(host.id, { interactiveProps: {} })
    expect(editor.state.tabsPreview).toBeNull()
    editor.dispose()
  })

  test.each(['page', 'graph', 'delete', 'hidden'] as const)(
    'clears after %s boundary',
    async (boundary) => {
      const { editor, host } = fixture()
      editor.previewTabsTab(host.id, 'two')
      if (boundary === 'page') {
        const page = editor.graph.createNode('CANVAS', editor.graph.rootId)
        await editor.switchPage(page.id)
      }
      if (boundary === 'graph') editor.replaceGraph(new SceneGraph())
      if (boundary === 'delete') editor.graph.deleteNode(host.id)
      if (boundary === 'hidden') editor.graph.updateNode(host.id, { visible: false })
      expect(editor.state.tabsPreview).toBeNull()
      editor.dispose()
    }
  )
})
