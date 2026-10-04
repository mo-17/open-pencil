import { describe, expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import { LOWCODE_APPLICATION_PLUGIN_KEY } from '@open-pencil/lowcode'

import { setApplicationEnabled, setApplicationStart } from '@/app/lowcode/application-mode/mutation'
import {
  applicationShellSlotOptions,
  readApplicationShell
} from '@/app/lowcode/application-mode/shell/model'
import { setApplicationShell } from '@/app/lowcode/application-mode/shell/mutation'
import { useApplicationModeModel } from '@/app/lowcode/application-mode/use'

function fixture() {
  const editor = createEditor()
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) throw new Error('Missing document')
  const page = editor.graph.getPages()[0]
  const entry = editor.graph.createNode('FRAME', page.id, { name: 'Home' })
  editor.graph.updateNode(page.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: entry.id }
  })
  const source = editor.graph.createNode('CANVAS', root.id, {
    name: 'Shared components',
    lowcodeApplicationPage: { version: 1, role: 'components' }
  })
  const frame = editor.graph.createNode('FRAME', source.id, {
    name: 'App shell',
    layoutMode: 'VERTICAL'
  })
  const column = editor.graph.createNode('FRAME', frame.id, {
    name: 'Main column',
    layoutMode: 'VERTICAL'
  })
  const slot = editor.graph.createNode('FRAME', column.id, {
    name: 'Content',
    layoutMode: 'VERTICAL'
  })
  const shell = { frameNodeId: frame.id, slotNodeId: slot.id }
  editor.graph.updateNode(root.id, {
    lowcodeApplication: { version: 1, enabled: true, startPageId: page.id, shell }
  })
  return { editor, root, page, entry, source, frame, column, slot, shell }
}

describe('application shell configuration preservation', () => {
  test('mode changes preserve the complete legal configuration and undo restores it', () => {
    const { editor, root, shell, page } = fixture()
    expect(setApplicationEnabled(editor, false, 'Design mode')).toBe(true)
    expect(root.lowcodeApplication).toEqual({
      version: 1,
      enabled: false,
      startPageId: page.id,
      shell
    })
    editor.undo.undo()
    expect(root.lowcodeApplication?.shell).toEqual(shell)
    expect(root.lowcodeApplication?.enabled).toBe(true)
    expect(setApplicationEnabled(editor, false, 'Design mode')).toBe(true)
    expect(setApplicationEnabled(editor, true, 'Application mode')).toBe(true)
    expect(root.lowcodeApplication?.shell).toEqual(shell)
  })

  test('start selection and explicit default start preserve the shell in one undo', () => {
    const { editor, root, shell, page } = fixture()
    expect(setApplicationStart(editor, '', 'Default start')).toBe(true)
    expect(root.lowcodeApplication).toEqual({ version: 1, enabled: true, shell })
    editor.undo.undo()
    expect(root.lowcodeApplication).toEqual({
      version: 1,
      enabled: true,
      startPageId: page.id,
      shell
    })
    expect(setApplicationStart(editor, '', 'Default start')).toBe(true)
    expect(setApplicationStart(editor, page.id, 'Home')).toBe(true)
    expect(root.lowcodeApplication?.shell).toEqual(shell)
  })
})

describe('application shell selection and atomic metadata edits', () => {
  test('nested slots have readable paths and projection never modifies source nodes', () => {
    const { editor, source, frame, column, slot, shell } = fixture()
    const before = JSON.stringify([...editor.graph.getAllNodes()])
    expect(readApplicationShell(editor)).toMatchObject({
      configured: true,
      invalid: false,
      frameNodeId: frame.id,
      slotNodeId: slot.id,
      frames: [{ value: frame.id, label: `${source.name} / ${frame.name}` }]
    })
    expect(applicationShellSlotOptions(editor.graph, frame.id)).toEqual([
      { value: slot.id, label: `${column.name} / ${slot.name}` }
    ])
    expect(JSON.stringify([...editor.graph.getAllNodes()])).toBe(before)
    expect(setApplicationShell(editor, shell, 'Unchanged shell')).toBe(false)
  })

  test('apply and remove each change only the complete document configuration in one undo', () => {
    const { editor, root, frame, shell, page } = fixture()
    const secondSlot = editor.graph.createNode('FRAME', frame.id, {
      name: 'Alternate content',
      y: 100,
      layoutMode: 'HORIZONTAL'
    })
    const design = structuredClone([...editor.graph.getAllNodes()].filter((node) => node !== root))
    const next = { frameNodeId: frame.id, slotNodeId: secondSlot.id }
    expect(setApplicationShell(editor, next, 'Apply shell')).toBe(true)
    expect(root.lowcodeApplication).toEqual({
      version: 1,
      enabled: true,
      startPageId: page.id,
      shell: next
    })
    expect([...editor.graph.getAllNodes()].filter((node) => node !== root)).toEqual(design)
    editor.undo.undo()
    expect(root.lowcodeApplication?.shell).toEqual(shell)
    editor.undo.redo()
    expect(root.lowcodeApplication?.shell).toEqual(next)
    expect(setApplicationShell(editor, undefined, 'Remove shell')).toBe(true)
    expect(root.lowcodeApplication).toEqual({ version: 1, enabled: true, startPageId: page.id })
    editor.undo.undo()
    expect(root.lowcodeApplication?.shell).toEqual(next)
    expect([...editor.graph.getAllNodes()].filter((node) => node !== root)).toEqual(design)
  })

  test('saved unavailable references stay visible and can be removed without automatic fallback', () => {
    const { editor, root, source, frame, slot, shell } = fixture()
    editor.graph.updateNode(source.id, {
      lowcodeApplicationPage: { version: 1, role: 'application' }
    })
    const before = JSON.stringify([...editor.graph.getAllNodes()])
    expect(readApplicationShell(editor)).toMatchObject({
      frameNodeId: frame.id,
      slotNodeId: slot.id,
      configured: true,
      invalid: true,
      frames: []
    })
    expect(applicationShellSlotOptions(editor.graph, frame.id)).toEqual([])
    expect(JSON.stringify([...editor.graph.getAllNodes()])).toBe(before)
    expect(setApplicationShell(editor, shell, 'Invalid shell')).toBe(false)
    expect(setApplicationShell(editor, undefined, 'Remove invalid shell')).toBe(true)
    editor.undo.undo()
    expect(root.lowcodeApplication?.shell).toEqual(shell)
    expect(readApplicationShell(editor).invalid).toBe(true)
  })

  test('mutations revalidate malformed pairs, filled slots and source-page behavior before writing', () => {
    const { editor, root, source, slot, shell } = fixture()
    const saved = structuredClone(root.lowcodeApplication)
    let getterReads = 0
    const accessor = Object.defineProperty({}, 'frameNodeId', {
      enumerable: true,
      get() {
        getterReads++
        return shell.frameNodeId
      }
    })
    for (const invalid of [
      null,
      {},
      { ...shell, slotNodeId: 'missing' },
      { ...shell, extra: true },
      accessor
    ]) {
      expect(setApplicationShell(editor, invalid, 'Invalid pair')).toBe(false)
      expect(root.lowcodeApplication).toEqual(saved)
    }
    expect(getterReads).toBe(0)
    editor.graph.createNode('TEXT', slot.id, { text: 'Already occupied' })
    expect(setApplicationShell(editor, shell, 'Filled slot')).toBe(false)
    expect(readApplicationShell(editor).invalid).toBe(true)
    editor.graph.updateNode(source.id, { state: [] })
    expect(readApplicationShell(editor).frames).toEqual([])
    expect(root.lowcodeApplication).toEqual(saved)
  })

  test('only eligible frames and empty auto-layout slots are offered, including nested ancestors', () => {
    const { editor, frame, column, slot } = fixture()
    const graph = editor.graph
    graph.createNode('FRAME', frame.id, { name: 'Not automatic' })
    const form = graph.createNode('FORM', frame.id)
    graph.createNode('FRAME', form.id, { layoutMode: 'VERTICAL' })
    const module = graph.createNode('FRAME', frame.id, { interactiveProps: { module: 'example' } })
    graph.createNode('FRAME', module.id, { layoutMode: 'VERTICAL' })
    expect(applicationShellSlotOptions(graph, frame.id)).toEqual([
      { value: slot.id, label: `${column.name} / ${slot.name}` }
    ])
    for (const field of ['locked', 'visible', 'libraryReadonly'] as const) {
      graph.updateNode(column.id, { [field]: field !== 'visible' })
      expect(applicationShellSlotOptions(graph, frame.id)).toEqual([])
      graph.updateNode(column.id, { [field]: field === 'visible' })
    }
    expect(applicationShellSlotOptions(graph, frame.id)).toHaveLength(1)
  })

  test('raw reserved metadata is retained until an explicit mode replacement and restored with undo', () => {
    const { editor, root, shell } = fixture()
    const other = { pluginId: 'other', key: 'keep', value: 'opaque' }
    const raw = {
      pluginId: 'open-pencil',
      key: LOWCODE_APPLICATION_PLUGIN_KEY,
      value: '{"version":2}'
    }
    editor.graph.updateNode(root.id, { pluginData: [other, raw] })
    expect(readApplicationShell(editor).disabled).toBe(true)
    expect(setApplicationShell(editor, undefined, 'Remove')).toBe(false)
    expect(root.pluginData).toEqual([other, raw])
    expect(root.lowcodeApplication?.shell).toEqual(shell)
    expect(setApplicationEnabled(editor, true, 'Replace mode')).toBe(true)
    expect(root.pluginData).toEqual([other])
    expect(root.lowcodeApplication?.shell).toEqual(shell)
    editor.undo.undo()
    expect(root.pluginData).toEqual([other, raw])
    expect(root.lowcodeApplication?.shell).toEqual(shell)
  })
})

describe('application shell drafts and captured authority', () => {
  test('two selections stay ephemeral, frame changes clear the slot and Apply saves one complete pair', () => {
    const { editor, root, source, shell } = fixture()
    const alternate = editor.graph.createNode('FRAME', source.id, { name: 'Alternative shell' })
    const alternateSlot = editor.graph.createNode('FRAME', alternate.id, {
      name: 'Body',
      layoutMode: 'VERTICAL'
    })
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => editor))
    if (!workflow) throw new Error('Missing workflow')
    try {
      const previous = workflow.panel.value.shell
      expect(previous.selectFrame(alternate.id)).toBe(true)
      expect(previous.selectSlot(shell.slotNodeId)).toBe(false)
      expect(workflow.panel.value.shell.slotNodeId).toBe('')
      expect(workflow.panel.value.shell.canApply).toBe(false)
      expect(workflow.panel.value.shell.apply()).toBe(false)
      expect(root.lowcodeApplication?.shell).toEqual(shell)
      expect(workflow.panel.value.shell.selectSlot(alternateSlot.id)).toBe(true)
      expect(workflow.panel.value.shell.canApply).toBe(true)
      expect(root.lowcodeApplication?.shell).toEqual(shell)
      expect(workflow.panel.value.shell.apply()).toBe(true)
      expect(workflow.panel.value.shell.dirty).toBe(false)
      expect(root.lowcodeApplication?.shell).toEqual({
        frameNodeId: alternate.id,
        slotNodeId: alternateSlot.id
      })
      editor.undo.undo()
      expect(root.lowcodeApplication?.shell).toEqual(shell)
      expect(workflow.panel.value.shell.frameNodeId).toBe(shell.frameNodeId)
    } finally {
      scope.stop()
    }
  })

  test('Cancel restores saved selections and Remove clears saved configuration rather than persisting a draft', () => {
    const { editor, root, frame, shell } = fixture()
    const second = editor.graph.createNode('FRAME', frame.id, {
      name: 'Second slot',
      layoutMode: 'VERTICAL'
    })
    const scope = effectScope()
    const workflow = scope.run(() => useApplicationModeModel(() => editor))
    if (!workflow) throw new Error('Missing workflow')
    try {
      expect(workflow.panel.value.shell.selectSlot(second.id)).toBe(true)
      workflow.panel.value.shell.cancel()
      expect(workflow.panel.value.shell.slotNodeId).toBe(shell.slotNodeId)
      expect(root.lowcodeApplication?.shell).toEqual(shell)
      expect(workflow.panel.value.shell.selectSlot(second.id)).toBe(true)
      expect(workflow.panel.value.shell.remove()).toBe(true)
      expect(root.lowcodeApplication?.shell).toBeUndefined()
      expect(workflow.panel.value.shell.dirty).toBe(false)
      editor.undo.undo()
      expect(root.lowcodeApplication?.shell).toEqual(shell)
    } finally {
      scope.stop()
    }
  })

  test.each(['page', 'graph', 'tab', 'retained', 'permission', 'external', 'dispose'] as const)(
    '%s replacement or withdrawal permanently cancels draft and late callbacks',
    (kind) => {
      const { editor, root, frame, shell } = fixture()
      const second = editor.graph.createNode('FRAME', frame.id, {
        name: 'Second slot',
        layoutMode: 'VERTICAL'
      })
      const otherPage = editor.graph.createNode('CANVAS', root.id)
      const selected = shallowRef(editor)
      let targetRoot = root
      let targetShell = shell
      const active = ref(true)
      const scope = effectScope()
      const workflow = scope.run(() => useApplicationModeModel(() => selected.value, active))
      if (!workflow) throw new Error('Missing workflow')
      try {
        expect(workflow.panel.value.shell.selectSlot(second.id)).toBe(true)
        const late = workflow.panel.value.shell
        if (kind === 'page') {
          editor.switchPage(otherPage.id)
          editor.switchPage(editor.graph.getPages()[0].id)
        }
        if (kind === 'graph' || kind === 'tab') {
          const replacement = fixture()
          targetRoot = replacement.root
          targetShell = replacement.shell
          if (kind === 'graph') editor.replaceGraph(replacement.editor.graph)
          else selected.value = replacement.editor
        }
        if (kind === 'retained') {
          active.value = false
          active.value = true
        }
        if (kind === 'permission') {
          editor.graph.updateNode(frame.id, { locked: true })
          editor.graph.updateNode(frame.id, { locked: false })
        }
        if (kind === 'external') {
          editor.graph.updateNode(root.id, {
            lowcodeApplication: { version: 1, enabled: false, shell }
          })
          editor.graph.updateNode(root.id, {
            lowcodeApplication: { version: 1, enabled: true, shell }
          })
        }
        if (kind === 'dispose') scope.stop()
        expect(late.apply()).toBe(false)
        expect(late.remove()).toBe(false)
        expect(late.selectFrame('')).toBe(false)
        expect(root.lowcodeApplication?.shell).toEqual(shell)
        expect(targetRoot.lowcodeApplication?.shell).toEqual(targetShell)
        if (kind !== 'dispose') expect(workflow.panel.value.shell.dirty).toBe(false)
      } finally {
        scope.stop()
      }
    }
  )
})
