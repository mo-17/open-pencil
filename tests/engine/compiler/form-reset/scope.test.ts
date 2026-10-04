import { expect, test } from 'bun:test'

import { buildComponentRegistry } from '#compiler/ir/collect/components'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'

import { createModalModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

test('FORM reset deduplicates its declarations and excludes portaled Modal content', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'shared', name: 'shared', type: 'string', defaultValue: 'declared' },
      { id: 'hidden', name: 'hidden', type: 'string', defaultValue: 'hidden-default' },
      { id: 'dialog', name: 'dialog', type: 'string', defaultValue: 'dialog-default' }
    ]
  })
  const form = graph.createNode('FORM', page.id, { width: 340, height: 500 })
  for (const name of ['First', 'Second'])
    graph.createNode('INPUT', form.id, {
      name,
      bindings: { value: { kind: 'ref', stateId: 'shared' } }
    })
  graph.createNode('INPUT', form.id, {
    name: 'Conditional field',
    renderCondition: 'shared === "visible"',
    bindings: { value: { kind: 'ref', stateId: 'hidden' } }
  })
  const modal = graph.createNode(
    'FRAME',
    form.id,
    createModalModuleFrameOverrides({ contentChildName: 'Dialog body' })
  )
  const body = graph.createNode('FRAME', modal.id, {
    name: 'Dialog body',
    width: 320,
    height: 120
  })
  const portaledInput = graph.createNode('INPUT', body.id, {
    name: 'Portaled input',
    interactiveProps: { validation: { required: true } },
    bindings: { value: { kind: 'ref', stateId: 'dialog' } }
  })
  const tree = collectTree(graph, page.id)
  const owner = tree.children.find(
    (node): node is IRElement => node.kind === 'element' && node.sourceId === form.id
  )
  expect(owner?.formResetFields?.map((field) => [field.write.name, field.defaultValue])).toEqual([
    ['shared', 'declared'],
    ['hidden', 'hidden-default']
  ])
  expect(owner?.formResetFields?.[0].sourceIds).toHaveLength(2)
  expect(owner?.formValidationKeys).not.toContain(portaledInput.id)
  expect(tree.warnings).toEqual([])
})

test('FORM reset owns fields in its clean component instance but not another form instance', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const library = graph.addPage('Library')
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'main', name: 'main', type: 'number', defaultValue: 2 },
      { id: 'other', name: 'other', type: 'number', defaultValue: 9 },
      { id: 'nested', name: 'nested', type: 'number', defaultValue: 15 },
      { id: 'portaled', name: 'portaled', type: 'number', defaultValue: 25 }
    ]
  })
  const mainMaster = graph.createNode('COMPONENT', library.id, { name: 'Main field' })
  graph.createNode('INPUT', mainMaster.id, {
    name: 'Main number',
    interactiveProps: { inputType: 'number' },
    bindings: { value: { kind: 'docState', docStateName: 'main' } }
  })
  const nestedForm = graph.createNode('FORM', mainMaster.id, { name: 'Nested form' })
  graph.createNode('INPUT', nestedForm.id, {
    name: 'Nested number',
    interactiveProps: { inputType: 'number' },
    bindings: { value: { kind: 'docState', docStateName: 'nested' } }
  })
  const modal = graph.createNode(
    'FRAME',
    mainMaster.id,
    createModalModuleFrameOverrides({ contentChildName: 'Dialog body' })
  )
  const body = graph.createNode('FRAME', modal.id, { name: 'Dialog body' })
  graph.createNode('INPUT', body.id, {
    name: 'Portaled number',
    interactiveProps: { inputType: 'number' },
    bindings: { value: { kind: 'docState', docStateName: 'portaled' } }
  })
  const outerMaster = graph.createNode('COMPONENT', library.id, { name: 'Outer field' })
  graph.createInstance(mainMaster.id, outerMaster.id)
  const otherMaster = graph.createNode('COMPONENT', library.id, { name: 'Other field' })
  graph.createNode('INPUT', otherMaster.id, {
    name: 'Other number',
    interactiveProps: { inputType: 'number' },
    bindings: { value: { kind: 'docState', docStateName: 'other' } }
  })
  const mainForm = graph.createNode('FORM', page.id, { name: 'Main form' })
  const otherForm = graph.createNode('FORM', page.id, { name: 'Other form' })
  graph.createInstance(outerMaster.id, mainForm.id)
  graph.createInstance(otherMaster.id, otherForm.id)

  const tree = collectTree(graph, page.id, buildComponentRegistry(graph))
  const owners = tree.children.filter((node): node is IRElement => node.kind === 'element')
  const main = owners.find((node) => node.sourceId === mainForm.id)
  const other = owners.find((node) => node.sourceId === otherForm.id)
  expect(main?.formResetFields?.map((field) => field.write.name)).toEqual(['main'])
  expect(other?.formResetFields?.map((field) => field.write.name)).toEqual(['other'])
  expect(tree.warnings).toEqual([])
})

test('FORM diagnoses a referenced field when an imported instance has no cloned children', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const library = graph.addPage('Library')
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'score', name: 'score', type: 'number', defaultValue: 2 }]
  })
  const master = graph.createNode('COMPONENT', library.id, { name: 'Score field' })
  graph.createNode('INPUT', master.id, {
    name: 'Score',
    interactiveProps: { inputType: 'number' },
    bindings: { value: { kind: 'docState', docStateName: 'score' } }
  })
  const form = graph.createNode('FORM', page.id, { name: 'Owner' })
  const instance = graph.createNode('INSTANCE', form.id, { componentId: master.id })
  const tree = collectTree(graph, page.id, buildComponentRegistry(graph))
  const owner = tree.children.find(
    (node): node is IRElement => node.kind === 'element' && node.sourceId === form.id
  )
  expect(owner?.formResetFields).toBeUndefined()
  expect(tree.warnings).toContainEqual(
    expect.objectContaining({ code: 'form-reset-component-unexpanded', nodeId: instance.id })
  )
})
