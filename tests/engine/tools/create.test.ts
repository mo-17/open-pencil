import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#tests/helpers/assert'
import { getTool, setupToolTest, type ToolResult } from '#tests/helpers/tools'

describe('create_shape', () => {
  test('creates a frame', () => {
    const { figma } = setupToolTest()
    const tool = getTool('create_shape')
    const result = tool.execute(figma, {
      type: 'FRAME',
      x: 100,
      y: 200,
      width: 300,
      height: 400,
      name: 'Test Frame'
    }) as ToolResult
    expect(result.name).toBe('Test Frame')
    expect(result.type).toBe('FRAME')

    const node = expectDefined(
      figma.getNodeById(expectDefined(result.id, 'created node id')),
      'created node'
    )
    expect(node.x).toBe(100)
    expect(node.y).toBe(200)
    expect(node.width).toBe(300)
    expect(node.height).toBe(400)
  })

  test('creates nested inside parent', () => {
    const { figma } = setupToolTest()
    const tool = getTool('create_shape')
    const parent = tool.execute(figma, {
      type: 'FRAME',
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      name: 'Parent'
    }) as ToolResult
    const child = tool.execute(figma, {
      type: 'RECTANGLE',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      parent_id: parent.id
    }) as ToolResult

    const parentNode = expectDefined(
      figma.getNodeById(expectDefined(parent.id, 'created parent id')),
      'created parent node'
    )
    expect(parentNode.children.some((c) => c.id === child.id)).toBe(true)
  })
})

describe('render', () => {
  test('renders JSX string', async () => {
    const { figma } = setupToolTest()
    const tool = getTool('render')
    const result = (await tool.execute(figma, {
      jsx: '<Frame name="Card" w={200} h={100} bg="#FFF"><Text>Hello</Text></Frame>'
    })) as ToolResult
    expect(result.name).toBe('Card')
    expect(result.type).toBe('FRAME')
    expect(result.children.length).toBeGreaterThan(0)
  })

  test('returns JSX warnings', async () => {
    const { figma } = setupToolTest()
    const tool = getTool('render')
    const result = (await tool.execute(figma, {
      jsx: '<Frame name="Card" w={200} h={100} mt={8} />'
    })) as ToolResult
    expect(result.warnings).toEqual(['Unsupported prop "mt" on <frame> is ignored.'])
  })

  test('rejects missing and non-container parents before creating roots', async () => {
    const { figma } = setupToolTest()
    const tool = getTool('render')
    const shapeParent = figma.createRectangle()
    const beforeIds = figma.currentPage.children.map((node) => node.id)

    await expect(
      tool.execute(figma, { parent_id: 'missing', jsx: '<Rectangle name="Orphan" />' })
    ).rejects.toThrow('Render parent "missing" not found')
    await expect(
      tool.execute(figma, {
        parent_id: shapeParent.id,
        jsx: '<Rectangle name="Invalid child" />'
      })
    ).rejects.toThrow('cannot contain children')

    expect(figma.currentPage.children.map((node) => node.id)).toEqual(beforeIds)
    expect(figma.currentPage.findAll((node) => node.name === 'Orphan')).toHaveLength(0)
    expect(figma.currentPage.findAll((node) => node.name === 'Invalid child')).toHaveLength(0)
  })

  test('rejects a missing replacement instead of silently appending the result', async () => {
    const { figma } = setupToolTest()
    const beforeIds = figma.currentPage.children.map((node) => node.id)

    await expect(
      getTool('render').execute(figma, {
        replace_id: 'missing',
        jsx: '<Rectangle name="Must not append" />'
      })
    ).rejects.toThrow('Replace target "missing" not found')

    expect(figma.currentPage.children.map((node) => node.id)).toEqual(beforeIds)
  })

  test('inserts every fragment root as one contiguous block', async () => {
    const { figma, graph } = setupToolTest()
    const before = figma.createRectangle()
    const after = figma.createRectangle()

    const result = (await getTool('render').execute(figma, {
      insert_index: 1,
      jsx: '<><Rectangle name="First root" /><Rectangle name="Second root" /></>'
    })) as ToolResult
    const siblings = result.siblings as Array<{ id: string; index: number }>

    expect(graph.getNode(figma.currentPage.id)?.childIds).toEqual([
      before.id,
      result.id,
      siblings[0]?.id,
      after.id
    ])
    expect(result.index).toBe(1)
    expect(siblings).toEqual([
      { id: siblings[0]?.id, name: 'Second root', type: 'RECTANGLE', index: 2 }
    ])
  })

  test('replaces one target with the complete fragment and ignores explicit placement', async () => {
    const { figma, graph } = setupToolTest()
    const target = figma.createRectangle()
    const after = figma.createRectangle()
    const ignoredParent = figma.createFrame()

    const result = (await getTool('render').execute(figma, {
      replace_id: target.id,
      parent_id: ignoredParent.id,
      insert_index: 99,
      jsx: '<><Rectangle name="Replacement A" /><Rectangle name="Replacement B" /></>'
    })) as ToolResult
    const siblings = result.siblings as Array<{ id: string; index: number }>

    expect(graph.getNode(target.id)).toBeUndefined()
    expect(graph.getNode(figma.currentPage.id)?.childIds).toEqual([
      result.id,
      siblings[0]?.id,
      after.id,
      ignoredParent.id
    ])
    expect(result).toMatchObject({
      parent_id: figma.currentPage.id,
      index: 0,
      replaced_id: target.id
    })
    expect(siblings[0]?.index).toBe(1)
    expect(graph.getNode(ignoredParent.id)?.childIds).toEqual([])
  })

  test('defers render layout when the host owns the post-tool pass', async () => {
    const { figma } = setupToolTest()
    const tool = getTool('render')
    const result = (await tool.execute(
      figma,
      {
        jsx: '<Frame name="Deferred" flex="row" p={24}><Rectangle name="Child" w={20} h={20} /></Frame>'
      },
      { deferLayout: true }
    )) as ToolResult
    const childId = expectDefined((result.children as string[])[0], 'rendered child id')
    const child = expectDefined(figma.getNodeById(childId), 'rendered child')

    expect(child.x).toBe(0)
    expect(child.y).toBe(0)
  })

  test('get_node exposes text style fields', async () => {
    const { figma } = setupToolTest()
    const render = getTool('render')
    const card = (await render.execute(figma, {
      jsx: '<Frame name="Card" w={200} h={100}><Text name="Title" size={24} weight={700} font="Inter" color="#111" textAlign="center">Hello</Text></Frame>'
    })) as ToolResult
    const textId = (card.children as string[])[0]
    const getNode = getTool('get_node')
    const result = getNode.execute(figma, { id: textId, depth: 0 }) as ToolResult

    expect(result.characters).toBe('Hello')
    expect(result.fontFamily).toBe('Inter')
    expect(result.fontSize).toBe(24)
    expect(result.fontWeight).toBe(700)
    expect(result.textAlignHorizontal).toBe('CENTER')
  })
})

describe('create_instance', () => {
  test('creates directly inside the requested parent at the requested index', () => {
    const { figma } = setupToolTest()
    const component = figma.createComponent()
    component.name = 'Card'
    const parent = figma.createFrame()
    const before = figma.createRectangle()
    const after = figma.createRectangle()
    parent.appendChild(before)
    parent.appendChild(after)

    const result = getTool('create_instance').execute(figma, {
      component_id: component.id,
      parent_id: parent.id,
      insert_index: 1,
      x: 24,
      y: 32
    }) as ToolResult

    expect(parent.children.map((child) => child.id)).toEqual([before.id, result.id, after.id])
    const instance = expectDefined(
      figma.getNodeById(expectDefined(result.id, 'created instance id')),
      'created instance'
    )
    expect(instance.x).toBe(24)
    expect(instance.y).toBe(32)
    expect(result).toMatchObject({ parent_id: parent.id, index: 1 })
  })

  test('validates the parent before creating an instance', () => {
    const { figma } = setupToolTest()
    const component = figma.createComponent()
    const beforeCount = figma.currentPage.children.length

    const result = getTool('create_instance').execute(figma, {
      component_id: component.id,
      parent_id: 'missing'
    }) as ToolResult

    expect(result.error).toContain('missing')
    expect(figma.currentPage.children).toHaveLength(beforeCount)
  })

  test('rejects a component master as the parent of its own instance', () => {
    const { figma, graph } = setupToolTest()
    const component = figma.createComponent()

    const result = getTool('create_instance').execute(figma, {
      component_id: component.id,
      parent_id: component.id
    }) as ToolResult

    expect(result.error).toContain('component/instance reference cycle')
    expect(graph.getNode(component.id)?.childIds).toEqual([])
    expect(graph.getInstances(component.id)).toEqual([])
  })

  test('rejects a transitive component reference cycle before creating an instance', () => {
    const { figma, graph } = setupToolTest()
    const componentA = figma.createComponent()
    componentA.name = 'A'
    const componentB = figma.createComponent()
    componentB.name = 'B'
    const bInsideA = graph.createInstance(componentB.id, componentA.id)
    expect(bInsideA).toBeDefined()
    const beforeBChildren = [...(graph.getNode(componentB.id)?.childIds ?? [])]

    const result = getTool('create_instance').execute(figma, {
      component_id: componentA.id,
      parent_id: componentB.id
    }) as ToolResult

    expect(result.error).toContain('component/instance reference cycle')
    expect(graph.getNode(componentB.id)?.childIds).toEqual(beforeBChildren)
    expect(graph.getInstances(componentA.id)).toEqual([])
  })
})
