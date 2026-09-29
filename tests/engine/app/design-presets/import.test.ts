import { describe, expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/core/kiwi'

import { DESIGN_PRESET_IDS, getDesignPresetTokens } from '@/app/design-presets/catalog'
import { designPresetCollectionName, importDesignPreset } from '@/app/design-presets/import'

import { expectDefined } from '#tests/helpers/assert'

const labels = { collectionName: 'Business', light: 'Light', dark: 'Dark', undo: 'Import preset' }

describe('optional design presets', () => {
  test('previewing choices does not change document, selection or history', () => {
    const editor = createEditor()
    const before = editor.snapshotDocument()
    for (const id of DESIGN_PRESET_IDS) {
      expect(getDesignPresetTokens(id)).toHaveLength(12)
      expect(designPresetCollectionName(editor, labels.collectionName)).toBe('Business')
    }
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('imports a separate collection without changing existing nodes or bindings', () => {
    const editor = createEditor()
    const existing = editor.graph.createCollection('Business')
    const variable = editor.graph.createVariable('color/brand', 'COLOR', existing.id, {
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })
    const rectangle = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    editor.bindVariable(rectangle.id, 'fills/0/color', variable.id)
    editor.select([rectangle.id])
    editor.undo.clear()
    const beforeNode = structuredClone(rectangle)
    const beforeCollection = structuredClone(existing)
    const beforeVariable = structuredClone(variable)
    const imported = importDesignPreset(editor, 'business', labels)

    expect(imported.name).toBe('Business (2)')
    expect(imported.variableIds).toHaveLength(12)
    expect(editor.getVariablesForCollection(imported.id)[0]?.name).toBe('Business (2)/color/brand')
    expect(imported.modes.map((mode) => mode.name)).toEqual(['Light', 'Dark'])
    expect(editor.graph.getNode(rectangle.id)).toEqual(beforeNode)
    expect(editor.state.selectedIds).toEqual(new Set([rectangle.id]))
    expect(editor.getCollection(existing.id)).toEqual(beforeCollection)
    expect(editor.getVariable(variable.id)).toEqual(beforeVariable)

    expect(editor.undo.undo()).toBe(labels.undo)
    expect(editor.getCollections()).toEqual([beforeCollection])
    expect(editor.getVariableCount()).toBe(1)
    expect(editor.undo.canUndo).toBe(false)
    expect(editor.graph.getNode(rectangle.id)).toEqual(beforeNode)
    expect(editor.undo.redo()).toBe(labels.undo)
    expect(editor.getVariableCount()).toBe(13)
    expect(editor.getCollection(imported.id)?.variableIds).toHaveLength(12)
  })

  test('repeated imports avoid name collisions and never share editable token values', () => {
    const editor = createEditor()
    editor.graph.createCollection('Business (2)')
    const first = importDesignPreset(editor, 'soft', labels)
    const second = importDesignPreset(editor, 'soft', labels)
    expect(first.name).toBe('Business')
    expect(second.name).toBe('Business (3)')
    expect(
      new Set(
        [
          ...editor.getVariablesForCollection(first.id),
          ...editor.getVariablesForCollection(second.id)
        ].map((variable) => variable.name)
      ).size
    ).toBe(24)
    expect(new Set([...first.variableIds, ...second.variableIds]).size).toBe(24)
    const firstBrand = expectDefined(editor.getVariablesForCollection(first.id)[0], 'first brand')
    const secondBrand = expectDefined(
      editor.getVariablesForCollection(second.id)[0],
      'second brand'
    )
    const original = structuredClone(firstBrand.valuesByMode)
    editor.updateVariableValue(secondBrand.id, 'light', { r: 1, g: 0, b: 0, a: 1 })
    expect(firstBrand.valuesByMode).toEqual(original)
    expect(getDesignPresetTokens('soft')[0]?.light).toEqual(original.light)
    editor.undo.undo()
    editor.undo.undo()
    expect(editor.getCollection(second.id)).toBeUndefined()
    expect(editor.getVariablesForCollection(first.id)).toHaveLength(12)
    editor.undo.redo()
    expect(editor.getVariablesForCollection(second.id)[0]?.valuesByMode).toEqual(original)
  })

  test('a failed import rolls back its partial collection and leaves earlier history intact', () => {
    const editor = createEditor()
    const existing = importDesignPreset(editor, 'business', labels)
    const addVariable = editor.addVariable.bind(editor)
    let calls = 0
    const failure = spyOn(editor, 'addVariable').mockImplementation((variable) => {
      if (++calls === 3) throw new Error('Interrupted import')
      addVariable(variable)
    })
    try {
      expect(() => importDesignPreset(editor, 'soft', labels)).toThrow('Interrupted import')
      expect(editor.getCollections()).toEqual([existing])
      expect(editor.getVariableCount()).toBe(12)
      expect(editor.undo.isBatching).toBe(false)
      editor.undo.undo()
      expect(editor.getCollectionCount()).toBe(0)
    } finally {
      failure.mockRestore()
    }
  })

  test('imported modes and bound tokens survive FIG save and reopen', async () => {
    await initCodec()
    const editor = createEditor()
    const imported = importDesignPreset(editor, 'soft', labels)
    const radius = expectDefined(
      editor
        .getVariablesForCollection(imported.id)
        .find((variable) => variable.name === 'Business/radius/medium'),
      'radius token'
    )
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      name: 'Preset-bound rectangle'
    })
    editor.bindVariable(node.id, 'cornerRadius', radius.id)
    const bytes = await exportFigFile(editor.graph)
    const restored = await parseFigFile(bytes.slice().buffer)
    const restoredCollection = expectDefined(
      [...restored.variableCollections.values()].find(
        (collection) => collection.name === 'Business'
      ),
      'restored collection'
    )
    expect(restoredCollection.variableIds).toHaveLength(12)
    expect(restoredCollection.modes.map((mode) => mode.name)).toEqual(['Light', 'Dark'])
    const restoredRadius = expectDefined(
      restored
        .getVariablesForCollection(restoredCollection.id)
        .find((variable) => variable.name === 'Business/radius/medium'),
      'restored radius'
    )
    expect(Object.values(restoredRadius.valuesByMode)).toEqual([16, 16])
    const restoredNode = expectDefined(
      [...restored.nodes.values()].find((candidate) => candidate.name === node.name),
      'restored rectangle'
    )
    expect(restoredNode.boundVariables.cornerRadius).toBe(restoredRadius.id)
  })
})
