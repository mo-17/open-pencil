import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { VariableValue } from '@open-pencil/scene-graph'

function setup() {
  const editor = createEditor()
  const page = editor.graph.getPages()[0]
  const collection = editor.graph.createCollection('Radii')
  const variable = editor.graph.createVariable('Medium', 'FLOAT', collection.id, 16)
  const node = editor.graph.createNode('RECTANGLE', page.id, { cornerRadius: 3 })
  return { editor, page, collection, variable, node }
}

describe('numeric variable detachment', () => {
  test('preserves the resolved value with one undo step and leaves other users unchanged', () => {
    const { editor, page, variable, node } = setup()
    const other = editor.graph.createNode('RECTANGLE', page.id, { cornerRadius: 7 })
    editor.bindVariable(other.id, 'cornerRadius', variable.id)
    editor.bindVariable(node.id, 'cornerRadius', variable.id)

    editor.unbindVariable(node.id, 'cornerRadius')
    expect(node.cornerRadius).toBe(16)
    expect(node.boundVariables.cornerRadius).toBeUndefined()
    expect(other.cornerRadius).toBe(7)
    expect(other.boundVariables.cornerRadius).toBe(variable.id)
    expect(editor.graph.resolveNumberVariable(variable.id)).toBe(16)

    editor.undo.undo()
    expect(node.cornerRadius).toBe(3)
    expect(node.boundVariables.cornerRadius).toBe(variable.id)
    editor.undo.redo()
    expect(node.cornerRadius).toBe(16)
    expect(node.boundVariables.cornerRadius).toBeUndefined()

    editor.undo.undo()
    editor.undo.undo()
    expect(node.cornerRadius).toBe(3)
    expect(node.boundVariables.cornerRadius).toBeUndefined()
  })

  test('resolves cross-collection aliases using inherited and explicit node modes', () => {
    const { editor, page, collection, variable, node } = setup()
    editor.graph.addMode(collection.id, 'dark', 'Dark')
    const source = editor.graph.createCollection('Source')
    editor.graph.addMode(source.id, 'wide', 'Wide')
    const alias = editor.graph.createVariable('Radius', 'FLOAT', source.id, 8)
    editor.updateVariableValue(alias.id, 'wide', 28)
    editor.updateVariableValue(variable.id, 'dark', { aliasId: alias.id })
    const frame = editor.graph.createNode('FRAME', page.id, {
      variableModes: { [collection.id]: 'dark', [source.id]: 'wide' }
    })
    editor.graph.reparentNode(node.id, frame.id)
    const other = editor.graph.createNode('RECTANGLE', frame.id, {
      cornerRadius: 4,
      variableModes: { [source.id]: source.defaultModeId }
    })
    editor.bindVariable(node.id, 'cornerRadius', variable.id)
    editor.bindVariable(other.id, 'cornerRadius', variable.id)

    editor.undo.runBatch('Detach selection', () => {
      editor.unbindVariable(node.id, 'cornerRadius')
      editor.unbindVariable(other.id, 'cornerRadius')
    })
    expect(node.cornerRadius).toBe(28)
    expect(other.cornerRadius).toBe(8)
    editor.undo.undo()
    expect(node.cornerRadius).toBe(3)
    expect(other.cornerRadius).toBe(4)
    expect(node.boundVariables.cornerRadius).toBe(variable.id)
    expect(other.boundVariables.cornerRadius).toBe(variable.id)
    editor.undo.redo()
    expect(node.cornerRadius).toBe(28)
    expect(other.cornerRadius).toBe(8)
  })

  test('undo restores nullable scalar values', () => {
    const { editor, variable, node } = setup()
    expect(node.minWidth).toBeNull()
    editor.bindVariable(node.id, 'minWidth', variable.id)
    editor.unbindVariable(node.id, 'minWidth')
    expect(node.minWidth).toBe(16)
    editor.undo.undo()
    expect(node.minWidth).toBeNull()
    expect(node.boundVariables.minWidth).toBe(variable.id)
    editor.undo.redo()
    expect(node.minWidth).toBe(16)
  })

  test('detach-on-edit remains one reversible interaction', () => {
    const { editor, variable, node } = setup()
    editor.bindVariable(node.id, 'cornerRadius', variable.id)
    editor.undo.runBatch('Edit radius', () => {
      editor.unbindVariable(node.id, 'cornerRadius')
      editor.updateNodeWithUndo(node.id, { cornerRadius: 20 })
    })
    expect(node.cornerRadius).toBe(20)
    editor.undo.undo()
    expect(node.cornerRadius).toBe(3)
    expect(node.boundVariables.cornerRadius).toBe(variable.id)
    editor.undo.redo()
    expect(node.cornerRadius).toBe(20)
    expect(node.boundVariables.cornerRadius).toBeUndefined()
    editor.undo.undo()

    editor.undo.beginBatch('Cancelled radius edit')
    editor.unbindVariable(node.id, 'cornerRadius')
    editor.updateNodeWithUndo(node.id, { cornerRadius: 24 })
    editor.undo.rollbackBatch()
    expect(node.cornerRadius).toBe(3)
    expect(node.boundVariables.cornerRadius).toBe(variable.id)
  })

  for (const [name, value] of [
    ['missing alias', { aliasId: 'missing' }],
    ['alias cycle', { aliasId: 'self' }],
    ['wrong value type', 'invalid'],
    ['non-finite value', Number.POSITIVE_INFINITY]
  ] satisfies [string, VariableValue][]) {
    test(`keeps the raw value when resolution fails: ${name}`, () => {
      const { editor, collection, variable, node } = setup()
      editor.bindVariable(node.id, 'cornerRadius', variable.id)
      variable.valuesByMode[collection.defaultModeId] =
        name === 'alias cycle' ? { aliasId: variable.id } : value
      editor.unbindVariable(node.id, 'cornerRadius')
      expect(node.cornerRadius).toBe(3)
      expect(node.boundVariables.cornerRadius).toBeUndefined()
      editor.undo.undo()
      expect(node.cornerRadius).toBe(3)
      expect(node.boundVariables.cornerRadius).toBe(variable.id)
      editor.undo.redo()
      expect(node.cornerRadius).toBe(3)
      expect(node.boundVariables.cornerRadius).toBeUndefined()
    })
  }

  test('does not substitute the default value for a missing effective mode', () => {
    const { editor, collection, variable, node } = setup()
    editor.graph.updateNode(node.id, { variableModes: { [collection.id]: 'missing-mode' } })
    editor.bindVariable(node.id, 'cornerRadius', variable.id)
    editor.unbindVariable(node.id, 'cornerRadius')
    expect(node.cornerRadius).toBe(3)
    editor.undo.undo()
    expect(node.boundVariables.cornerRadius).toBe(variable.id)
    expect(node.cornerRadius).toBe(3)
  })

  test('raw graph unbind continues to remove only the binding', () => {
    const { editor, variable, node } = setup()
    editor.graph.bindVariable(node.id, 'cornerRadius', variable.id)
    editor.graph.unbindVariable(node.id, 'cornerRadius')
    expect(node.cornerRadius).toBe(3)
    expect(node.boundVariables.cornerRadius).toBeUndefined()
  })
})
