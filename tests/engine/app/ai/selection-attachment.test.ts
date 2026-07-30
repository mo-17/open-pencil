import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { VisualChatAttachment } from '@/app/ai/chat/attachments'
import {
  captureSelectionVisualAttachment,
  type SelectionAttachmentStore
} from '@/app/ai/chat/selection-attachment'

function attachment(): VisualChatAttachment {
  return {
    id: 'selection-1',
    name: 'Hero.png',
    mediaType: 'image/png',
    url: 'data:image/png;base64,AQ==',
    sizeBytes: 1,
    width: 2_048,
    height: 1_024,
    source: 'selection',
    sourceSizeBytes: 4,
    sourceWidth: 2_048,
    sourceHeight: 1_024,
    thumbnail: {
      url: 'data:image/png;base64,AQ==',
      sizeBytes: 1,
      width: 320,
      height: 160
    }
  }
}

describe('selection visual attachment capture', () => {
  test('renders explicit selected IDs at a bounded scale and normalizes the PNG', async () => {
    const calls: unknown[][] = []
    const bytes = new Uint8Array([1, 2, 3, 4])
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const node = graph.createNode('RECTANGLE', pageId, { name: 'Hero' })
    const store: SelectionAttachmentStore = {
      state: { selectedIds: new Set([node.id]), currentPageId: pageId },
      graph,
      async renderExportImage(...args: unknown[]) {
        calls.push(args)
        return bytes
      }
    }
    let normalizedName = ''
    let normalizedBytes = new Uint8Array()

    const result = await captureSelectionVisualAttachment(store, {
      computeBounds: () => ({ minX: 10, minY: 20, maxX: 4_106, maxY: 2_068 }),
      normalize: async (file, options) => {
        normalizedName = file.name
        normalizedBytes = new Uint8Array(await file.arrayBuffer())
        expect(options.source).toBe('selection')
        return attachment()
      }
    })

    expect(result.id).toBe('selection-1')
    expect(result.canvasNodeIds).toEqual([node.id])
    expect(calls).toEqual([
      [[node.id], 0.5, 'PNG', pageId, { bounds: { minX: 10, minY: 20, maxX: 4_106, maxY: 2_068 } }]
    ])
    expect(normalizedName).toBe('Hero.png')
    expect(normalizedBytes).toEqual(bytes)
  })

  test('fails before rendering when there is no explicit selection', async () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const store: SelectionAttachmentStore = {
      state: { selectedIds: new Set(), currentPageId: pageId },
      graph,
      async renderExportImage() {
        throw new Error('render should not run')
      }
    }

    expect(captureSelectionVisualAttachment(store)).rejects.toThrow(
      'Select a visible canvas layer first.'
    )
  })

  test('fails closed when the renderer returns no image bytes', async () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const node = graph.createNode('RECTANGLE', pageId, { name: 'Hero' })
    const store: SelectionAttachmentStore = {
      state: { selectedIds: new Set([node.id]), currentPageId: pageId },
      graph,
      async renderExportImage() {
        return null
      }
    }

    expect(
      captureSelectionVisualAttachment(store, {
        computeBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
      })
    ).rejects.toThrow('The selected layers could not be rendered.')
  })
})
