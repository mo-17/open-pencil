import { expect, test } from 'bun:test'

import { moduleContentNodes } from '#compiler/modules/content-slots'

import { buildComponentRegistry } from '@open-pencil/compiler/ir/collect/components'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  FORM_RESET_FIELD_ATTRIBUTE,
  type IRElement,
  type IRNode
} from '@open-pencil/compiler/ir/types'
import { validateModuleInstance } from '@open-pencil/scene-graph'

import { walktourGraph } from '#tests/helpers/compiler/components/walktour/fixture'

function moduleElement(children: readonly IRNode[], id: string): IRElement {
  const node = children.find((node) => node.kind === 'element' && node.sourceId === id)
  if (node?.kind !== 'element') throw new Error('Missing module element')
  return node
}
function descendants(nodes: readonly IRNode[]): IRNode[] {
  return nodes.flatMap((node) => {
    let children: readonly IRNode[] = []
    if (node.kind === 'element') children = node.children
    else if (node.kind === 'conditional') children = [node.consequent]
    else if (node.kind === 'list') children = [node.template]
    return [node, ...descendants(children)]
  })
}
test('all Walktour children remain in authored order exactly once, including conditional and list content', () => {
  const { graph, page, main, profile } = walktourGraph(),
    ir = collectTree(graph, page.id),
    node = moduleElement(ir.children, main.id),
    slots = moduleContentNodes(node) ?? []
  expect(ir.warnings).toEqual([])
  const rendered = slots.flatMap((slot) => slot.nodes)
  expect(rendered.length).toBe(node.children.length)
  expect(new Set(rendered).size).toBe(node.children.length)
  expect(rendered).toEqual(node.children)
  const target = slots.find((slot) => slot.name === 'target-profile')?.nodes[0]
  expect(target?.kind).toBe('element')
  if (target?.kind !== 'element') throw new Error('Expected target')
  expect(target.className).toContain('absolute')
  expect(target).toBe(moduleElement(node.children, profile.id))
  expect(graph.getNode(profile.id)).toMatchObject({ x: 16, y: 64 })
  expect(slots.find((slot) => slot.name === 'target-hidden')?.nodes[0].kind).toBe('conditional')
  expect(slots.find((slot) => slot.name === 'target-rows')?.nodes.length).toBe(1)
})
for (const failure of ['missing', 'duplicate', 'hidden'] as const)
  test(`${failure} Walktour targets warn, but unmapped content is retained`, () => {
    const { graph, page, main, profile } = walktourGraph()
    if (failure === 'missing') graph.updateNode(profile.id, { name: 'Renamed' })
    if (failure === 'duplicate')
      graph.createNode('TEXT', main.id, {
        name: 'Profile',
        text: 'Duplicate',
        width: 120,
        height: 30
      })
    if (failure === 'hidden') graph.updateNode(profile.id, { visible: false })
    const ir = collectTree(graph, page.id),
      node = moduleElement(ir.children, main.id),
      slots = moduleContentNodes(node) ?? []
    expect(ir.warnings.some((w) => w.code === 'walktour-target-unavailable')).toBe(true)
    expect(slots.find((slot) => slot.name === 'target-profile')?.nodes).toEqual([])
    expect(slots.flatMap((slot) => slot.nodes).length).toBe(node.children.length)
    expect(new Set(slots.flatMap((slot) => slot.nodes)).size).toBe(node.children.length)
  })
test('Walktour child indices reject invalid bounds instead of selecting unrelated content', () => {
  const { graph, page, main } = walktourGraph(),
    node = moduleElement(collectTree(graph, page.id).children, main.id)
  if (!node.module) throw new Error('Missing module')
  for (const childIndex of [-1, Number.NaN, 1.5, node.children.length, 1000]) {
    node.module.contentSlots = [{ name: 'target-invalid', sourceId: null, childIndex }]
    expect(moduleContentNodes(node)?.[0].nodes).toEqual([])
  }
})
test('unmapped form controls retain owning form validation; nested forms remain separate', () => {
  const { graph, page, main } = walktourGraph(),
    form = graph.createNode('FORM', page.id, { width: 340, height: 600 })
  graph.reparentNode(main.id, form.id)
  const field = graph.createNode('INPUT', main.id, {
    name: 'Field',
    bindings: { value: { kind: 'docState', docStateName: 'field' } },
    interactiveProps: { validation: { required: true } }
  })
  const nested = graph.createNode('FORM', main.id)
  const nestedField = graph.createNode('INPUT', nested.id, {
    name: 'Nested field',
    bindings: { value: { kind: 'docState', docStateName: 'field' } },
    interactiveProps: { validation: { required: true } }
  })
  const ir = collectTree(graph, page.id),
    outer = moduleElement(ir.children, form.id)
  expect(outer.formValidationKeys).toEqual([field.id])
  expect(outer.formValidationMountedOnly).toBe(true)
  expect(outer.formResetFields?.map((reset) => reset.sourceIds)).toEqual([[field.id]])
  const module = moduleElement(outer.children, main.id),
    input = moduleElement(module.children, field.id)
  expect(input.validationScopeMarker).toBe(true)
  expect(input.attrs[FORM_RESET_FIELD_ATTRIBUTE]).toBe(field.id)
  expect(moduleContentNodes(module)?.flatMap((slot) => slot.nodes)).toContain(input)
  const nestedForm = moduleElement(module.children, nested.id),
    nestedInput = moduleElement(nestedForm.children, nestedField.id)
  expect(nestedForm.formValidationKeys).toEqual([nestedField.id])
  expect(nestedForm.formResetFields?.map((reset) => reset.sourceIds)).toEqual([[nestedField.id]])
  expect(nestedInput.validationScopeMarker).toBeUndefined()
  expect(nestedInput.attrs[FORM_RESET_FIELD_ATTRIBUTE]).toBe(nestedField.id)
  expect(ir.warnings).toEqual([])
})

test('mapped Walktour targets, conditional fields and list templates share native FORM ownership', () => {
  const { graph, page, main, profile, conditional, list } = walktourGraph(),
    form = graph.createNode('FORM', page.id)
  graph.reparentNode(main.id, form.id)
  graph.updateNode(profile.id, { type: 'FRAME' })
  const props = {
    bindings: { value: { kind: 'docState' as const, docStateName: 'field' } },
    interactiveProps: { validation: { required: true } }
  }
  const row = graph.getChildren(list.id)[0]
  if (!row) throw new Error('Missing list row template')
  graph.updateNode(row.id, { type: 'FRAME' })
  const mapped = graph.createNode('INPUT', profile.id, props),
    repeated = graph.createNode('INPUT', row.id, props)
  graph.updateNode(conditional.id, { ...props, type: 'INPUT' })
  const ir = collectTree(graph, page.id),
    outer = moduleElement(ir.children, form.id),
    module = moduleElement(outer.children, main.id),
    keys = [mapped.id, conditional.id, repeated.id]
  expect(outer.formValidationKeys).toEqual(keys)
  expect(outer.formValidationMountedOnly).toBe(true)
  expect(outer.formResetFields?.map((reset) => reset.sourceIds)).toEqual([keys])
  const fields = moduleContentNodes(module)?.flatMap((slot) => slot.nodes) ?? []
  const rendered = descendants(fields)
  expect(rendered.some((node) => node.kind === 'conditional')).toBe(true)
  expect(rendered.some((node) => node.kind === 'list')).toBe(true)
  const ownedFields = rendered.filter(
    (node): node is IRElement => node.kind === 'element' && keys.includes(node.sourceId)
  )
  expect(ownedFields.map((node) => node.sourceId)).toEqual(keys)
  for (const field of ownedFields) {
    expect(field.validationScopeMarker).toBe(true)
    expect(field.attrs[FORM_RESET_FIELD_ATTRIBUTE]).toBe(field.sourceId)
  }
  expect(ir.warnings).toEqual([])
})

test('Walktour fields inside a clean component instance join the native FORM owner', () => {
  const { graph, page, main, conditional } = walktourGraph(),
    library = graph.addPage('Library'),
    master = graph.createNode('COMPONENT', library.id, { name: 'Guide fields' })
  graph.reparentNode(main.id, master.id)
  graph.updateNode(conditional.id, { renderCondition: undefined })
  graph.createNode('INPUT', main.id, {
    name: 'Bound guide field',
    bindings: { value: { kind: 'docState', docStateName: 'field' } },
    interactiveProps: { validation: { required: true } }
  })
  const form = graph.createNode('FORM', page.id),
    instance = graph.createInstance(master.id, form.id)
  if (!instance) throw new Error('Missing guide instance')
  const guide = graph.getChildren(instance.id)[0]
  if (!guide) throw new Error('Missing cloned guide')
  const field = graph.getChildren(guide.id).find((node) => node.name === 'Bound guide field')
  if (!field) throw new Error('Missing cloned guide field')
  const ir = collectTree(graph, page.id, buildComponentRegistry(graph)),
    owner = moduleElement(ir.children, form.id)
  expect(owner.formValidationKeys).toEqual([field.id])
  expect(owner.formResetFields?.map((reset) => reset.sourceIds)).toEqual([[field.id]])
  expect(owner.children[0].kind).toBe('element')
  expect(ir.warnings).toEqual([])
})

test('a GROUP remains one scoped target and step reordering cannot reorder authored children', () => {
  const { graph, page, main, profile } = walktourGraph()
  graph.updateNode(profile.id, { type: 'GROUP' })
  graph.createNode('TEXT', profile.id, { x: 0, y: 0, width: 90, height: 28, text: 'Group first' })
  graph.createNode('TEXT', profile.id, {
    x: 110,
    y: 10,
    width: 100,
    height: 30,
    text: 'Group second'
  })
  const parsed = validateModuleInstance(main.interactiveProps?.module),
    steps = parsed.ok ? parsed.value.config.steps : undefined
  if (!parsed.ok || !Array.isArray(steps)) throw new Error('Missing module')
  const module = parsed.value
  graph.updateNode(main.id, {
    interactiveProps: {
      module: { ...module, config: { ...module.config, steps: [...steps].reverse() } }
    }
  })
  const node = moduleElement(collectTree(graph, page.id).children, main.id),
    slots = moduleContentNodes(node) ?? [],
    target = slots.find((slot) => slot.name === 'target-profile')
  expect(target?.nodes).toHaveLength(1)
  expect(slots.flatMap((slot) => slot.nodes)).toEqual(node.children)
  expect(JSON.stringify(target?.nodes)).toContain('Group first')
  expect(JSON.stringify(target?.nodes)).toContain('Group second')
})
