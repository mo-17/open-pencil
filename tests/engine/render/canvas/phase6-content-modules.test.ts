import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  ACCORDION_MODULE_CANVAS_ADAPTER,
  renderAccordionModulePreview
} from '#core/canvas/modules/accordion'
import {
  AUDIO_PLAYER_MODULE_CANVAS_ADAPTER,
  renderAudioPlayerModulePreview
} from '#core/canvas/modules/audio-player'
import {
  CODE_BLOCK_MODULE_CANVAS_ADAPTER,
  renderCodeBlockModulePreview
} from '#core/canvas/modules/code-block'
import {
  MARKDOWN_MODULE_CANVAS_ADAPTER,
  markdownPreviewLines,
  renderMarkdownModulePreview
} from '#core/canvas/modules/markdown'
import {
  PDF_VIEWER_MODULE_CANVAS_ADAPTER,
  renderPDFViewerModulePreview
} from '#core/canvas/modules/pdf-viewer'
import {
  QR_BARCODE_MODULE_CANVAS_ADAPTER,
  renderQrBarcodeModulePreview
} from '#core/canvas/modules/qr-barcode'
import { TABS_MODULE_CANVAS_ADAPTER, renderTabsModulePreview } from '#core/canvas/modules/tabs'
import { createAccordionModuleFrameOverrides } from '#core/plugins/accordion'
import { createAudioPlayerModuleFrameOverrides } from '#core/plugins/audio-player'
import { createCodeBlockModuleFrameOverrides } from '#core/plugins/code-block'
import { createMarkdownModuleFrameOverrides } from '#core/plugins/markdown'
import { createPDFViewerModuleFrameOverrides } from '#core/plugins/pdf-viewer'
import { createQrBarcodeModuleFrameOverrides } from '#core/plugins/qr-barcode'
import { createTabsModuleFrameOverrides } from '#core/plugins/tabs'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

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
  return createMockRenderer({ zoom: 1, labelFont: labelFont as never })
}

function moduleFrame(id: string, overrides: Partial<SceneNode>): SceneNode {
  return createDefaultNode(() => id, 'FRAME', { width: 480, height: 260, ...overrides })
}

const CASES = [
  {
    name: 'tabs',
    adapter: TABS_MODULE_CANVAS_ADAPTER,
    render: renderTabsModulePreview,
    frame: () => moduleFrame('tabs', createTabsModuleFrameOverrides())
  },
  {
    name: 'accordion',
    adapter: ACCORDION_MODULE_CANVAS_ADAPTER,
    render: renderAccordionModulePreview,
    frame: () => moduleFrame('accordion', createAccordionModuleFrameOverrides())
  },
  {
    name: 'QR/barcode',
    adapter: QR_BARCODE_MODULE_CANVAS_ADAPTER,
    render: renderQrBarcodeModulePreview,
    frame: () => moduleFrame('qr-barcode', createQrBarcodeModuleFrameOverrides())
  },
  {
    name: 'Markdown',
    adapter: MARKDOWN_MODULE_CANVAS_ADAPTER,
    render: renderMarkdownModulePreview,
    frame: () =>
      moduleFrame(
        'markdown',
        createMarkdownModuleFrameOverrides({
          source:
            '# Safe heading\n<script>globalThis.compromised = true</script>\n[Link](https://example.com)'
        })
      )
  },
  {
    name: 'code block',
    adapter: CODE_BLOCK_MODULE_CANVAS_ADAPTER,
    render: renderCodeBlockModulePreview,
    frame: () =>
      moduleFrame(
        'code-block',
        createCodeBlockModuleFrameOverrides({ code: 'globalThis.compromised = true' })
      )
  },
  {
    name: 'PDF viewer',
    adapter: PDF_VIEWER_MODULE_CANVAS_ADAPTER,
    render: renderPDFViewerModulePreview,
    frame: () =>
      moduleFrame(
        'pdf-viewer',
        createPDFViewerModuleFrameOverrides({ sourceUrl: 'https://cdn.example.com/manual.pdf' })
      )
  },
  {
    name: 'audio player',
    adapter: AUDIO_PLAYER_MODULE_CANVAS_ADAPTER,
    render: renderAudioPlayerModulePreview,
    frame: () =>
      moduleFrame(
        'audio-player',
        createAudioPlayerModuleFrameOverrides({ src: 'https://cdn.example.com/audio.mp3' })
      )
  }
] as const

describe('phase 6 content module CanvasKit previews', () => {
  test('draw all seven adapters offline without executing content or requesting remote assets', () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas preview must stay offline')))
    globalThis.fetch = fetchMock as typeof fetch
    try {
      for (const entry of CASES) {
        const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
        expect(entry.render(rendererWithFont(), canvas as Canvas, entry.frame()), entry.name).toBe(
          true
        )
        expect(canvas.save).toHaveBeenCalledTimes(1)
        expect(canvas.restore).toHaveBeenCalledTimes(1)
        expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
        expect(canvas.drawRect).toHaveBeenCalled()
        expect(entry.adapter.pluginId.startsWith('open-pencil.')).toBe(true)
        expect(entry.adapter.moduleType.length).toBeGreaterThan(0)
      }
      expect(fetchMock).not.toHaveBeenCalled()
      expect((globalThis as { compromised?: boolean }).compromised).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
      delete (globalThis as { compromised?: boolean }).compromised
    }
  })

  test('strips raw HTML and link destinations from the bounded Markdown text preview', () => {
    expect(
      markdownPreviewLines(
        '<script>alert("unsafe")</script>\n# Heading\n[Visible](https://example.com)',
        8
      )
    ).toEqual([
      { text: 'alert("unsafe")', heading: false },
      { text: 'Heading', heading: true },
      { text: 'Visible', heading: false }
    ])
  })

  test('fails closed for non-FRAME hosts and tampered module identities', () => {
    for (const entry of CASES) {
      const rectangle = createDefaultNode(() => `rectangle-${entry.name}`, 'RECTANGLE')
      const frame = entry.frame()
      const module = frame.interactiveProps?.module
      const tampered = moduleFrame(`tampered-${entry.name}`, {
        ...frame,
        interactiveProps: { module: { ...module, pluginId: 'unknown.plugin' } as never }
      })
      expect(entry.render(rendererWithFont(), createMockCanvas() as Canvas, rectangle)).toBe(false)
      expect(entry.render(rendererWithFont(), createMockCanvas() as Canvas, tampered)).toBe(false)
    }
  })
})
