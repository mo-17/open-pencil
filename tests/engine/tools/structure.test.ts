import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#tests/helpers/assert'
import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

describe('delete_node', () => {
  test('removes a node', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()

    const tool = getTool('delete_node')
    tool.execute(figma, { id: rect.id })

    expect(figma.getNodeById(rect.id)).toBeNull()
  })
})

describe('clone_node', () => {
  test('duplicates a node', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    rect.name = 'Original'
    rect.resize(100, 100)

    const tool = getTool('clone_node')
    const result = tool.execute(figma, { id: rect.id }) as ToolResult

    expect(result.id).not.toBe(rect.id)
    expect(result.name).toBe('Original')
  })
})

describe('rename_node', () => {
  test('renames a node', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()

    const tool = getTool('rename_node')
    tool.execute(figma, { id: rect.id, name: 'My Rectangle' })

    expect(expectDefined(figma.getNodeById(rect.id), 'renamed rectangle').name).toBe('My Rectangle')
  })
})

describe('reparent_node', () => {
  test('moves node into frame', () => {
    const { figma } = setupToolTest()
    const frame = figma.createFrame()
    frame.resize(300, 300)
    const rect = figma.createRectangle()
    rect.resize(50, 50)

    const tool = getTool('reparent_node')
    tool.execute(figma, { id: rect.id, parent_id: frame.id })

    expect(
      expectDefined(figma.getNodeById(frame.id), 'target frame').children.some(
        (c) => c.id === rect.id
      )
    ).toBe(true)
  })
})

describe('reparent_nodes', () => {
  test('moves a batch at an exact index while preserving order and absolute position', () => {
    const { figma, graph } = setupToolTest()
    const source = figma.createFrame()
    source.x = 100
    source.y = 50
    const first = figma.createRectangle()
    const second = figma.createRectangle()
    source.appendChild(first)
    source.appendChild(second)
    first.x = 10
    first.y = 20
    second.x = 30
    second.y = 40
    const firstAbsolute = graph.getAbsolutePosition(first.id)
    const secondAbsolute = graph.getAbsolutePosition(second.id)

    const target = figma.createFrame()
    target.x = 400
    const before = figma.createRectangle()
    const after = figma.createRectangle()
    target.appendChild(before)
    target.appendChild(after)

    const result = getTool('reparent_nodes').execute(figma, {
      ids: [first.id, second.id],
      parent_id: target.id,
      insert_index: 1
    }) as { ok: boolean; data?: { moved: Array<{ id: string; index: number }> } }

    expect(result.ok).toBe(true)
    expect(graph.getNode(target.id)?.childIds).toEqual([before.id, first.id, second.id, after.id])
    expect(graph.getAbsolutePosition(first.id)).toEqual(firstAbsolute)
    expect(graph.getAbsolutePosition(second.id)).toEqual(secondAbsolute)
    expect(result.data?.moved).toEqual([
      { id: first.id, index: 1 },
      { id: second.id, index: 2 }
    ])
  })

  test('validates the whole request before mutation', () => {
    const { figma, graph } = setupToolTest()
    const source = figma.createFrame()
    const child = figma.createRectangle()
    source.appendChild(child)
    const target = figma.createFrame()
    const originalParent = graph.getNode(child.id)?.parentId

    const result = getTool('reparent_nodes').execute(figma, {
      ids: [child.id, 'missing'],
      parent_id: target.id
    }) as { ok: boolean; error?: string }

    expect(result.ok).toBe(false)
    expect(result.error).toContain('missing')
    expect(graph.getNode(child.id)?.parentId).toBe(originalParent)
  })

  test('does not accept a scene-version precondition without an editor host', () => {
    const { figma, graph } = setupToolTest()
    const child = figma.createRectangle()
    const target = figma.createFrame()
    const originalParent = graph.getNode(child.id)?.parentId

    const result = getTool('reparent_nodes').execute(figma, {
      ids: [child.id],
      parent_id: target.id,
      expected_scene_version: 1
    }) as { ok: boolean; error?: string }

    expect(result).toEqual({
      ok: false,
      error: 'expected_scene_version requires an editor-backed MCP host'
    })
    expect(graph.getNode(child.id)?.parentId).toBe(originalParent)
  })

  test('rejects a subtree whose component reference would recurse into the target', () => {
    const { figma, graph } = setupToolTest()
    const component = figma.createComponent()
    const wrapper = figma.createFrame()
    const instance = graph.createInstance(component.id, wrapper.id)
    expect(instance).toBeDefined()
    const originalParent = graph.getNode(wrapper.id)?.parentId

    const result = getTool('reparent_nodes').execute(figma, {
      ids: [wrapper.id],
      parent_id: component.id
    }) as { ok: boolean; error?: string }

    expect(result.ok).toBe(false)
    expect(result.error).toContain('component/instance reference cycle')
    expect(graph.getNode(wrapper.id)?.parentId).toBe(originalParent)
    expect(graph.getNode(component.id)?.childIds).toEqual([])
  })

  test('rejects a transitive component reference cycle without moving the node', () => {
    const { figma, graph } = setupToolTest()
    const componentA = figma.createComponent()
    const componentB = figma.createComponent()
    const bInsideA = graph.createInstance(componentB.id, componentA.id)
    const instanceA = graph.createInstance(componentA.id, figma.currentPage.id)
    expect(bInsideA).toBeDefined()
    expect(instanceA).toBeDefined()
    const originalParent = instanceA?.parentId

    const result = getTool('reparent_nodes').execute(figma, {
      ids: [expectDefined(instanceA, 'instance A').id],
      parent_id: componentB.id
    }) as { ok: boolean; error?: string }

    expect(result.ok).toBe(false)
    expect(result.error).toContain('component/instance reference cycle')
    expect(graph.getNode(expectDefined(instanceA, 'instance A').id)?.parentId).toBe(originalParent)
    expect(graph.getNode(componentB.id)?.childIds).toEqual([])
  })
})

describe('group_nodes', () => {
  test('groups two nodes', () => {
    const { figma } = setupToolTest()
    const r1 = figma.createRectangle()
    r1.resize(50, 50)
    const r2 = figma.createRectangle()
    r2.resize(50, 50)

    const tool = getTool('group_nodes')
    const result = tool.execute(figma, { ids: [r1.id, r2.id] }) as ToolResult

    expect(result.type).toBe('GROUP')
    const group = expectDefined(
      figma.getNodeById(expectDefined(result.id, 'group id')),
      'created group'
    )
    expect(group.children.length).toBe(2)
  })
})
