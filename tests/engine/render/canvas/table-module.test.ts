import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { renderTableModulePreview, visibleTableRows } from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  createTableModuleFrameOverrides,
  createTableModuleInstance,
  type TableModuleConfigV1
} from '#core/plugins/table'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

const CONFIG: TableModuleConfigV1 = {
  table: {
    columns: ['Name', 'Status'],
    rows: [
      ['Landing', 'Ready'],
      ['Mobile', 'Review'],
      ['System', 'Draft']
    ]
  },
  showHeader: true,
  striped: true,
  borderColor: '#D1D5DB',
  headerBackground: '#F3F4F6',
  textColor: '#111827',
  fontSize: 14
}

function tableFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'table-1', 'FRAME', {
    ...createTableModuleFrameOverrides(CONFIG),
    width: 400,
    height: 180,
    ...overrides
  })
}

function rendererWithFont() {
  let fontSize = 11
  const labelFont = {
    getGlyphIDs: (value: string) => Array.from(value, (_, index) => index),
    getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6),
    getSize: mock(() => fontSize),
    setSize: mock((value: number) => {
      fontSize = value
    })
  }
  return { renderer: createMockRenderer({ zoom: 1, labelFont: labelFont as never }), labelFont }
}

describe('table module canvas preview', () => {
  test('bounds visible rows to frame height', () => {
    expect(visibleTableRows(CONFIG, 60)).toEqual({
      rows: [CONFIG.table.rows[0]],
      headerRows: 1,
      rowHeight: 22
    })
    expect(visibleTableRows({ ...CONFIG, showHeader: false }, 60).rows).toHaveLength(2)
    expect(visibleTableRows({ ...CONFIG, fontSize: 72 }, 360).rowHeight).toBeCloseTo(100.8)
  })

  test('draws the inline grid, headers, stripes, and bounded cell labels', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const { renderer, labelFont } = rendererWithFont()

    expect(renderTableModulePreview(renderer, canvas as Canvas, tableFrame())).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect.mock.calls.length).toBeGreaterThanOrEqual(7)
    expect(canvas.drawText).toHaveBeenCalledTimes(8)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual([
      'Name',
      'Status',
      'Landing',
      'Ready',
      'Mobile',
      'Review',
      'System',
      'Draft'
    ])
    expect(canvas.restore).toHaveBeenCalledTimes(1)
    expect(labelFont.getSize).toHaveBeenCalledTimes(1)
    expect(labelFont.setSize.mock.calls.map((call) => call[0])).toEqual([14, 11])
  })

  test('restores the shared preview font when cell drawing fails', () => {
    const canvas = {
      ...createMockCanvas(),
      drawText: mock(() => {
        throw new Error('draw failed')
      })
    }
    const { renderer, labelFont } = rendererWithFont()

    expect(() => renderTableModulePreview(renderer, canvas as Canvas, tableFrame())).toThrow(
      'draw failed'
    )
    expect(canvas.restore).toHaveBeenCalledTimes(1)
    expect(labelFont.setSize.mock.calls.map((call) => call[0])).toEqual([14, 11])
  })

  test('regular FRAME rendering dispatches table and invalid identities fail closed', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const { renderer } = rendererWithFont()
    renderShapeUncached(renderer, canvas as Canvas, tableFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawText).toHaveBeenCalled()

    const invalid = tableFrame({
      interactiveProps: {
        module: { ...createTableModuleInstance(CONFIG), moduleType: 'unknown' }
      }
    })
    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(renderTableModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawText).not.toHaveBeenCalled()
  })
})
