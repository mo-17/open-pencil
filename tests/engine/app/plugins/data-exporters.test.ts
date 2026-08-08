import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import {
  exportCurrentDocumentDesignTokens,
  type DesignTokensExporterDependencies
} from '@/app/plugins/host/design-tokens-exporter'
import {
  exportCurrentDocumentAsFigmaProjection,
  type FigmaProjectionExporterDependencies
} from '@/app/plugins/host/figma-projection-exporter'

function editor(): EditorStore {
  return {
    graph: new SceneGraph(),
    state: { documentName: 'Product / Demo' }
  } as EditorStore
}

describe('plugin data exporters', () => {
  test('writes deterministic token JSON only after a destination is selected', async () => {
    const writes: Uint8Array[] = []
    const dependencies: DesignTokensExporterDependencies = {
      exportTokens() {
        return {
          text: '{"format":"test"}\n',
          stats: { collectionCount: 0, modeCount: 0, tokenCount: 0 }
        }
      },
      async chooseDestination(fileName) {
        expect(fileName).toBe('product-demo-design-tokens.json')
        return {
          async write(bytes) {
            writes.push(bytes)
          }
        }
      }
    }

    await expect(exportCurrentDocumentDesignTokens(editor(), dependencies)).resolves.toEqual({
      fileName: 'product-demo-design-tokens.json',
      fileCount: 1,
      warnings: [],
      saved: true
    })
    expect(new TextDecoder().decode(writes[0])).toBe('{"format":"test"}\n')
  })

  test('does not run a projection after the user cancels destination selection', async () => {
    let exported = false
    const dependencies: FigmaProjectionExporterDependencies = {
      async exportProjection() {
        exported = true
        return new Uint8Array([1, 2, 3])
      },
      async chooseDestination() {
        return null
      }
    }

    await expect(exportCurrentDocumentAsFigmaProjection(editor(), dependencies)).resolves.toEqual({
      fileName: 'product-demo-figma-editable.fig',
      fileCount: 0,
      warnings: [],
      saved: false
    })
    expect(exported).toBe(false)
  })

  test('checks cancellation again before durable writes', async () => {
    const controller = new AbortController()
    let wrote = false
    const dependencies: FigmaProjectionExporterDependencies = {
      async exportProjection() {
        controller.abort()
        return new Uint8Array([1, 2, 3])
      },
      async chooseDestination() {
        return {
          async write() {
            wrote = true
          }
        }
      }
    }

    await expect(
      exportCurrentDocumentAsFigmaProjection(editor(), dependencies, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(wrote).toBe(false)
  })
})
