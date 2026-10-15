import { describe, expect, mock, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { renderTableModulePreview, visibleTableRows } from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  createTableModuleFrameOverrides,
  createTableModuleInstance,
  type TableModuleConfigV1
} from '#core/plugins/table'

import { canvasMock, createMockCanvas } from '#tests/engine/render/canvas/effects/helpers'
import { asCanvas } from '#tests/engine/render/canvas/helpers'

import { moduleTextRenderer, paragraphText } from './modules/helpers'

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
  return { renderer: moduleTextRenderer({ labelFont: labelFont as never }), labelFont }
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
    const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    const { renderer, labelFont } = rendererWithFont()

    expect(renderTableModulePreview(renderer, asCanvas(canvas), tableFrame())).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(9)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect.mock.calls.length).toBeGreaterThanOrEqual(7)
    expect(canvas.drawParagraph).toHaveBeenCalledTimes(8)
    expect(canvas.drawParagraph.mock.calls.map((call) => paragraphText(call[0]))).toEqual([
      'Name',
      'Status',
      'Landing',
      'Ready',
      'Mobile',
      'Review',
      'System',
      'Draft'
    ])
    expect(canvas.restore).toHaveBeenCalledTimes(canvas.save.mock.calls.length)
    expect(labelFont.getSize).toHaveBeenCalledTimes(9)
    expect(labelFont.setSize.mock.calls.map((call) => call[0])).toEqual([14, 11])
  })

  test('restores the shared preview font when cell drawing fails', () => {
    const canvas = {
      ...createMockCanvas(),
      drawParagraph: mock(() => {
        throw new Error('draw failed')
      })
    }
    const { renderer, labelFont } = rendererWithFont()

    expect(() => renderTableModulePreview(renderer, asCanvas(canvas), tableFrame())).toThrow(
      'draw failed'
    )
    expect(canvas.restore).toHaveBeenCalledTimes(canvas.save.mock.calls.length)
    expect(labelFont.setSize.mock.calls.map((call) => call[0])).toEqual([14, 11])
  })

  test('regular FRAME rendering dispatches table and invalid identities fail closed', () => {
    const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    const { renderer } = rendererWithFont()
    renderShapeUncached(renderer, asCanvas(canvas), tableFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawParagraph).toHaveBeenCalled()

    const invalid = tableFrame({
      interactiveProps: {
        module: { ...createTableModuleInstance(CONFIG), moduleType: 'unknown' }
      }
    })
    const invalidCanvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(renderTableModulePreview(renderer, asCanvas(invalidCanvas), invalid)).toBe(false)
    expect(invalidCanvas.drawParagraph).not.toHaveBeenCalled()
  })
})
