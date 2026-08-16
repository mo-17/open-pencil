import { describe, expect, test } from 'bun:test'

import { createDefaultEditorState, createEditor } from '@open-pencil/core/editor'
import type { MotionSpec } from '@open-pencil/scene-graph'

import { createCanvasPaneRegistry } from '@/app/editor/panes/registry'
import {
  closePaneNode,
  leafPaneIds,
  MAX_VISIBLE_CANVAS_PANES,
  normalizeSplitSizes,
  paneCount,
  splitPaneNode,
  updateSplitSizes
} from '@/app/editor/panes/split-tree'
import type { CanvasSplitNode } from '@/app/editor/panes/split-tree'

const MOTION: MotionSpec = {
  version: 1,
  tracks: [
    {
      id: 'pane-preview',
      trigger: 'mount',
      keyframes: [
        { offset: 0, x: 0 },
        { offset: 1, x: 100 }
      ],
      timing: { durationMs: 100, easing: 'linear' }
    }
  ]
}

describe('canvas split tree', () => {
  test('splits panes and collapses one-child parents', () => {
    const initial: CanvasSplitNode = { type: 'pane', paneId: 'a' }
    const split = splitPaneNode(initial, 'a', 'b', 'split-1', 'horizontal')

    expect(paneCount(split)).toBe(2)
    expect(leafPaneIds(split)).toEqual(['a', 'b'])
    expect(closePaneNode(split, 'a')).toEqual({ type: 'pane', paneId: 'b' })
  })

  test('normalizes valid sizes and rejects invalid updates', () => {
    const split = splitPaneNode({ type: 'pane', paneId: 'a' }, 'a', 'b', 'split-1', 'vertical')
    expect(normalizeSplitSizes(2, [1, 3])).toEqual([25, 75])
    expect(updateSplitSizes(split, 'split-1', [30, 70])).toMatchObject({ sizes: [30, 70] })
    expect(updateSplitSizes(split, 'split-1', [100])).toEqual(split)
  })
})

describe('canvas pane registry', () => {
  test('clones view state without cloning selection or transient interaction state', () => {
    const state = createDefaultEditorState('page')
    state.selectedIds = new Set(['selected'])
    state.hoveredNodeId = 'hovered'
    const registry = createCanvasPaneRegistry(state)
    const first = registry.getActivePane()
    const second = registry.splitPane(first.id, 'horizontal')

    expect(second?.currentPageId).toBe('page')
    expect(second?.selectedIds.size).toBe(0)
    expect(second?.hoveredNodeId).toBeNull()
    expect(registry.visiblePaneCount.value).toBe(2)
    expect(state.selectedIds.size).toBe(0)

    state.panX = 120
    expect(registry.setActivePane(first.id)).toBe(true)
    expect(second?.panX).toBe(120)
    expect(state.selectedIds).toEqual(new Set(['selected']))
    expect(state.panX).toBe(0)
  })

  test('refuses the last close and enforces the pane cap', () => {
    const registry = createCanvasPaneRegistry(createDefaultEditorState('page'))
    expect(registry.closePane(registry.activePaneId.value)).toBe(false)

    while (registry.visiblePaneCount.value < MAX_VISIBLE_CANVAS_PANES) {
      expect(registry.splitPane(registry.activePaneId.value, 'horizontal')).not.toBeNull()
    }
    expect(registry.splitPane(registry.activePaneId.value, 'vertical')).toBeNull()
  })

  test('does not snapshot or revive a stopped editor-owned Motion preview', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const node = editor.graph.createNode('RECTANGLE', pageId, {
      width: 100,
      height: 100,
      motion: MOTION
    })
    const registry = createCanvasPaneRegistry(editor.state)
    const first = registry.getActivePane()

    expect(editor.previewMotion([node.id])).toBe(true)
    const previewId = editor.state.motionPreview?.id
    const second = registry.splitPane(first.id, 'horizontal')

    expect(second).not.toBeNull()
    expect(editor.state.motionPreview?.id).toBe(previewId)
    expect(registry.getPaneRenderState(first.id).motionPreview?.id).toBe(previewId)
    expect(Object.hasOwn(first, 'motionPreview')).toBe(false)
    expect(second ? Object.hasOwn(second, 'motionPreview') : true).toBe(false)

    expect(editor.stopMotionPreview()).toBe(true)
    expect(editor.state.motionPreview).toBeNull()
    expect(registry.setActivePane(first.id)).toBe(true)
    expect(editor.state.motionPreview).toBeNull()
    expect(editor.isMotionPreviewActive()).toBe(false)
  })
})
