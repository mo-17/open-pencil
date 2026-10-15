import { afterEach, describe, expect, test } from 'bun:test'

import { computed } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createLayoutActions, createLayoutSizingState } from '#vue/controls/layout/helpers'

const editors: ReturnType<typeof createEditor>[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

function fixture(parentMode: 'HORIZONTAL' | 'VERTICAL' | 'GRID', child: Partial<SceneNode> = {}) {
  const editor = createEditor()
  editors.push(editor)
  const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    width: 300,
    height: 200,
    layoutMode: parentMode,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
    gridTemplateRows: [{ sizing: 'FR', value: 1 }]
  })
  const field = editor.graph.createNode(child.type ?? 'INPUT', parent.id, {
    width: 80,
    height: 30,
    ...child
  })
  const node = computed(() => editor.graph.getNode(field.id) ?? null)
  const actions = createLayoutActions({ editor, node })
  const read = () =>
    createLayoutSizingState(editor, node, {
      value: { sizingFixed: 'Fixed', sizingHug: 'Hug', sizingFill: 'Fill' }
    })
  return { editor, parent, field, actions, read }
}

describe('physical axis sizing in parent layout', () => {
  for (const parentMode of ['HORIZONTAL', 'VERTICAL'] as const) {
    for (const axis of ['width', 'height'] as const) {
      test(`${parentMode}: ${axis} Fill affects that physical axis and manual size releases it`, () => {
        const { editor, field, actions, read } = fixture(parentMode)
        actions.setAxisSizing(axis, 'FILL')
        expect([field.width, field.height]).toEqual(axis === 'width' ? [300, 30] : [80, 200])
        expect(read()[axis === 'width' ? 'widthSizing' : 'heightSizing'].value).toBe('FILL')
        actions.updateAxisSize(axis, 120)
        actions.commitAxisSize(axis, 120, axis === 'width' ? 300 : 200)
        expect([field.width, field.height]).toEqual(axis === 'width' ? [120, 30] : [80, 120])
        expect(read()[axis === 'width' ? 'widthSizing' : 'heightSizing'].value).toBe('FIXED')
        editor.undoAction()
        expect([field.width, field.height]).toEqual(axis === 'width' ? [300, 30] : [80, 200])
      })
    }

    test(`${parentMode}: inherited cross-axis stretch is shown and can be fixed without losing main Fill`, () => {
      const { editor, parent, field, actions, read } = fixture(parentMode, { layoutGrow: 1 })
      editor.graph.updateNode(parent.id, { counterAxisAlign: 'STRETCH' })
      editor.runLayoutForNode(parent.id)
      expect([field.width, field.height]).toEqual([300, 200])
      expect([read().widthSizing.value, read().heightSizing.value]).toEqual(['FILL', 'FILL'])
      const axis = parentMode === 'VERTICAL' ? 'width' : 'height'
      actions.updateAxisSize(axis, 120)
      actions.commitAxisSize(axis, 120, 200)
      expect([field.width, field.height]).toEqual(axis === 'width' ? [120, 200] : [300, 120])
      expect(field.layoutGrow).toBe(1)
      expect(field.layoutAlignSelf).not.toBe('AUTO')
    })
  }

  test('absolute children ignore parent Fill mechanics and do not offer parent Fill', () => {
    const { editor, parent, field, actions, read } = fixture('VERTICAL', {
      layoutPositioning: 'ABSOLUTE',
      layoutGrow: 1,
      layoutAlignSelf: 'STRETCH'
    })
    editor.runLayoutForNode(parent.id)
    expect([read().widthSizing.value, read().heightSizing.value]).toEqual(['FIXED', 'FIXED'])
    expect(read().widthSizingOptions.value.map((option) => option.value)).not.toContain('FILL')
    actions.updateAxisSize('width', 120)
    actions.commitAxisSize('width', 120, 80)
    expect([field.width, field.height]).toEqual([120, 30])
    expect([field.layoutGrow, field.layoutAlignSelf]).toEqual([1, 'STRETCH'])
  })

  test('own flex Hug/Fill is released for only the edited axis including legacy grow', () => {
    const { editor, parent, field, actions, read } = fixture('HORIZONTAL', {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FILL',
      layoutGrow: 1
    })
    editor.graph.createNode('RECTANGLE', field.id, { width: 40, height: 20 })
    editor.runLayoutForNode(parent.id)
    expect([field.width, field.height]).toEqual([300, 20])
    actions.updateAxisSize('width', 120)
    actions.commitAxisSize('width', 120, 300)
    expect([field.width, field.height]).toEqual([120, 20])
    expect([read().widthSizing.value, read().heightSizing.value]).toEqual(['FIXED', 'HUG'])
    expect(field.primaryAxisSizing).toBe('HUG')
    expect(field.layoutGrow).toBe(0)
  })

  test('own cross-axis Hug can opt out of inherited stretch', () => {
    const { editor, parent, field, actions, read } = fixture('VERTICAL', {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    editor.graph.createNode('RECTANGLE', field.id, { width: 40, height: 20 })
    editor.graph.updateNode(parent.id, { counterAxisAlign: 'STRETCH' })
    editor.runLayoutForNode(parent.id)
    expect(field.width).toBe(300)
    expect(read().widthSizing.value).toBe('FILL')
    actions.setAxisSizing('width', 'HUG')
    expect([field.width, field.height]).toEqual([40, 20])
    expect(read().widthSizing.value).toBe('HUG')
  })

  test('grid independent Fill is displayed on both axes and resizing preserves the other axis', () => {
    const { editor, parent, field, actions, read } = fixture('GRID', {
      layoutGrow: 1,
      layoutAlignSelf: 'STRETCH'
    })
    editor.runLayoutForNode(parent.id)
    expect([field.width, field.height]).toEqual([300, 200])
    expect([read().widthSizing.value, read().heightSizing.value]).toEqual(['FILL', 'FILL'])
    actions.updateAxisSize('width', 120)
    actions.commitAxisSize('width', 120, 300)
    expect([field.width, field.height]).toEqual([120, 200])
    expect([read().widthSizing.value, read().heightSizing.value]).toEqual(['FIXED', 'FILL'])
  })

  test('fixing an auto-layout grid child keeps its other stretched pixel size', () => {
    const { editor, parent, field, actions, read } = fixture('GRID', {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      layoutGrow: 1,
      layoutAlignSelf: 'STRETCH'
    })
    editor.graph.createNode('RECTANGLE', field.id, { width: 40, height: 20 })
    editor.runLayoutForNode(field.id)
    expect([field.width, field.height]).toEqual([300, 200])
    actions.updateAxisSize('width', 120)
    actions.commitAxisSize('width', 120, 300)
    expect([field.width, field.height]).toEqual([120, 200])
    expect([read().widthSizing.value, read().heightSizing.value]).toEqual(['FIXED', 'FILL'])
    editor.runLayoutForNode(parent.id)
    expect([field.width, field.height]).toEqual([120, 200])
  })

  test('grid default width stretch survives fixing an already fixed height', () => {
    const { editor, parent, field, actions, read } = fixture('GRID', {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      layoutGrow: 1
    })
    editor.runLayoutForNode(parent.id)
    expect([read().widthSizing.value, read().heightSizing.value]).toEqual(['FILL', 'FIXED'])
    actions.updateAxisSize('height', 120)
    actions.commitAxisSize('height', 120, 30)
    expect([field.width, field.height]).toEqual([300, 120])
    expect(read().widthSizing.value).toBe('FILL')
  })

  test('cross-axis alignment overriding an authored Fill is represented by its actual Hug behavior', () => {
    const { editor, field, read } = fixture('VERTICAL', {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FILL',
      layoutAlignSelf: 'MIN'
    })
    editor.graph.createNode('RECTANGLE', field.id, { width: 40, height: 20 })
    editor.runLayoutForNode(field.id)
    expect([field.width, field.height]).toEqual([40, 20])
    expect(read().widthSizing.value).toBe('HUG')
  })
})
