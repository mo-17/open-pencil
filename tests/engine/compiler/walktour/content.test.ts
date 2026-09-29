import { expect, test } from 'bun:test'

import { moduleContentNodes } from '#compiler/modules/content-slots'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement, IRNode } from '@open-pencil/compiler/ir/types'

import { walktourGraph } from '#tests/helpers/compiler/components/walktour/fixture'

function moduleElement(children: readonly IRNode[], id: string): IRElement {
  const node = children.find((node) => node.kind === 'element' && node.sourceId === id)
  if (node?.kind !== 'element') throw new Error('Missing module element')
  return node
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
  expect(target).toBe(node.children[0])
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
  graph.createNode('INPUT', nested.id, {
    name: 'Nested field',
    bindings: { value: { kind: 'docState', docStateName: 'field' } },
    interactiveProps: { validation: { required: true } }
  })
  const ir = collectTree(graph, page.id),
    outer = moduleElement(ir.children, form.id)
  expect(outer.formValidationKeys).toEqual([field.id])
  const module = moduleElement(outer.children, main.id),
    input = moduleElement(module.children, field.id)
  expect(input.validationScopeMarker).toBe(true)
  expect(moduleContentNodes(module)?.flatMap((slot) => slot.nodes)).toContain(input)
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
  const module = main.interactiveProps?.module
  if (!module || !Array.isArray(module.config.steps)) throw new Error('Missing module')
  graph.updateNode(main.id, {
    interactiveProps: {
      module: { ...module, config: { ...module.config, steps: [...module.config.steps].reverse() } }
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
