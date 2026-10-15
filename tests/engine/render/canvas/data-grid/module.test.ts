import { describe, expect, mock, test } from 'bun:test'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  DATA_GRID_MODULE_CANVAS_ADAPTER,
  renderDataGridModulePreview,
  visibleDataGridRows
} from '#core/canvas/modules/data-grid'
import {
  createDataGridModuleFrameOverrides,
  createDataGridModuleInstance,
  type DataGridModuleConfigV1
} from '#core/plugins/data-grid'

import {
  canvasMock,
  createMockCanvas,
  createMockRenderer
} from '#tests/engine/render/canvas/effects/helpers'
import { asCanvas, textLayoutDouble } from '#tests/engine/render/canvas/helpers'
import { paragraphText } from '#tests/engine/render/canvas/modules/helpers'

const CONFIG: DataGridModuleConfigV1 = {
  data: {
    columns: [
      {
        id: 'name',
        label: 'Name',
        type: 'text',
        align: 'start',
        width: 200,
        sortable: true,
        filterable: true
      },
      {
        id: 'score',
        label: 'Score',
        type: 'number',
        align: 'end',
        width: 100,
        sortable: true,
        filterable: false
      }
    ],
    rows: [
      { id: 'alpha', cells: ['Alpha', 42] },
      { id: 'beta', cells: ['Beta', 37] },
      { id: 'gamma', cells: ['Gamma', 29] }
    ]
  },
  initialSort: { columnId: 'score', direction: 'descending' },
  filters: [{ columnId: 'name', operator: 'contains', value: 'a' }],
  pageSize: 20,
  selectionMode: 'multiple',
  density: 'comfortable',
  showHeader: true,
  stickyHeader: true,
  striped: true,
  showCsvTools: false,
  borderColor: '#D1D5DB',
  headerBackground: '#F3F4F6',
  textColor: '#111827',
  accentColor: '#2563EB',
  fontSize: 14
}

function dataGridFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'data-grid-1', 'FRAME', {
    ...createDataGridModuleFrameOverrides(CONFIG),
    width: 500,
    height: 220,
    ...overrides
  })
}

function rendererWithFont() {
  let size = 11
  const labelFont = {
    getGlyphIDs: (value: string) => Array.from(value, (_, index) => index),
    getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6),
    getSize: mock(() => size),
    setSize: mock((value: number) => {
      size = value
    })
  }
  const renderer = createMockRenderer({
    zoom: 1,
    labelFont: labelFont as never,
    fontsLoaded: true,
    fontProvider: {} as never,
    nodeFontReadiness: mock(() => 'ready' as const),
    buildParagraph: mock((node) =>
      textLayoutDouble({
        text: node.text,
        getAlphabeticBaseline: () => 10,
        delete: mock(() => undefined)
      })
    )
  })
  return { renderer, labelFont }
}

describe('advanced data grid module canvas preview', () => {
  test('bounds visible rows by density, header, and footer space', () => {
    const visible = visibleDataGridRows(CONFIG, 220)
    expect(visible.headerRows).toBe(1)
    expect(visible.footerHeight).toBeGreaterThan(0)
    expect(visible.rows.length).toBeLessThanOrEqual(CONFIG.data.rows.length)
    expect(visibleDataGridRows({ ...CONFIG, density: 'compact' }, 220).rowHeight).toBeLessThan(
      visible.rowHeight
    )
  })

  test('draws typed cells, sort marker, and bounded first-page summary', () => {
    const canvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    const { renderer, labelFont } = rendererWithFont()

    expect(renderDataGridModulePreview(renderer, asCanvas(canvas), dataGridFrame())).toBe(true)
    const labels = canvas.drawParagraph.mock.calls.map((call) => paragraphText(call[0]))
    expect(labels).toContain('Name')
    expect(labels).toContain('Score ↓')
    expect(labels).toContain('Alpha')
    expect(labels).toContain('42')
    expect(labels).toContain('3 rows · 1 filters · 20/page')
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawText).not.toHaveBeenCalled()
    expect(canvas.clipRect).toHaveBeenCalledTimes(labels.length)
    expect(canvas.restore).toHaveBeenCalledTimes(canvas.save.mock.calls.length)
    expect(labelFont.setSize.mock.calls.at(-1)?.[0]).toBe(11)
  })

  test('fails closed for invalid metadata and restores state after drawing errors', () => {
    const { renderer } = rendererWithFont()
    const invalidCanvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    const invalid = dataGridFrame({
      interactiveProps: {
        module: { ...createDataGridModuleInstance(CONFIG), pluginId: 'unknown.plugin' }
      }
    })
    expect(renderDataGridModulePreview(renderer, asCanvas(invalidCanvas), invalid)).toBe(false)
    expect(invalidCanvas.save).not.toHaveBeenCalled()

    const throwingCanvas = {
      ...createMockCanvas(),
      drawParagraph: mock(() => {
        throw new Error('draw failed')
      })
    }
    expect(() =>
      renderDataGridModulePreview(renderer, asCanvas(throwingCanvas), dataGridFrame())
    ).toThrow('draw failed')
    expect(throwingCanvas.restore).toHaveBeenCalledTimes(throwingCanvas.save.mock.calls.length)
  })

  test('exports a canvas adapter with the exact trusted identity', () => {
    expect(DATA_GRID_MODULE_CANVAS_ADAPTER.pluginId).toBe('open-pencil.data-grid')
    expect(DATA_GRID_MODULE_CANVAS_ADAPTER.moduleType).toBe('data-grid')
  })
})
