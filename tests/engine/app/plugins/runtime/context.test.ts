import { describe, expect, test } from 'bun:test'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { PLUGIN_RUNTIME_CONTEXT_LIMITS, preparePluginRuntimeInput } from '@/app/plugins/runtime'

function node(index: number, type: SceneNode['type'] = 'RECTANGLE'): SceneNode {
  return {
    id: `node-${index}`,
    parentId: null,
    type,
    name: 'N'.repeat(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNameBytes + 8),
    childIds: [],
    x: index,
    y: index + 1,
    width: 100,
    height: 80,
    rotation: 0,
    visible: true,
    locked: false,
    text: 'T'.repeat(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxTextBytes + 8)
  } as SceneNode
}

describe('plugin runtime capability context', () => {
  test('exposes only requested bounded read snapshots', async () => {
    const nodes = Array.from({ length: PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNodes + 3 }, (_, index) =>
      node(index, index === 0 ? 'TEXT' : 'RECTANGLE')
    )
    nodes[1].name = '惊'.repeat(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNameBytes)
    const byId = new Map(nodes.map((value) => [value.id, value]))
    let visitedNodes = 0
    const editor = {
      graph: {
        getAllNodes: function* () {
          for (const value of nodes) {
            visitedNodes++
            yield value
          }
        },
        getNodeCount: () => nodes.length,
        getNode: (id: string) => byId.get(id)
      },
      state: {
        currentPageId: 'page-1',
        selectedIds: new Set(['node-0', 'node-2'])
      }
    } as EditorStore

    const result = await preparePluginRuntimeInput(
      ['document.nodes.read', 'document.selection.read'],
      { query: 'summary' },
      editor
    )
    expect(result).toMatchObject({
      input: { query: 'summary' },
      capabilities: {
        documentNodes: {
          currentPageId: 'page-1',
          totalNodeCount: PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNodes + 3,
          truncated: true
        },
        documentSelection: {
          totalSelectedCount: 2,
          nodeIds: ['node-0', 'node-2'],
          truncated: false
        }
      }
    })
    const capabilities = (result as { capabilities: Record<string, unknown> }).capabilities
    const documentNodes = capabilities.documentNodes as { nodes: Array<Record<string, unknown>> }
    expect(documentNodes.nodes).toHaveLength(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNodes)
    expect(visitedNodes).toBeLessThanOrEqual(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNodes + 1)
    expect(documentNodes.nodes[0].name).toHaveLength(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNameBytes)
    expect(documentNodes.nodes[0].text).toHaveLength(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxTextBytes)
    expect(
      new TextEncoder().encode(documentNodes.nodes[1].name as string).byteLength
    ).toBeLessThanOrEqual(PLUGIN_RUNTIME_CONTEXT_LIMITS.maxNameBytes)
    expect(documentNodes.nodes[1].text).toBeNull()
    expect(documentNodes.nodes[0]).not.toHaveProperty('fills')
    expect(documentNodes.nodes[0]).not.toHaveProperty('interactiveProps')
  })

  test('passes input through with no grants and rejects document reads without an editor', async () => {
    await expect(preparePluginRuntimeInput([], { ok: true }, null)).resolves.toEqual({ ok: true })
    await expect(preparePluginRuntimeInput(['document.nodes.read'], null, null)).rejects.toThrow(
      'No active document'
    )
  })
})
