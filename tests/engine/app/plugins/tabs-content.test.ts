import { afterEach, describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  createTabsModuleFrameOverrides,
  createTabsModuleInstance,
  resolveTabsModule,
  type TabsItemV1
} from '@open-pencil/core/plugins'

import { createTabsContentActions, inspectTabsContent } from '@/app/lowcode/tabs-content'

const editors: ReturnType<typeof createEditor>[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

function fixture() {
  const editor = createEditor()
  editors.push(editor)
  const tabs: TabsItemV1[] = [
    { id: 'overview', label: 'Overview', content: 'Kept text', contentChildName: 'Overview body' },
    { id: 'details', label: 'Details', content: 'Legacy text', contentChildName: 'Details body' },
    { id: 'notes', label: 'Notes', content: 'Plain text', contentChildName: '' }
  ]
  const owner = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createTabsModuleFrameOverrides({ tabs, initialTabId: 'overview' })
  )
  const overview = editor.graph.createNode('FRAME', owner.id, { name: 'Overview body' })
  const details = editor.graph.createNode('FRAME', owner.id, { name: 'Details body' })
  editor.select([owner.id])
  editor.undo.clear()
  const actions = createTabsContentActions(editor)
  const inspect = () => inspectTabsContent(editor.graph, owner, editor.canEnterContentEdit)
  const request = { owner, tabId: 'details', contentChildName: details.name }
  function changeTabs(next: TabsItemV1[]) {
    editor.graph.updateNode(owner.id, {
      interactiveProps: {
        module: createTabsModuleInstance({ tabs: next, initialTabId: 'overview' })
      }
    })
  }
  return { editor, owner, overview, details, tabs, actions, inspect, request, changeTabs }
}

describe('Tabs content source and editor actions', () => {
  test('distinguishes editable child content from text without changing either authored source', () => {
    const { owner, overview, details, inspect } = fixture()
    const before = structuredClone(owner.interactiveProps)
    expect(inspect()).toEqual({
      overview: {
        mode: 'mapped',
        childId: overview.id,
        contentChildName: overview.name,
        canView: true,
        canEdit: true
      },
      details: {
        mode: 'mapped',
        childId: details.id,
        contentChildName: details.name,
        canView: true,
        canEdit: true
      },
      notes: { mode: 'text', canView: true, canEdit: false }
    })
    expect(owner.interactiveProps).toEqual(before)
  })

  test.each(['missing', 'ambiguous', 'reused', 'internal'] as const)(
    'invalid %s mapping never falls back to retained text or enables canvas actions',
    (kind) => {
      const { editor, owner, details, tabs, actions, inspect, request, changeTabs } = fixture()
      if (kind === 'missing') editor.graph.deleteNode(details.id)
      if (kind === 'ambiguous') editor.graph.createNode('FRAME', owner.id, { name: details.name })
      if (kind === 'reused')
        changeTabs(tabs.map((tab) => ({ ...tab, contentChildName: details.name })))
      if (kind === 'internal') editor.graph.updateNode(details.id, { internalOnly: true })
      expect(inspect().details).toEqual({
        mode: 'invalid',
        contentChildName: details.name,
        canView: false,
        canEdit: false
      })
      expect(actions.viewTabContent(request)).toBe(false)
      expect(actions.editTabContent(request)).toBe(false)
      expect(editor.state.contentEdit).toBeNull()
      expect(editor.getTabsTabPreview(owner.id)).toBeUndefined()
    }
  )

  test('hidden content cannot be viewed; visible locked content can only be viewed', () => {
    const { editor, details, inspect, actions, request } = fixture()
    editor.graph.updateNode(details.id, { visible: false })
    expect(inspect().details).toMatchObject({ mode: 'mapped', canView: false, canEdit: false })
    expect(actions.viewTabContent(request)).toBe(false)
    editor.graph.updateNode(details.id, { visible: true, locked: true })
    expect(inspect().details).toMatchObject({ mode: 'mapped', canView: true, canEdit: false })
    expect(actions.viewTabContent(request)).toBe(true)
    expect(actions.editTabContent(request)).toBe(false)
    expect(editor.state.contentEdit).toBeNull()
  })

  test('viewing and editing the second tab preserves the initial tab, graph, and undo history', () => {
    const { editor, owner, details, actions, request } = fixture()
    const before = structuredClone(owner.interactiveProps)
    expect(actions.viewTabContent(request)).toBe(true)
    expect(editor.getTabsTabPreview(owner.id)).toBe('details')
    expect(actions.editTabContent(request)).toBe(true)
    expect(editor.state.contentEdit?.rootId).toBe(details.id)
    editor.exitContentEdit()
    expect(editor.state.selectedIds).toEqual(new Set([owner.id]))
    expect(editor.getTabsTabPreview(owner.id)).toBe('details')
    actions.resetTabsPreview(owner)
    expect(editor.getTabsTabPreview(owner.id)).toBeUndefined()
    expect(owner.interactiveProps).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('empty and absent mappings both support text preview after switching back from a child', () => {
    const { editor, owner, tabs, actions, changeTabs } = fixture()
    expect(actions.viewTabContent({ owner, tabId: 'notes', contentChildName: '' })).toBe(true)
    expect(actions.viewTabContent({ owner, tabId: 'notes' })).toBe(true)
    changeTabs(tabs.map((tab) => (tab.id === 'details' ? { ...tab, contentChildName: '' } : tab)))
    expect(actions.viewTabContent({ owner, tabId: 'details', contentChildName: '' })).toBe(true)
    expect(actions.editTabContent({ owner, tabId: 'details', contentChildName: '' })).toBe(false)
    const parsed = resolveTabsModule(owner.interactiveProps?.module)
    expect(parsed?.ok && parsed.config.tabs[1].content).toBe('Legacy text')
    expect(editor.state.contentEdit).toBeNull()
  })

  test('late requests from a previous selection, owner identity, or mapping are rejected', () => {
    const { editor, owner, details, tabs, actions, request, changeTabs } = fixture()
    editor.select([details.id])
    expect(actions.viewTabContent(request)).toBe(false)
    expect(actions.editTabContent(request)).toBe(false)
    editor.select([owner.id])
    expect(actions.viewTabContent({ ...request, owner: structuredClone(owner) })).toBe(false)
    changeTabs(tabs.map((tab) => (tab.id === 'details' ? { ...tab, contentChildName: '' } : tab)))
    expect(actions.viewTabContent(request)).toBe(false)
    expect(actions.editTabContent(request)).toBe(false)
    expect(editor.getTabsTabPreview(owner.id)).toBeUndefined()
    expect(editor.state.contentEdit).toBeNull()
  })

  test('late reset requests do not alter the current selection preview', () => {
    const { editor, owner, details, actions, request } = fixture()
    expect(actions.viewTabContent(request)).toBe(true)
    editor.select([details.id])
    actions.resetTabsPreview(owner)
    expect(editor.getTabsTabPreview(owner.id)).toBe('details')
    editor.select([owner.id])
    actions.resetTabsPreview(owner)
    expect(editor.getTabsTabPreview(owner.id)).toBeUndefined()
  })
})
