import { beforeAll, describe, expect, test } from 'bun:test'

import { deflateSync } from 'fflate'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { parseFigBuffer, writeFigArchive } from '@open-pencil/fig'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import {
  createNodeChangesMessage,
  encodeMessage,
  getSchemaBytes,
  type PluginData
} from '@open-pencil/kiwi/fig/codec'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  extractImportedLowcodeProps,
  LOWCODE_NODE_TYPE_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

const CONTROL_TYPES = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'DATEPICKER'] as const
const TYPOGRAPHY_KEY = 'lowcode/controlTypography'

function controlStyle(node: SceneNode) {
  return {
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    italic: node.italic,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft
  }
}

async function roundTrip(graph: SceneGraph): Promise<SceneGraph> {
  const bytes = await exportFigFile(graph)
  return parseFigFile(bytes.slice().buffer)
}

function requiredNode(graph: SceneGraph, name: string): SceneNode {
  const node = [...graph.getAllNodes()].find((entry) => entry.name === name)
  if (!node) throw new Error('Missing reimported control: ' + name)
  return node
}

function templateControlStyles(graph: SceneGraph) {
  const rows: Array<{
    path: string
    type: SceneNode['type']
    style: ReturnType<typeof controlStyle>
  }> = []
  function visit(node: SceneNode, path: string) {
    if (CONTROL_TYPES.some((type) => type === node.type))
      rows.push({ path, type: node.type, style: controlStyle(node) })
    for (const [index, child] of graph.getChildren(node.id).entries())
      visit(child, `${path}/${index}:${child.name}`)
  }
  for (const page of graph.getPages()) visit(page, page.name)
  return rows
}

function serializedControlTypography() {
  const graph = new SceneGraph()
  const node = graph.createNode('INPUT', graph.getPages()[0].id, {
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 27,
    textAlignVertical: 'CENTER'
  })
  const entry = serializeLowcodeFields(node).find((item) => item.key === TYPOGRAPHY_KEY)
  if (!entry) throw new Error('The lowcode control has no serialized typography')
  const value: unknown = JSON.parse(entry.value)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a typography data record')
  return { node, entry, value }
}

function nodeTypeEntry(type = 'INPUT'): PluginData {
  return {
    pluginID: OPEN_PENCIL_PLUGIN_ID,
    key: LOWCODE_NODE_TYPE_KEY,
    value: JSON.stringify(type)
  }
}

function nativePaddingArchive(): Uint8Array {
  return writeFigArchive({
    schemaDeflated: deflateSync(getSchemaBytes()),
    kiwiData: encodeMessage(
      createNodeChangesMessage(0, 0, [
        {
          guid: { sessionID: 0, localID: 0 },
          type: 'DOCUMENT',
          phase: 'CREATED',
          name: 'Document'
        },
        {
          guid: { sessionID: 0, localID: 1 },
          parentIndex: { guid: { sessionID: 0, localID: 0 }, position: 'a' },
          type: 'CANVAS',
          phase: 'CREATED',
          name: 'Page'
        },
        {
          guid: { sessionID: 0, localID: 2 },
          parentIndex: { guid: { sessionID: 0, localID: 1 }, position: 'a' },
          type: 'FRAME',
          phase: 'CREATED',
          name: 'Native padding inheritance',
          size: { x: 320, y: 128 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          stackMode: 'NONE',
          stackPadding: 12,
          stackHorizontalPadding: 12,
          stackVerticalPadding: 12
        }
      ])
    ),
    thumbnailPNG: new Uint8Array(),
    metaJSON: '{}'
  })
}

describe('lowcode control typography and padding in real FIG archives', () => {
  beforeAll(initCodec)

  test.each([...CONTROL_TYPES])(
    '%s preserves authored style across two save and reopen cycles',
    async (type) => {
      let graph = new SceneGraph()
      const original = graph.createNode(type, graph.getPages()[0].id, {
        name: type + ' styled control',
        width: 320,
        height: type === 'TEXTAREA' ? 128 : 44,
        fontFamily: 'Example Local Font',
        fontSize: 18,
        fontWeight: 600,
        italic: true,
        lineHeight: 27,
        letterSpacing: -0.5,
        textAlignHorizontal: 'RIGHT',
        textAlignVertical: 'BOTTOM',
        paddingTop: 9,
        paddingRight: 12,
        paddingBottom: 11,
        paddingLeft: 14
      })
      const expected = controlStyle(original)
      for (let cycle = 0; cycle < 2; cycle++) {
        graph = await roundTrip(graph)
        const restored = requiredNode(graph, original.name)
        expect(restored.type).toBe(type)
        expect(controlStyle(restored)).toEqual(expected)
      }
    }
  )

  test('an edited reopened control can return to automatic line height and zero spacing', async () => {
    const graph = new SceneGraph()
    const input = graph.createNode('INPUT', graph.getPages()[0].id, {
      name: 'Editable control',
      fontSize: 18,
      fontWeight: 600,
      italic: true,
      lineHeight: 27,
      letterSpacing: 2,
      textAlignHorizontal: 'CENTER',
      paddingLeft: 12
    })
    const reopened = await roundTrip(graph)
    const restored = requiredNode(reopened, input.name)
    const editor = createEditor({ graph: reopened })
    try {
      editor.updateNode(restored.id, {
        fontSize: 16,
        fontWeight: 400,
        italic: false,
        lineHeight: null,
        letterSpacing: 0,
        textAlignHorizontal: 'LEFT',
        paddingLeft: 0
      })
      const edited = controlStyle(requiredNode(reopened, input.name))
      expect(controlStyle(requiredNode(await roundTrip(reopened), input.name))).toEqual(edited)
    } finally {
      editor.dispose()
    }
  })

  test.each(['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] as const)(
    'editing %s to zero preserves the other imported sides and their raw metadata',
    async (side) => {
      const graph = new SceneGraph()
      const input = graph.createNode('INPUT', graph.getPages()[0].id, {
        name: 'Imported padded input',
        paddingLeft: 12,
        paddingRight: 14,
        paddingTop: 9,
        paddingBottom: 11
      })
      const reopened = await roundTrip(graph)
      const imported = requiredNode(reopened, input.name)
      const rawLayout = structuredClone(imported.source.fig.layout)
      const originalStyle = controlStyle(imported)
      expect(requiredNode(await roundTrip(reopened), input.name).source.fig.layout).toEqual(
        rawLayout
      )
      const editor = createEditor({ graph: reopened })
      try {
        editor.updateNode(imported.id, { [side]: 0 })
        expect(imported.source.fig.layout).toEqual(rawLayout)
        let current = reopened
        for (let cycle = 0; cycle < 2; cycle++) {
          current = await roundTrip(current)
          expect(controlStyle(requiredNode(current, input.name))).toEqual({
            ...originalStyle,
            [side]: 0
          })
        }
        expect(imported.source.fig.layout).toEqual(rawLayout)
      } finally {
        editor.dispose()
      }
    }
  )

  test.each([
    { side: 'paddingLeft', trailing: 'paddingRight', rawTrailing: 'stackPaddingRight' },
    { side: 'paddingTop', trailing: 'paddingBottom', rawTrailing: 'stackPaddingBottom' }
  ] as const)(
    'editing native $side preserves an omitted $trailing',
    async ({ side, trailing, rawTrailing }) => {
      const imported = await parseFigFile(nativePaddingArchive().slice().buffer)
      const node = requiredNode(imported, 'Native padding inheritance')
      const rawLayout = structuredClone(node.source.fig.layout)
      expect(rawLayout?.[rawTrailing]).toBeUndefined()
      expect(node[trailing]).toBe(12)
      const unedited = parseFigBuffer(
        (await exportFigFile(imported)).slice().buffer
      ).nodeChanges.find((entry) => entry.name === node.name)
      expect(unedited?.[rawTrailing]).toBeUndefined()
      const editor = createEditor({ graph: imported })
      try {
        editor.updateNode(node.id, { [side]: 0 })
        const saved = await exportFigFile(imported)
        const raw = parseFigBuffer(saved.slice().buffer).nodeChanges.find(
          (entry) => entry.name === node.name
        )
        expect(raw?.[rawTrailing]).toBe(12)
        const reopened = await parseFigFile(saved.slice().buffer)
        expect(requiredNode(reopened, node.name)[side]).toBe(0)
        expect(requiredNode(reopened, node.name)[trailing]).toBe(12)
        expect(requiredNode(await roundTrip(reopened), node.name)[trailing]).toBe(12)
        expect(node.source.fig.layout).toEqual(rawLayout)
      } finally {
        editor.dispose()
      }
    }
  )

  test.each(['en', 'zh-CN'])(
    '%s template collection retains the current field styles after reopening',
    async (locale) => {
      const { editor, graph } = componentTemplateFixture(undefined, locale)
      try {
        const fields = [...graph.getAllNodes()].filter(
          (node) => node.type === 'INPUT' || node.type === 'TEXTAREA'
        )
        expect(fields.length).toBeGreaterThan(2)
        for (const field of fields) {
          const multiline = field.type === 'TEXTAREA'
          expect(field.fontSize).toBe(16)
          expect(field.lineHeight).toBe(24)
          expect(field.height).toBe(multiline ? 128 : 44)
          expect([field.paddingLeft, field.paddingRight]).toEqual([12, 12])
          expect([field.paddingTop, field.paddingBottom]).toEqual(multiline ? [12, 12] : [9, 9])
          expect(graph.getNode(field.parentId ?? '')?.itemSpacing).toBe(6)
        }
        const expected = templateControlStyles(graph)
        expect(expected.length).toBeGreaterThan(fields.length)
        let imported = graph
        for (let cycle = 0; cycle < 2; cycle++) {
          imported = await roundTrip(imported)
          expect(templateControlStyles(imported)).toEqual(expected)
        }
      } finally {
        editor.dispose()
      }
    }
  )
})

describe('lowcode control typography import boundary', () => {
  test('a future typography payload survives repeated real FIG saves without being overwritten', async () => {
    const { entry, value } = serializedControlTypography()
    const futureEntry = {
      ...entry,
      value: JSON.stringify({ ...value, version: 2, futureStyle: true })
    }
    let graph = new SceneGraph()
    const input = graph.createNode('INPUT', graph.getPages()[0].id, {
      name: 'Future typography control',
      pluginData: [futureEntry]
    })
    for (let cycle = 0; cycle < 2; cycle++) {
      graph = await roundTrip(graph)
      const restored = requiredNode(graph, input.name)
      expect(restored.type).toBe('INPUT')
      expect(restored.pluginData).toContainEqual(futureEntry)
      expect(restored.fontSize).toBe(input.fontSize)
    }
  })

  test.each([
    { order: 'node type first', reverse: false },
    { order: 'typography first', reverse: true }
  ])('typography applies with $order', ({ reverse }) => {
    const { node, entry } = serializedControlTypography()
    const entries = [
      nodeTypeEntry(),
      { pluginID: entry.pluginId, key: entry.key, value: entry.value }
    ]
    const imported = extractImportedLowcodeProps({
      pluginData: reverse ? entries.reverse() : entries
    })
    expect(imported.nodeTypeOverride).toBe('INPUT')
    expect(imported.props).toMatchObject({
      fontSize: node.fontSize,
      fontFamily: node.fontFamily,
      fontWeight: node.fontWeight,
      lineHeight: node.lineHeight,
      textAlignVertical: node.textAlignVertical
    })
    expect(imported.props.pluginData).not.toContainEqual(entry)
  })

  test.each(['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'])(
    'does not apply nonfinite %s from an otherwise complete JSON record',
    (field) => {
      const { entry, value } = serializedControlTypography()
      const invalidValue = JSON.stringify({ ...value, [field]: 'NON_FINITE_TEST_VALUE' }).replace(
        '"NON_FINITE_TEST_VALUE"',
        '1e400'
      )
      const invalidEntry = { ...entry, value: invalidValue }
      const imported = extractImportedLowcodeProps({
        pluginData: [
          nodeTypeEntry(),
          { pluginID: entry.pluginId, key: entry.key, value: invalidValue }
        ]
      })
      expect(imported.nodeTypeOverride).toBe('INPUT')
      expect(imported.props).not.toHaveProperty('fontSize')
      expect(imported.props.pluginData).toContainEqual(invalidEntry)
    }
  )

  test.each([
    ['future version', { version: 2 }],
    ['empty font family', { fontFamily: '' }],
    ['oversized font family', { fontFamily: 'x'.repeat(4097) }],
    ['negative font size', { fontSize: -1 }],
    ['numeric string', { fontSize: '18' }],
    ['zero font weight', { fontWeight: 0 }],
    ['negative line height', { lineHeight: -1 }],
    ['nonboolean italic', { italic: 'false' }],
    ['invalid letter spacing', { letterSpacing: null }],
    ['invalid horizontal alignment', { textAlignHorizontal: 'START' }],
    ['invalid vertical alignment', { textAlignVertical: 'MIDDLE' }],
    ['unknown field', { execute: 'ignored' }],
    ['missing field', { fontFamily: undefined }]
  ] as const)('keeps %s inert without applying any typography', (_name, patch) => {
    const { entry, value } = serializedControlTypography()
    const invalidEntry = { ...entry, value: JSON.stringify({ ...value, ...patch }) }
    const imported = extractImportedLowcodeProps({
      pluginData: [
        nodeTypeEntry(),
        { pluginID: invalidEntry.pluginId, key: invalidEntry.key, value: invalidEntry.value }
      ]
    })
    expect(imported.nodeTypeOverride).toBe('INPUT')
    expect(imported.props).not.toHaveProperty('fontSize')
    expect(imported.props).not.toHaveProperty('fontFamily')
    expect(imported.props.pluginData).toContainEqual(invalidEntry)
  })

  test.each(['{', 'null', '[]', 'true', '{"version":1,"fontSize":1e400}'])(
    'keeps malformed or incomplete JSON %s inert',
    (value) => {
      const entry = { pluginId: OPEN_PENCIL_PLUGIN_ID, key: TYPOGRAPHY_KEY, value }
      const imported = extractImportedLowcodeProps({
        pluginData: [nodeTypeEntry(), { pluginID: entry.pluginId, key: entry.key, value }]
      })
      expect(imported.nodeTypeOverride).toBe('INPUT')
      expect(imported.props).not.toHaveProperty('fontSize')
      expect(imported.props.pluginData).toContainEqual(entry)
    }
  )

  test.each(['TEXT', 'FRAME'] as const)(
    '%s does not emit or consume control typography',
    (type) => {
      const graph = new SceneGraph()
      const node = graph.createNode(type, graph.getPages()[0].id, { fontSize: 32, fontWeight: 700 })
      expect(serializeLowcodeFields(node).some((entry) => entry.key === TYPOGRAPHY_KEY)).toBe(false)
      const { entry } = serializedControlTypography()
      for (const nodeEntries of [[], [nodeTypeEntry(type)]]) {
        const imported = extractImportedLowcodeProps({
          pluginData: [
            ...nodeEntries,
            { pluginID: entry.pluginId, key: entry.key, value: entry.value }
          ]
        })
        expect(imported.nodeTypeOverride).toBeUndefined()
        expect(imported.props).not.toHaveProperty('fontSize')
        expect(imported.props.pluginData).toContainEqual(entry)
      }
    }
  )

  test('another plugin cannot override a lowcode control typography', () => {
    const { entry } = serializedControlTypography()
    const foreign = { ...entry, pluginId: 'example.unrelated-plugin' }
    const imported = extractImportedLowcodeProps({
      pluginData: [
        nodeTypeEntry(),
        { pluginID: foreign.pluginId, key: foreign.key, value: foreign.value }
      ]
    })
    expect(imported.nodeTypeOverride).toBe('INPUT')
    expect(imported.props).not.toHaveProperty('fontSize')
    expect(imported.props.pluginData).toContainEqual(foreign)
  })
})
