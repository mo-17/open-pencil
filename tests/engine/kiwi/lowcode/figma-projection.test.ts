import { describe, expect, test } from 'bun:test'

import {
  exportFigFileWithOptions,
  importNodeChanges,
  parseFigFile,
  SceneGraph,
  type GUID
} from '@open-pencil/core'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

import {
  collapseFigmaProjectionChildren,
  createFigmaProjectionMarker,
  createFigmaProjectionPluginData,
  FIGMA_PROJECTION_PLUGIN_KEY,
  readFigmaProjectionMarker,
  type FigmaProjectionMarkerInput,
  type FigmaProjectionTree
} from '#core/kiwi/fig/node-change/figma-projection'
import {
  LOWCODE_INTERACTIVE_PROPS_KEY,
  LOWCODE_NODE_TYPE_KEY
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

type ProjectionNode = Pick<NodeChange, 'pluginData' | 'textData' | 'type'>

function markerPluginData(input: FigmaProjectionMarkerInput) {
  return {
    pluginID: OPEN_PENCIL_PLUGIN_ID,
    key: FIGMA_PROJECTION_PLUGIN_KEY,
    value: JSON.stringify(createFigmaProjectionMarker(input))
  }
}

function node(type: string, marker?: FigmaProjectionMarkerInput, text?: string): ProjectionNode {
  return {
    type,
    ...(marker ? { pluginData: [markerPluginData(marker)] } : {}),
    ...(text === undefined ? {} : { textData: { characters: text } })
  } as ProjectionNode
}

function tree(
  nodes: Record<string, ProjectionNode>,
  children: Record<string, readonly string[]> = {}
): FigmaProjectionTree {
  return {
    getNode: (id) => nodes[id],
    getChildren: (id) => children[id] ?? []
  }
}

function importedNode(
  type: string,
  sessionID: number,
  localID: number,
  parent: GUID | null,
  overrides: Partial<NodeChange> = {}
): NodeChange {
  return {
    guid: { sessionID, localID },
    ...(parent
      ? {
          parentIndex: {
            guid: parent,
            position: String.fromCharCode(33 + localID)
          }
        }
      : {}),
    type,
    name: `${type}_${sessionID}_${localID}`,
    visible: true,
    opacity: 1,
    phase: 'CREATED',
    size: { x: 100, y: 36 },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    ...overrides
  } as NodeChange
}

function lowcodeRootPluginData(type: string, interactiveProps: Record<string, unknown>) {
  return [
    {
      pluginID: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_NODE_TYPE_KEY,
      value: JSON.stringify(type)
    },
    {
      pluginID: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_INTERACTIVE_PROPS_KEY,
      value: JSON.stringify(interactiveProps)
    }
  ]
}

describe('Figma-compatible lowcode projection import', () => {
  test('writes and parses the shared stable marker contract', () => {
    expect(createFigmaProjectionPluginData({ role: 'label', field: 'text', index: 2 })).toEqual({
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: FIGMA_PROJECTION_PLUGIN_KEY,
      value: JSON.stringify({ version: 1, role: 'label', field: 'text', index: 2 })
    })

    expect(
      readFigmaProjectionMarker(node('TEXT', { role: 'label', field: 'text', index: 2 }, 'Go'))
    ).toEqual({ version: 1, role: 'label', field: 'text', index: 2 })
  })

  test('rejects malformed and future markers instead of deleting their layers', () => {
    const malformed: ProjectionNode = {
      type: 'TEXT',
      pluginData: [
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: FIGMA_PROJECTION_PLUGIN_KEY,
          value: '{not-json'
        }
      ]
    }
    const future: ProjectionNode = {
      type: 'TEXT',
      pluginData: [
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: FIGMA_PROJECTION_PLUGIN_KEY,
          value: JSON.stringify({ version: 2, role: 'label', field: 'text' })
        }
      ]
    }
    const projectionTree = tree({ malformed, future })

    expect(readFigmaProjectionMarker(malformed)).toBeNull()
    expect(readFigmaProjectionMarker(future)).toBeNull()
    expect(
      collapseFigmaProjectionChildren('BUTTON', ['malformed', 'future'], projectionTree)
    ).toEqual({
      childIds: ['malformed', 'future'],
      collapsedChildIds: [],
      interactivePropsPatch: {}
    })
  })

  test('collapses only highest marked children, keeps real siblings, and imports edited label', () => {
    const projectionTree = tree(
      {
        content: node('FRAME', { role: 'content' }),
        label: node('TEXT', { role: 'label', field: 'text' }, 'Edited in Figma'),
        icon: node('VECTOR', { role: 'icon' }),
        real: node('RECTANGLE')
      },
      { content: ['label', 'icon'] }
    )

    expect(collapseFigmaProjectionChildren('BUTTON', ['content', 'real'], projectionTree)).toEqual({
      childIds: ['real'],
      collapsedChildIds: ['content'],
      interactivePropsPatch: { text: 'Edited in Figma' }
    })
  })

  test('imports placeholder and value text while rejecting fields invalid for the node type', () => {
    const projectionTree = tree({
      placeholder: node('TEXT', { role: 'display', field: 'placeholder' }, 'Email address'),
      value: node('TEXT', { role: 'display', field: 'value' }, 'ada@example.com'),
      unsafe: node('TEXT', { role: 'label', field: 'events' }, 'overwrite'),
      wrongForInput: node('TEXT', { role: 'label', field: 'text' }, 'not button text')
    })

    expect(
      collapseFigmaProjectionChildren(
        'INPUT',
        ['placeholder', 'value', 'unsafe', 'wrongForInput'],
        projectionTree
      )
    ).toEqual({
      childIds: [],
      collapsedChildIds: ['placeholder', 'value', 'unsafe', 'wrongForInput'],
      interactivePropsPatch: { placeholder: 'Email address', value: 'ada@example.com' }
    })
  })

  test('rebuilds indexed option labels in semantic order', () => {
    const projectionTree = tree({
      option2: node('TEXT', { role: 'option-label', field: 'options', index: 2 }, 'Third'),
      option0: node('TEXT', { role: 'option-label', field: 'options', index: 0 }, 'First'),
      option1: node('TEXT', { role: 'option-label', field: 'options', index: 1 }, 'Second')
    })

    expect(
      collapseFigmaProjectionChildren('SELECT', ['option2', 'option0', 'option1'], projectionTree)
        .interactivePropsPatch
    ).toEqual({ options: ['First', 'Second', 'Third'] })
  })

  test('merges a projected SELECT display label into persisted options by index', () => {
    const projectionTree = tree({
      option0: node('TEXT', { role: 'option', field: 'options', index: 0 }, 'Edited first')
    })

    expect(
      collapseFigmaProjectionChildren('SELECT', ['option0'], projectionTree, {
        options: ['First', 'Second', 'Third']
      }).interactivePropsPatch
    ).toEqual({ options: ['Edited first', 'Second', 'Third'] })
  })

  test('does not collapse markers outside a lowcode root or below a real direct child', () => {
    const projectionTree = tree(
      {
        generated: node('TEXT', { role: 'label', field: 'text' }, 'Generated'),
        realWrapper: node('FRAME')
      },
      { realWrapper: ['generated'] }
    )

    expect(collapseFigmaProjectionChildren('FRAME', ['generated'], projectionTree)).toEqual({
      childIds: ['generated'],
      collapsedChildIds: [],
      interactivePropsPatch: {}
    })
    expect(collapseFigmaProjectionChildren('BUTTON', ['realWrapper'], projectionTree)).toEqual({
      childIds: ['realWrapper'],
      collapsedChildIds: [],
      interactivePropsPatch: {}
    })
  })

  test('importNodeChanges folds the generated subtree and preserves a real sibling', () => {
    const documentId = { sessionID: 0, localID: 0 }
    const canvasId = { sessionID: 0, localID: 1 }
    const buttonId = { sessionID: 1, localID: 10 }
    const contentId = { sessionID: 1, localID: 11 }
    const graph = importNodeChanges([
      importedNode('DOCUMENT', 0, 0, null),
      importedNode('CANVAS', 0, 1, documentId),
      importedNode('FRAME', 1, 10, canvasId, {
        name: 'Projected button',
        pluginData: lowcodeRootPluginData('BUTTON', { text: 'Original' })
      }),
      importedNode('FRAME', 1, 11, buttonId, {
        name: 'Synthetic content',
        pluginData: [markerPluginData({ role: 'content' })]
      }),
      importedNode('TEXT', 1, 12, contentId, {
        name: 'Synthetic label',
        pluginData: [markerPluginData({ role: 'label', field: 'text' })],
        textData: { characters: 'Edited in Figma' }
      }),
      importedNode('RECTANGLE', 1, 13, buttonId, { name: 'Real authored child' })
    ])

    const button = graph.getChildren(graph.getPages()[0].id)[0]
    expect(button.type).toBe('BUTTON')
    expect(button.interactiveProps).toEqual({ text: 'Edited in Figma' })
    expect(graph.getChildren(button.id).map((child) => child.name)).toEqual(['Real authored child'])
    expect([...graph.getAllNodes()].some((candidate) => candidate.name === 'Synthetic label')).toBe(
      false
    )
  })

  test('importNodeChanges leaves an unprojected lowcode subtree unchanged', () => {
    const documentId = { sessionID: 0, localID: 0 }
    const canvasId = { sessionID: 0, localID: 1 }
    const buttonId = { sessionID: 1, localID: 20 }
    const graph = importNodeChanges([
      importedNode('DOCUMENT', 0, 0, null),
      importedNode('CANVAS', 0, 1, documentId),
      importedNode('FRAME', 1, 20, canvasId, {
        name: 'Ordinary button',
        pluginData: lowcodeRootPluginData('BUTTON', { text: 'Persisted' })
      }),
      importedNode('TEXT', 1, 21, buttonId, {
        name: 'Real text child',
        textData: { characters: 'Authored child' }
      })
    ])

    const button = graph.getChildren(graph.getPages()[0].id)[0]
    expect(button.interactiveProps).toEqual({ text: 'Persisted' })
    expect(graph.getChildren(button.id)).toHaveLength(1)
    expect(graph.getChildren(button.id)[0].name).toBe('Real text child')
  })

  test('figma-compatible export parses back without synthetic layers or semantic loss', async () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    source.createNode('BUTTON', page.id, {
      name: 'Compatible button',
      layoutMode: 'FREE',
      interactiveProps: { text: 'Continue' }
    })
    source.createNode('SELECT', page.id, {
      name: 'Compatible select',
      interactiveProps: { options: ['Draft', 'Published', 'Archived'], value: '' }
    })
    const form = source.createNode('FORM', page.id, { name: 'Compatible form' })
    source.createNode('INPUT', form.id, {
      name: 'Form input',
      interactiveProps: { placeholder: 'Email', value: '' }
    })

    const bytes = await exportFigFileWithOptions(source, { profile: 'figma-compatible' })
    const imported = await parseFigFile(bytes.buffer)
    const byName = (name: string) =>
      [...imported.getAllNodes()].find((candidate) => candidate.name === name)

    expect(byName('Compatible button')).toMatchObject({
      type: 'BUTTON',
      layoutMode: 'FREE',
      interactiveProps: { text: 'Continue' }
    })
    expect(byName('Compatible select')).toMatchObject({
      type: 'SELECT',
      interactiveProps: { options: ['Draft', 'Published', 'Archived'], value: '' }
    })
    expect(byName('Compatible form')?.type).toBe('FORM')
    expect(byName('Form input')).toMatchObject({
      type: 'INPUT',
      interactiveProps: { placeholder: 'Email', value: '' }
    })
    expect(
      [...imported.getAllNodes()].some((candidate) => candidate.name.startsWith('[OpenPencil]'))
    ).toBe(false)
  })
})
