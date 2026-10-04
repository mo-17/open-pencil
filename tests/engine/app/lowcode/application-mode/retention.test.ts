import { describe, expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import { LOWCODE_APPLICATION_PAGE_PLUGIN_KEY } from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { readApplicationMode } from '@/app/lowcode/application-mode/model'
import {
  setApplicationEnabled,
  setApplicationEntry,
  setApplicationRole,
  setApplicationRoute,
  setApplicationStart,
  setApplicationStateRetention
} from '@/app/lowcode/application-mode/mutation'
import { useApplicationModeModel } from '@/app/lowcode/application-mode/use'

function fixture() {
  const editor = createEditor()
  const page = editor.graph.getPages()[0]
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) throw new Error('Missing root')
  const entry = editor.graph.createNode('FRAME', page.id, { width: 390, height: 844 })
  root.lowcodeApplication = { version: 1, enabled: true, startPageId: page.id }
  page.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
  page.lowcodeRoutePattern = '/products/:id'
  page.state = [{ id: 'draft-id', name: 'draft', type: 'string', defaultValue: 'Design draft' }]
  return { editor, root, page, entry }
}

describe('page session retention workflow', () => {
  test('default reads are inert and explicit preserve/reset edits are one undo without changing design values', () => {
    const { editor, root, page, entry } = fixture()
    const design = structuredClone([page.state, entry, root.lowcodeApplication])
    expect(readApplicationMode(editor).stateRetention).toBe('')
    expect(page.lowcodeApplicationPage?.stateRetention).toBeUndefined()
    expect(setApplicationStateRetention(editor, page, 'reset', 'Retention')).toBe(true)
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('reset')
    expect(readApplicationMode(editor).stateRetention).toBe('reset')
    expect(setApplicationStateRetention(editor, page, 'reset', 'Retention')).toBe(false)
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.stateRetention).toBeUndefined()
    expect(readApplicationMode(editor).stateRetention).toBe('')
    expect(setApplicationStateRetention(editor, page, 'preserve', 'Retention')).toBe(true)
    expect(page.lowcodeApplicationPage).toEqual({
      version: 1,
      role: 'application',
      entryNodeId: entry.id,
      stateRetention: 'preserve'
    })
    expect(page.lowcodeRoutePattern).toBe('/products/:id')
    expect([page.state, entry, root.lowcodeApplication]).toEqual(design)
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.stateRetention).toBeUndefined()
    editor.undo.redo()
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
    expect(setApplicationStateRetention(editor, page, 'reset', 'Reset')).toBe(true)
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('reset')
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
  })

  test('an unset controlled selection commits reset once and undo returns to the original behavior', () => {
    const { editor, page } = fixture()
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => editor, ref(true)))
    if (!workflow) throw new Error('Missing workflow')
    try {
      const unset = workflow.panel.value
      expect(unset.stateRetention).toBe('')
      expect(unset.stateRetentionDisabled).toBe(false)
      expect(unset.setStateRetention('reset')).toBe(true)
      expect(workflow.panel.value.stateRetention).toBe('reset')
      expect(page.lowcodeApplicationPage?.stateRetention).toBe('reset')
      expect(unset.setStateRetention('preserve')).toBe(false)
      editor.undo.undo()
      expect(workflow.panel.value.stateRetention).toBe('')
      expect(page.lowcodeApplicationPage?.stateRetention).toBeUndefined()
      expect(workflow.panel.value.setStateRetention('preserve')).toBe(true)
      expect(workflow.panel.value.stateRetention).toBe('preserve')
    } finally {
      scope.stop()
    }
  })

  test('entry/route/start/mode changes retain the preference and role changes keep it dormant', () => {
    const { editor, root, page, entry } = fixture()
    setApplicationStateRetention(editor, page, 'preserve', 'Retention')
    setApplicationEntry(editor, page, '', 'Clear entry')
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
    setApplicationEntry(editor, page, entry.id, 'Entry')
    setApplicationRoute(editor, page, '/products', 'Route')
    setApplicationStart(editor, page.id, 'Start')
    setApplicationEnabled(editor, false, 'Design mode')
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
    expect(root.lowcodeApplication?.startPageId).toBe(page.id)
    setApplicationEnabled(editor, true, 'Application mode')
    for (const role of ['reference', 'components'] as const) {
      setApplicationRole(editor, page, role, 'Role')
      expect(readApplicationMode(editor).stateRetentionDisabled).toBe(true)
      expect(setApplicationStateRetention(editor, page, 'reset', 'Late retention')).toBe(false)
      expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
    }
    setApplicationRole(editor, page, 'application', 'Role')
    expect(readApplicationMode(editor).stateRetention).toBe('preserve')
    setApplicationRole(editor, page, '', 'Clear role')
    expect(page.lowcodeApplicationPage).toBeUndefined()
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
  })

  test('protected, stale, raw and unsupported pages cannot commit retention', () => {
    for (const field of [
      'locked',
      'internalOnly',
      'libraryReadonly',
      'lowcodeLibraryCache'
    ] as const) {
      const { editor, page } = fixture()
      editor.graph.updateNode(page.id, { [field]: true })
      expect(setApplicationStateRetention(editor, page, 'preserve', 'Retention')).toBe(false)
    }
    const { editor, page } = fixture()
    for (const value of ['', null, true, 'cache'])
      expect(setApplicationStateRetention(editor, page, value, 'Retention')).toBe(false)
    editor.graph.updateNode(page.id, {
      pluginData: [
        {
          pluginId: 'open-pencil',
          key: LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
          value: '{"version":2}'
        }
      ]
    })
    expect(readApplicationMode(editor).stateRetentionDisabled).toBe(true)
    expect(setApplicationStateRetention(editor, page, 'preserve', 'Retention')).toBe(false)
    expect(page.pluginData).toHaveLength(1)
    const other = editor.graph.addPage('Other')
    editor.switchPage(other.id)
    expect(setApplicationStateRetention(editor, page, 'preserve', 'Retention')).toBe(false)
    expect(readApplicationMode(undefined).stateRetentionDisabled).toBe(true)
  })

  test('retained/page/graph/tab/external/disposal changes retire captured retention callbacks', () => {
    const { editor, page } = fixture()
    const selected = shallowRef(editor)
    const active = ref(true)
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => selected.value, active))
    if (!workflow) throw new Error('Missing workflow')
    try {
      const beforeExternal = workflow.panel.value
      editor.graph.updateNode(page.id, { lowcodeRoutePattern: '/changed' })
      expect(beforeExternal.setStateRetention('preserve')).toBe(false)
      const beforeActive = workflow.panel.value
      active.value = false
      expect(workflow.panel.value.stateRetentionDisabled).toBe(true)
      active.value = true
      expect(beforeActive.setStateRetention('preserve')).toBe(false)
      const beforePage = workflow.panel.value
      editor.switchPage(editor.graph.addPage('Other').id)
      expect(beforePage.setStateRetention('preserve')).toBe(false)
      editor.switchPage(page.id)
      expect(workflow.panel.value.setStateRetention('preserve')).toBe(true)
      const beforeGraph = workflow.panel.value
      editor.replaceGraph(new SceneGraph())
      expect(beforeGraph.setStateRetention('reset')).toBe(false)
      const beforeTab = workflow.panel.value
      selected.value = fixture().editor
      expect(beforeTab.setStateRetention('preserve')).toBe(false)
      const beforeDispose = workflow.panel.value
      scope.stop()
      expect(beforeDispose.setStateRetention('preserve')).toBe(false)
    } finally {
      scope.stop()
    }
  })
})
