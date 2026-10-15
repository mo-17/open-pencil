import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor, type Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

function state(nodes: SceneNode[]) {
  return nodes.map((node) => {
    const {
      id,
      x,
      y,
      width,
      height,
      layoutMode,
      itemSpacing,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      primaryAxisSizing,
      counterAxisSizing,
      primaryAxisAlign,
      counterAxisAlign,
      gridTemplateColumns,
      gridTemplateRows,
      gridColumnGap,
      gridRowGap
    } = node
    return structuredClone({
      id,
      x,
      y,
      width,
      height,
      layoutMode,
      itemSpacing,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      primaryAxisSizing,
      counterAxisSizing,
      primaryAxisAlign,
      counterAxisAlign,
      gridTemplateColumns,
      gridTemplateRows,
      gridColumnGap,
      gridRowGap
    })
  })
}

describe('layout mode transactions', () => {
  for (const mode of ['VERTICAL', 'HORIZONTAL', 'GRID'] as const) {
    for (const free of ['NONE', 'FREE'] as const) {
      test(`${mode} → ${free} → ${mode} retains configuration and geometry`, () => {
        const editor = createEditor()
        try {
          const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
            layoutMode: mode,
            width: 320,
            height: 240,
            itemSpacing: 16,
            paddingTop: 24,
            paddingRight: 24,
            paddingBottom: 24,
            paddingLeft: 24,
            primaryAxisSizing: 'FIXED',
            counterAxisSizing: 'FIXED',
            primaryAxisAlign: 'CENTER',
            counterAxisAlign: 'STRETCH',
            gridTemplateColumns: [
              { sizing: 'FIXED', value: 80 },
              { sizing: 'FR', value: 2 }
            ],
            gridTemplateRows: [{ sizing: 'FR', value: 1 }],
            gridColumnGap: 12,
            gridRowGap: 8
          })
          const children = [0, 1].map(() =>
            editor.graph.createNode('INPUT', parent.id, {
              width: 120,
              height: 44
            })
          )
          editor.runLayoutForNode(parent.id)
          const nodes = [parent, ...children]
          const original = state(nodes)
          for (let iteration = 0; iteration < 3; iteration++) {
            editor.setLayoutMode(parent.id, free)
            const disabled = state(nodes)
            editor.setLayoutMode(parent.id, mode)
            expect(state(nodes)).toEqual(original)
            editor.undoAction()
            expect(state(nodes)).toEqual(disabled)
            editor.redoAction()
            expect(state(nodes)).toEqual(original)
          }
        } finally {
          editor.dispose()
        }
      })
    }
  }

  test('undo restores a freely moved child and redo restores its reflow', () => {
    const editor = createEditor()
    try {
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        layoutMode: 'VERTICAL',
        width: 320,
        height: 240,
        itemSpacing: 16,
        paddingTop: 24,
        paddingLeft: 24
      })
      const first = editor.graph.createNode('RECTANGLE', parent.id, {
        width: 80,
        height: 40
      })
      const second = editor.graph.createNode('RECTANGLE', parent.id, {
        width: 100,
        height: 50
      })
      editor.runLayoutForNode(parent.id)
      editor.setLayoutMode(parent.id, 'NONE')
      editor.updateNode(first.id, { x: 77, y: 133 })
      const free = state([parent, first, second])
      editor.setLayoutMode(parent.id, 'VERTICAL')
      const automatic = state([parent, first, second])
      expect(first.x).toBe(24)
      editor.undoAction()
      expect(state([parent, first, second])).toEqual(free)
      editor.redoAction()
      expect(state([parent, first, second])).toEqual(automatic)
    } finally {
      editor.dispose()
    }
  })

  test('undo restores affected Hug ancestors and siblings', () => {
    const editor = createEditor()
    try {
      const outer = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        itemSpacing: 10
      })
      const parent = editor.graph.createNode('FRAME', outer.id, {
        layoutMode: 'NONE',
        width: 300,
        height: 240,
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG'
      })
      const sibling = editor.graph.createNode('RECTANGLE', outer.id, {
        width: 50,
        height: 30
      })
      const child = editor.graph.createNode('RECTANGLE', parent.id, {
        x: 80,
        y: 90,
        width: 100,
        height: 40
      })
      editor.runLayoutForNode(outer.id)
      const nodes = [outer, parent, sibling, child]
      const before = state(nodes)
      editor.setLayoutMode(parent.id, 'VERTICAL')
      const after = state(nodes)
      expect(parent.width).toBe(100)
      expect(sibling.x).toBe(110)
      editor.undoAction()
      expect(state(nodes)).toEqual(before)
      editor.redoAction()
      expect(state(nodes)).toEqual(after)
    } finally {
      editor.dispose()
    }
  })

  test('first activation preserves authored size and initializes only missing grid tracks', () => {
    const editor = createEditor()
    try {
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        width: 320,
        height: 240,
        itemSpacing: 12,
        paddingLeft: 20,
        gridTemplateColumns: [{ sizing: 'FIXED', value: 90 }],
        gridColumnGap: 8
      })
      editor.graph.createNode('RECTANGLE', parent.id, {
        width: 80,
        height: 40
      })
      editor.setLayoutMode(parent.id, 'VERTICAL')
      expect([
        parent.width,
        parent.height,
        parent.primaryAxisSizing,
        parent.counterAxisSizing
      ]).toEqual([320, 240, 'FIXED', 'FIXED'])
      editor.setLayoutMode(parent.id, 'GRID')
      expect(parent.gridTemplateColumns).toEqual([{ sizing: 'FIXED', value: 90 }])
      expect(parent.gridTemplateRows).toHaveLength(1)
      expect([parent.paddingLeft, parent.itemSpacing, parent.gridColumnGap]).toEqual([20, 12, 8])
    } finally {
      editor.dispose()
    }
  })

  test('reselecting the active mode does not create history', () => {
    const editor = createEditor()
    try {
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        layoutMode: 'VERTICAL'
      })
      editor.setLayoutMode(parent.id, 'VERTICAL')
      expect(editor.undo.canUndo).toBe(false)
    } finally {
      editor.dispose()
    }
  })

  test('mode changes cancel unfinished numeric previews before taking their baseline', () => {
    const editor = createEditor()
    try {
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        layoutMode: 'VERTICAL',
        width: 320,
        height: 240
      })
      const preview = editor.beginNodePreview()
      preview.update(parent.id, { width: 500 })
      editor.setLayoutMode(parent.id, 'NONE')
      expect(preview.closed).toBe(true)
      expect(parent.width).toBe(320)
      preview.commit()
      editor.undoAction()
      expect([parent.layoutMode, parent.width]).toEqual(['VERTICAL', 320])
      expect(editor.undo.canUndo).toBe(false)
    } finally {
      editor.dispose()
    }
  })

  test('layout geometry and imported source metadata replay together', () => {
    const editor = createEditor()
    try {
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        layoutMode: 'NONE',
        width: 320,
        height: 240,
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        itemSpacing: 12
      })
      const first = editor.graph.createNode('RECTANGLE', parent.id, {
        x: 70,
        y: 90,
        width: 100,
        height: 40
      })
      const second = editor.graph.createNode('RECTANGLE', parent.id, {
        x: 180,
        y: 160,
        width: 100,
        height: 40
      })
      parent.source.fig.layout = { stackMode: 'NONE', stackSpacing: 12 }
      const nodes = [parent, first, second]
      for (const node of nodes) {
        node.source.fig.rawSize = { x: node.width, y: node.height }
        node.source.fig.rawTransform = {
          m00: 1,
          m01: 0,
          m02: node.x,
          m10: 0,
          m11: 1,
          m12: node.y
        }
        node.source.fig.rawNodeFields = { arbitraryPreservedField: 42 }
      }
      const snapshot = () => ({
        geometry: state(nodes),
        source: structuredClone(nodes.map((n) => n.source))
      })
      const before = snapshot()
      editor.setLayoutMode(parent.id, 'VERTICAL')
      expect(parent.source.fig.layout).toEqual({
        stackMode: 'VERTICAL',
        stackSpacing: 12
      })
      expect(parent.source.fig.rawSize).toBeNull()
      expect(first.source.fig.rawTransform).toBeNull()
      expect(second.source.fig.rawTransform).toBeNull()
      expect(first.source.fig.rawSize).toEqual({ x: 100, y: 40 })
      expect(first.source.fig.rawNodeFields).toEqual({
        arbitraryPreservedField: 42
      })
      const after = snapshot()
      editor.undoAction()
      expect(snapshot()).toEqual(before)
      editor.redoAction()
      expect(snapshot()).toEqual(after)
    } finally {
      editor.dispose()
    }
  })
})

function scene() {
  const editor = createEditor()
  const outer = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    x: 100,
    y: 100,
    width: 500,
    height: 300,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    itemSpacing: 24,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20
  })
  const frame = editor.graph.createNode('FRAME', outer.id, {
    width: 260,
    height: 180
  })
  const first = editor.graph.createNode('RECTANGLE', frame.id, {
    x: 20,
    y: 35,
    width: 90,
    height: 40
  })
  const second = editor.graph.createNode('FRAME', frame.id, {
    x: 145,
    y: 95,
    width: 80,
    height: 55,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    paddingLeft: 10,
    paddingTop: 10,
    paddingRight: 10,
    paddingBottom: 10,
    layoutAlignSelf: 'STRETCH'
  })
  editor.graph.createNode('RECTANGLE', second.id, {
    width: 60,
    height: 20,
    layoutGrow: 1
  })
  const sibling = editor.graph.createNode('RECTANGLE', outer.id, {
    width: 100,
    height: 70
  })
  editor.runLayoutForNode(outer.id)
  editor.select([frame.id])
  return { editor, outer, frame, first, second, sibling }
}

function layoutState(editor: Editor) {
  return [...editor.graph.nodes.values()].map((node) => ({
    id: node.id,
    parentId: node.parentId,
    childIds: [...node.childIds],
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    layoutMode: node.layoutMode,
    primaryAxisSizing: node.primaryAxisSizing,
    counterAxisSizing: node.counterAxisSizing,
    itemSpacing: node.itemSpacing,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    gridTemplateColumns: structuredClone(node.gridTemplateColumns),
    gridTemplateRows: structuredClone(node.gridTemplateRows)
  }))
}

describe('layout mode history', () => {
  for (const mode of ['VERTICAL', 'HORIZONTAL', 'GRID'] as const) {
    test(`undo adding ${mode} restores children, descendants, and surrounding Hug layout exactly`, () => {
      const { editor, frame, first } = scene()
      try {
        const before = layoutState(editor)
        editor.setLayoutMode(frame.id, mode)
        const after = layoutState(editor)
        expect(after).not.toEqual(before)
        expect(first.y).not.toBe(35)
        for (let cycle = 0; cycle < 2; cycle++) {
          editor.undoAction()
          expect(layoutState(editor)).toEqual(before)
          expect(editor.undo.canUndo).toBe(false)
          editor.redoAction()
          expect(layoutState(editor)).toEqual(after)
        }
      } finally {
        editor.dispose()
      }
    })
  }

  test('switching direction and removing layout each restore the previous geometry in one undo step', () => {
    const { editor, frame } = scene()
    try {
      editor.setLayoutMode(frame.id, 'VERTICAL')
      const vertical = layoutState(editor)
      editor.setLayoutMode(frame.id, 'HORIZONTAL')
      const horizontal = layoutState(editor)
      editor.setLayoutMode(frame.id, 'NONE')
      editor.undoAction()
      expect(layoutState(editor)).toEqual(horizontal)
      editor.undoAction()
      expect(layoutState(editor)).toEqual(vertical)
    } finally {
      editor.dispose()
    }
  })

  test('setting the existing layout mode leaves undo history untouched', () => {
    const { editor, frame } = scene()
    try {
      editor.setLayoutMode(frame.id, 'NONE')
      expect(editor.undo.canUndo).toBe(false)
    } finally {
      editor.dispose()
    }
  })
})

test('undo wrapping a nested selection restores parent order and all affected geometry', () => {
  const { editor, frame, first, second } = scene()
  try {
    editor.select([second.id, first.id])
    const before = layoutState(editor)
    editor.wrapInAutoLayout()
    const after = layoutState(editor)
    for (let cycle = 0; cycle < 2; cycle++) {
      editor.undoAction()
      expect(layoutState(editor)).toEqual(before)
      expect(editor.state.selectedIds).toEqual(new Set([second.id, first.id]))
      expect(frame.childIds).toEqual([first.id, second.id])
      expect(editor.undo.canUndo).toBe(false)
      editor.redoAction()
      expect(layoutState(editor)).toEqual(after)
    }
  } finally {
    editor.dispose()
  }
})

// Figma places a new container in the slot of the topmost selected layer.
test('the wrapper takes the slot of the topmost selected layer', () => {
  const editor = createEditor()
  try {
    const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      width: 600,
      height: 200
    })
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((name, index) =>
      editor.graph.createNode('RECTANGLE', parent.id, {
        name,
        x: 20 + index * 140,
        y: 40,
        width: 80,
        height: 60
      })
    )
    editor.select([d.id, b.id])
    const frameId = editor.wrapInAutoLayout()
    expect(parent.childIds).toEqual([a.id, c.id, expectDefined(frameId, 'wrapper')])
    editor.undoAction()
    expect(parent.childIds).toEqual([a.id, b.id, c.id, d.id])
  } finally {
    editor.dispose()
  }
})
