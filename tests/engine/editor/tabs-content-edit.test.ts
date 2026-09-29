import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createTabsModuleFrameOverrides } from '@open-pencil/core/plugins'

function fixture() {
  const editor = createEditor()
  const host = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    ...createTabsModuleFrameOverrides({
      tabs: [
        { id: 'overview', label: '概览', content: '', contentChildName: '概览内容' },
        { id: 'details', label: '详情', content: '', contentChildName: '详情表单' }
      ],
      initialTabId: 'overview'
    }),
    width: 320,
    height: 550
  })
  const overview = editor.graph.createNode('FRAME', host.id, { name: '概览内容' })
  const details = editor.graph.createNode('FORM', host.id, {
    name: '详情表单',
    width: 288,
    height: 250,
    layoutMode: 'VERTICAL',
    counterAxisSizing: 'FILL',
    primaryAxisSizing: 'HUG',
    paddingLeft: 16,
    paddingRight: 16
  })
  const input = editor.graph.createNode('INPUT', details.id, {
    width: 0,
    height: 44,
    layoutAlignSelf: 'STRETCH'
  })
  return { editor, host, overview, details, input }
}

describe('Tabs content editing', () => {
  test('opens the second tab original form without changing the initial tab or adding undo history', () => {
    const { editor, host, details, input } = fixture()
    const module = structuredClone(host.interactiveProps?.module)
    expect(editor.enterContentEdit(details.id)).toBe(true)
    expect(editor.state.contentEdit?.rootId).toBe(details.id)
    expect(input.width).toBe(256)
    expect(editor.undo.canUndo).toBe(false)
    expect(host.interactiveProps?.module).toEqual(module)
    const position = editor.graph.getAbsolutePosition(input.id)
    expect(editor.hitTestPageAtPoint(position.x + 8, position.y + 8)?.id).toBe(input.id)
    editor.updateNodeWithUndo(input.id, { name: 'Updated field' })
    editor.exitContentEdit()
    expect(editor.state.selectedIds).toEqual(new Set([host.id]))
    expect(host.interactiveProps?.module).toEqual(module)
    editor.undo.undo()
    expect(input.name).not.toBe('Updated field')
    editor.dispose()
  })

  test('renaming a mapped body exits immediately and undo restores eligibility', () => {
    const { editor, details } = fixture()
    expect(editor.enterContentEdit(details.id)).toBe(true)
    editor.updateNodeWithUndo(details.id, { name: 'Other content' })
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.canEnterContentEdit(details.id)).toBe(false)
    editor.undo.undo()
    expect(editor.canEnterContentEdit(details.id)).toBe(true)
    editor.dispose()
  })

  test.each(['duplicate-layer', 'reused-mapping', 'hidden', 'locked', 'instance'] as const)(
    'rejects an ambiguous or protected body: %s',
    (kind) => {
      const { editor, host, overview, details } = fixture()
      if (kind === 'duplicate-layer') editor.graph.updateNode(overview.id, { name: details.name })
      if (kind === 'reused-mapping') {
        editor.graph.updateNode(
          host.id,
          createTabsModuleFrameOverrides({
            tabs: [
              { id: 'overview', label: 'Overview', content: '', contentChildName: details.name },
              { id: 'details', label: 'Details', content: '', contentChildName: details.name }
            ],
            initialTabId: 'overview'
          })
        )
      }
      if (kind === 'hidden') editor.graph.updateNode(details.id, { visible: false })
      if (kind === 'locked') editor.graph.updateNode(host.id, { locked: true })
      if (kind === 'instance') editor.graph.updateNode(host.id, { type: 'INSTANCE' })
      expect(editor.canEnterContentEdit(details.id)).toBe(false)
      expect(editor.enterContentEdit(details.id)).toBe(false)
      expect(editor.state.contentEdit).toBeNull()
      editor.dispose()
    }
  )
})

function textDraftFixture() {
  const current = fixture()
  const { editor, details } = current
  const renderer = {} as Parameters<typeof editor.setCanvasKit>[1]
  editor.setCanvasKit({} as Parameters<typeof editor.setCanvasKit>[0], renderer)
  editor.removeCanvasRenderer(renderer)
  const label = editor.graph.createNode('TEXT', details.id, { text: 'Original' })
  editor.enterContentEdit(details.id)
  editor.startTextEditing(label.id)
  editor.textEditor?.insert(' draft', label)
  return { ...current, label }
}

describe('Tabs content draft invalidation', () => {
  test.each(['rename', 'remove-mapping', 'duplicate'] as const)(
    '%s preserves a valid text draft before leaving its original body',
    (change) => {
      const { editor, host, overview, details, label } = textDraftFixture()
      if (change === 'rename') editor.graph.updateNode(details.id, { name: 'Renamed body' })
      if (change === 'duplicate') editor.graph.updateNode(overview.id, { name: details.name })
      if (change === 'remove-mapping')
        editor.graph.updateNode(host.id, createTabsModuleFrameOverrides())
      expect(editor.state.contentEdit).toBeNull()
      expect(editor.state.editingTextId).toBeNull()
      expect(editor.textEditor?.isActive).toBe(false)
      expect(label.text).toBe('Original draft')
      editor.undo.undo()
      expect(label.text).toBe('Original')
      editor.dispose()
    }
  )

  test.each([
    'deleted-text',
    'locked-text',
    'locked-body',
    'internal-body',
    'instance-body',
    'outside-text'
  ] as const)('mapping invalidation never commits into an unsafe draft target: %s', (change) => {
    const { editor, details, label } = textDraftFixture()
    if (change === 'deleted-text') editor.graph.deleteNode(label.id)
    if (change === 'locked-text') editor.graph.updateNode(label.id, { locked: true })
    if (change === 'locked-body') editor.graph.updateNode(details.id, { locked: true })
    if (change === 'internal-body') editor.graph.updateNode(details.id, { internalOnly: true })
    if (change === 'instance-body') editor.graph.updateNode(details.id, { type: 'INSTANCE' })
    if (change === 'outside-text') editor.graph.reparentNode(label.id, editor.state.currentPageId)
    editor.graph.updateNode(details.id, { name: 'Renamed body' })
    expect(editor.state.contentEdit).toBeNull()
    expect(editor.state.editingTextId).toBeNull()
    expect(editor.textEditor?.isActive).toBe(false)
    expect(label.text).toBe('Original')
    expect(editor.undo.canUndo).toBe(false)
    editor.dispose()
  })
})
