import { describe, expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import { LOWCODE_APPLICATION_PAGE_PLUGIN_KEY } from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { setApplicationPageGuard } from '@/app/lowcode/application-mode/guards/mutation'
import { readApplicationMode } from '@/app/lowcode/application-mode/model'
import {
  setApplicationEnabled,
  setApplicationEntry,
  setApplicationRole,
  setApplicationStateRetention
} from '@/app/lowcode/application-mode/mutation'
import { useApplicationModeModel } from '@/app/lowcode/application-mode/use'

function fixture() {
  const editor = createEditor()
  const graph = editor.graph
  const page = graph.getPages()[0]
  const home = graph.addPage('Home')
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('Missing root')
  for (const [node, route] of [
    [page, '/products/:id'],
    [home, '/home']
  ] as const) {
    const entry = graph.createNode('FRAME', node.id, { width: 390, height: 844 })
    node.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
    node.lowcodeRoutePattern = route
  }
  root.lowcodeApplication = { version: 1, enabled: true, startPageId: home.id }
  root.lowcodeDocumentState = [
    { id: 'auth', name: 'isSignedIn', type: 'boolean', defaultValue: false }
  ]
  page.state = [{ id: 'dirty', name: 'dirty', type: 'boolean', defaultValue: false }]
  return { editor, page, home, root }
}

describe('application guard settings', () => {
  test('two-field drafts are inert until Apply, commit as one undo and retain all other metadata', () => {
    const { editor, page, root } = fixture()
    setApplicationStateRetention(editor, page, 'preserve', 'Retention')
    const before = structuredClone([
      page.lowcodeApplicationPage,
      page.state,
      root.lowcodeApplication,
      root.lowcodeDocumentState,
      page.lowcodeRoutePattern
    ])
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => editor, ref(true)))
    if (!workflow) throw new Error('Missing workflow')
    try {
      expect(workflow.panel.value.enter.configured).toBe(false)
      expect(workflow.panel.value.enter.canApply).toBe(false)
      const stale = workflow.panel.value.enter
      expect(stale.editExpression('isSignedIn === true')).toBe(true)
      expect(stale.editDetail('/home')).toBe(false)
      expect(workflow.panel.value.enter.editDetail('/home?from=detail')).toBe(true)
      expect(page.lowcodeApplicationPage?.enterGuard).toBeUndefined()
      expect(workflow.panel.value.enter.canApply).toBe(true)
      expect(workflow.panel.value.enter.apply()).toBe(true)
      expect(workflow.panel.value.enter.dirty).toBe(false)
      expect(page.lowcodeApplicationPage?.enterGuard).toEqual({
        conditionExpr: 'isSignedIn === true',
        fallback: '/home?from=detail'
      })
      expect(workflow.panel.value.leave.editExpression('dirty === true')).toBe(true)
      expect(workflow.panel.value.leave.editDetail('Leave without saving?')).toBe(true)
      expect(workflow.panel.value.leave.apply()).toBe(true)
      expect(page.lowcodeApplicationPage?.leaveConfirm).toEqual({
        dirtyExpr: 'dirty === true',
        message: 'Leave without saving?'
      })
      expect([
        page.state,
        root.lowcodeApplication,
        root.lowcodeDocumentState,
        page.lowcodeRoutePattern
      ]).toEqual(before.slice(1))
      expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
      editor.undo.undo()
      expect(page.lowcodeApplicationPage?.leaveConfirm).toBeUndefined()
      expect(page.lowcodeApplicationPage?.enterGuard).toBeDefined()
      editor.undo.undo()
      expect(page.lowcodeApplicationPage).toEqual(before[0])
      editor.undo.redo()
      expect(workflow.panel.value.enter.configured).toBe(true)
      expect(workflow.panel.value.enter.remove()).toBe(true)
      expect(page.lowcodeApplicationPage).toEqual(before[0])
      editor.undo.undo()
      expect(page.lowcodeApplicationPage?.enterGuard).toBeDefined()
    } finally {
      scope.stop()
    }
  })

  test('cancel and invalid/looping fallbacks never author a partial rule', () => {
    const { editor, page, home } = fixture()
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => editor, ref(true)))
    if (!workflow) throw new Error('Missing workflow')
    try {
      workflow.panel.value.enter.editExpression('save()')
      workflow.panel.value.enter.editDetail('/home')
      expect(workflow.panel.value.enter.expressionValid).toBe(false)
      expect(workflow.panel.value.enter.apply()).toBe(false)
      workflow.panel.value.enter.editExpression('true')
      for (const fallback of ['/unknown', '/products/1', '//example.com']) {
        workflow.panel.value.enter.editDetail(fallback)
        expect(workflow.panel.value.enter.detailValid).toBe(false)
        expect(workflow.panel.value.enter.apply()).toBe(false)
      }
      workflow.panel.value.enter.cancel()
      expect(workflow.panel.value.enter.expression).toBe('')
      expect(workflow.panel.value.enter.detail).toBe('')
      expect(page.lowcodeApplicationPage?.enterGuard).toBeUndefined()
      home.lowcodeApplicationPage = {
        version: 1,
        role: 'application',
        entryNodeId: home.childIds[0],
        enterGuard: { conditionExpr: 'true', fallback: '/products/1' }
      }
      expect(
        setApplicationPageGuard(
          editor,
          page,
          'enter',
          { conditionExpr: 'true', fallback: '/home' },
          'Loop'
        )
      ).toBe(false)
      expect(
        setApplicationPageGuard(
          editor,
          page,
          'leave',
          { dirtyExpr: 'dirty', message: '' },
          'Empty message'
        )
      ).toBe(false)
      expect(page.lowcodeApplicationPage?.leaveConfirm).toBeUndefined()
    } finally {
      scope.stop()
    }
  })

  test('mode/role/entry changes retain dormant rules and role clearing remains undoable', () => {
    const { editor, page } = fixture()
    const entry = page.childIds[0]
    const enter = { conditionExpr: 'isSignedIn', fallback: '/home' }
    const leave = { dirtyExpr: 'dirty', message: 'Leave?' }
    setApplicationPageGuard(editor, page, 'enter', enter, 'Enter')
    setApplicationPageGuard(editor, page, 'leave', leave, 'Leave')
    setApplicationEnabled(editor, false, 'Off')
    expect(setApplicationPageGuard(editor, page, 'leave', undefined, 'Remove')).toBe(false)
    expect(page.lowcodeApplicationPage?.enterGuard).toEqual(enter)
    setApplicationEnabled(editor, true, 'On')
    for (const role of ['reference', 'components'] as const) {
      setApplicationRole(editor, page, role, 'Role')
      expect(readApplicationMode(editor).guardsDisabled).toBe(true)
      expect(page.lowcodeApplicationPage?.leaveConfirm).toEqual(leave)
    }
    setApplicationRole(editor, page, 'application', 'Role')
    setApplicationEntry(editor, page, entry, 'Entry')
    expect(page.lowcodeApplicationPage?.enterGuard).toEqual(enter)
    setApplicationRole(editor, page, '', 'Clear role')
    expect(page.lowcodeApplicationPage).toBeUndefined()
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.leaveConfirm).toEqual(leave)
  })

  test('retained activity, scene/page/graph/tab changes and disposal retire draft callbacks', () => {
    const { editor, page } = fixture()
    const active = ref(true)
    const selected = shallowRef(editor)
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => selected.value, active))
    if (!workflow) throw new Error('Missing workflow')
    try {
      workflow.panel.value.enter.editExpression('true')
      workflow.panel.value.enter.editDetail('/home')
      const beforeActive = workflow.panel.value.enter
      active.value = false
      active.value = true
      expect(beforeActive.apply()).toBe(false)
      expect(workflow.panel.value.enter.expression).toBe('')
      const beforeScene = workflow.panel.value.leave
      editor.graph.updateNode(page.id, { name: 'Renamed' })
      expect(beforeScene.editExpression('dirty')).toBe(false)
      const beforePage = workflow.panel.value.leave
      editor.switchPage(editor.graph.addPage('Other').id)
      expect(beforePage.editDetail('Leave?')).toBe(false)
      editor.switchPage(page.id)
      const beforeGraph = workflow.panel.value.enter
      editor.replaceGraph(new SceneGraph())
      expect(beforeGraph.apply()).toBe(false)
      const beforeTab = workflow.panel.value.leave
      selected.value = fixture().editor
      expect(beforeTab.editExpression('dirty')).toBe(false)
      const beforeDispose = workflow.panel.value.leave
      scope.stop()
      expect(beforeDispose.editExpression('dirty')).toBe(false)
    } finally {
      scope.stop()
    }
  })

  test('locked, opaque, invalid and stale target pages cannot commit rules', () => {
    const { editor, page } = fixture()
    const value = { dirtyExpr: 'dirty', message: 'Leave?' }
    expect(
      Reflect.apply(setApplicationPageGuard, undefined, [editor, page, 'unknown', value, 'Rule'])
    ).toBe(false)
    editor.graph.updateNode(page.id, { locked: true })
    expect(setApplicationPageGuard(editor, page, 'leave', value, 'Rule')).toBe(false)
    editor.graph.updateNode(page.id, {
      locked: false,
      pluginData: [
        {
          pluginId: 'open-pencil',
          key: LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
          value: '{"version":2}'
        }
      ]
    })
    expect(setApplicationPageGuard(editor, page, 'leave', value, 'Rule')).toBe(false)
    expect(page.pluginData).toHaveLength(1)
    editor.graph.updateNode(page.id, { pluginData: [] })
    Reflect.set(page, 'lowcodeApplicationPage', {
      version: 1,
      role: 'application',
      enterGuard: null
    })
    expect(setApplicationPageGuard(editor, page, 'leave', value, 'Rule')).toBe(false)
    expect(readApplicationMode(undefined).guardsDisabled).toBe(true)
    editor.switchPage(editor.graph.addPage('Other').id)
    expect(setApplicationPageGuard(editor, page, 'leave', value, 'Rule')).toBe(false)
  })
})
