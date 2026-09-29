import { describe, expect, mock, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createSceneGeometry } from '@open-pencil/core/geometry'
import { createTabsModuleFrameOverrides } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

function setup(orientation: 'horizontal' | 'vertical' = 'horizontal', withRenderer = true) {
  const editor = createEditor()
  if (withRenderer) {
    editor.setCanvasKit(
      {} as Parameters<typeof editor.setCanvasKit>[0],
      {
        invalidateNodePicture: mock(),
        tiledScene: { invalidateStructure: mock(), invalidateNode: mock() }
      } as Parameters<typeof editor.setCanvasKit>[1]
    )
  }
  const tabs = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    ...createTabsModuleFrameOverrides({
      tabs: [
        { id: 'overview', label: 'Overview', content: '', contentChildName: 'Overview panel' },
        { id: 'details', label: 'Details', content: '', contentChildName: 'Details panel' }
      ],
      initialTabId: 'overview',
      orientation
    }),
    x: 100,
    y: 100,
    width: 320,
    height: 300
  })
  const panels = ['Overview panel', 'Details panel'].map((name) => {
    const panel = editor.graph.createNode('FRAME', tabs.id, {
      name,
      x: orientation === 'horizontal' ? 16 : 128,
      y: orientation === 'horizontal' ? 70 : 16,
      width: 288,
      height: 200
    })
    const child = editor.graph.createNode('RECTANGLE', panel.id, {
      x: 10,
      y: 10,
      width: 40,
      height: 40
    })
    return { panel, child }
  })
  function point(node: SceneNode, x = 20, y = 20) {
    return createSceneGeometry(editor.graph).toWorld(node, { x, y })
  }
  return { editor, tabs, panels, point }
}

describe('Tabs canvas selection', () => {
  test('page queries work without a renderer while preserving Tabs presentation and the interactive gate', () => {
    const { editor, panels, point } = setup('horizontal', false)
    const position = point(panels[0].child)
    editor.enterContainer(panels[1].panel.id)
    expect(editor.hitTestAtPoint(position.x, position.y, true)).toBeNull()
    expect(editor.hitTestPageAtPoint(position.x, position.y)?.id).toBe(panels[0].child.id)
    expect(editor.state.enteredContainerId).toBe(panels[1].panel.id)
    expect(panels.map(({ panel }) => panel.visible)).toEqual([true, true])
  })

  test.each(['horizontal', 'vertical'] as const)(
    '%s selects only active content',
    (orientation) => {
      const { editor, panels, point } = setup(orientation)
      const position = point(panels[0].child)
      expect(editor.hitTestAtPoint(position.x, position.y, true)?.id).toBe(panels[0].child.id)
      expect(panels.map(({ panel }) => panel.visible)).toEqual([true, true])
    }
  )

  test('switching the active tab updates point, drop and marquee selection immediately', () => {
    const { editor, tabs, panels, point } = setup()
    const position = point(panels[0].child)
    editor.graph.updateNode(
      tabs.id,
      createTabsModuleFrameOverrides({
        tabs: [
          { id: 'overview', label: 'Overview', content: '', contentChildName: 'Overview panel' },
          { id: 'details', label: 'Details', content: '', contentChildName: 'Details panel' }
        ],
        initialTabId: 'details'
      })
    )
    expect(editor.hitTestAtPoint(position.x, position.y, true)?.id).toBe(panels[1].child.id)
    expect(editor.hitTestFrameAtPoint(position.x, position.y)?.id).toBe(panels[1].panel.id)
    expect(editor.getCanvasSelectionChildren(tabs.id).map((node) => node.id)).toEqual([
      panels[1].panel.id
    ])
    expect(editor.getCanvasSelectionChildren(panels[0].panel.id)).toEqual([])
    expect(panels.map(({ panel }) => panel.visible)).toEqual([true, true])
  })

  test('an entered inactive subtree cannot bypass the presentation filter', () => {
    const { editor, panels, point } = setup()
    const position = point(panels[1].child)
    editor.enterContainer(panels[1].panel.id)
    expect(editor.hitTestAtPoint(position.x, position.y, true)?.id).toBe(panels[0].child.id)
    expect(editor.state.enteredContainerId).toBeNull()
    expect(editor.hitTestAtPoint(position.x, position.y, true, panels[1].panel.id)).toBeNull()
  })

  test.each(['missing', 'duplicate'] as const)(
    'an invalid %s content name does not expose unassigned layers',
    (kind) => {
      const { editor, tabs, panels, point } = setup()
      if (kind === 'missing') editor.graph.updateNode(panels[0].panel.id, { name: 'Renamed' })
      else editor.graph.updateNode(panels[1].panel.id, { name: 'Overview panel' })
      const position = point(panels[0].child)
      expect(editor.hitTestAtPoint(position.x, position.y, true)?.id).toBe(tabs.id)
      expect(editor.getCanvasSelectionChildren(tabs.id)).toEqual([])
    }
  )

  test('clipped header content cannot be selected through a nested entered scope', () => {
    const { editor, tabs, panels, point } = setup()
    editor.graph.updateNode(panels[0].child.id, { y: -60, height: 300 })
    const header = point(tabs, 46, 30)
    expect(editor.hitTestAtPoint(header.x, header.y, true)?.id).toBe(tabs.id)
    editor.enterContainer(panels[0].panel.id)
    expect(editor.hitTestAtPoint(header.x, header.y, true)).toBeNull()
    const body = point(tabs, 46, 110)
    expect(editor.hitTestAtPoint(body.x, body.y, true)?.id).toBe(panels[0].child.id)
  })

  test('rotation and nesting preserve the same panel clipping and drop geometry', () => {
    const { editor, tabs, panels, point } = setup('vertical')
    const wrapper = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      x: 200,
      y: 250,
      width: 600,
      height: 600,
      rotation: 25
    })
    editor.graph.reparentNode(tabs.id, wrapper.id)
    editor.graph.updateNode(tabs.id, { x: 100, y: 100, rotation: -40 })
    const position = point(panels[0].child)
    expect(editor.hitTestAtPoint(position.x, position.y, true)?.id).toBe(panels[0].child.id)
    expect(editor.hitTestFrameAtPoint(position.x, position.y)?.id).toBe(panels[0].panel.id)
    editor.enterContainer(panels[0].panel.id)
    expect(editor.hitTestAtPoint(position.x, position.y, true)?.id).toBe(panels[0].child.id)
    const sidebar = point(tabs, 40, 40)
    expect(editor.hitTestAtPoint(sidebar.x, sidebar.y, true)).toBeNull()
  })

  test('a visible FORM panel can select its fields, while hidden ancestors stay hidden', () => {
    const { editor, tabs, panels, point } = setup()
    editor.graph.updateNode(panels[0].panel.id, { type: 'FORM' })
    const position = point(panels[0].child)
    expect(editor.hitTestAtPoint(position.x, position.y, true)?.id).toBe(panels[0].child.id)
    editor.graph.updateNode(tabs.id, { visible: false })
    expect(editor.hitTestAtPoint(position.x, position.y, true, panels[0].panel.id)).toBeNull()
    expect(editor.getCanvasSelectionChildren(panels[0].panel.id)).toEqual([])
  })
})
