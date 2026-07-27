import { describe, expect, test } from 'bun:test'

import { parseFigBuffer } from '@open-pencil/fig'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { NodeType, SceneNode } from '@open-pencil/scene-graph'

import { figFormat } from '#core/io/formats'
import { exportFigFileWithOptions } from '#core/io/formats/fig/export'
import {
  FIGMA_PROJECTABLE_LOWCODE_TYPES,
  figmaTypeFor,
  projectLowcodeNodeForFigma
} from '#core/io/formats/fig/lowcode-projection'
import { parseFigFile } from '#core/io/formats/fig/read'
import {
  FIGMA_PROJECTION_PLUGIN_KEY,
  FIGMA_PROJECTION_VERSION,
  readFigmaProjectionMarker,
  type FigmaProjectionMarker
} from '#core/kiwi/fig/node-change/figma-projection'
import { LOWCODE_NODE_TYPE_KEY } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'

type ParsedFig = ReturnType<typeof parseFigBuffer>
type RawNodeChange = ParsedFig['nodeChanges'][number]

function marker(node: SceneNode): FigmaProjectionMarker | null {
  const entry = node.pluginData.find((item) => item.key === FIGMA_PROJECTION_PLUGIN_KEY)
  return entry ? (JSON.parse(entry.value) as FigmaProjectionMarker) : null
}

function nodeTypeEntry(node: SceneNode): string | null {
  const entry = node.pluginData.find((item) => item.key === LOWCODE_NODE_TYPE_KEY)
  return entry ? (JSON.parse(entry.value) as string) : null
}

function projected(type: NodeType, overrides: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const node = graph.createNode(type, graph.getPages()[0].id, overrides)
  const plan = projectLowcodeNodeForFigma(node, graph.getChildren(node.id))
  if (!plan) throw new Error(`Expected ${type} to be projectable`)
  return { graph, node, plan }
}

function rawNodeChanges(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  return parseFigBuffer(buffer).nodeChanges
}

function binaryData(data: Uint8Array | string): Uint8Array {
  if (typeof data === 'string') throw new Error('Expected binary .fig output')
  return data
}

function compatibleNodeName(type: (typeof FIGMA_PROJECTABLE_LOWCODE_TYPES)[number]): string {
  if (type === 'BUTTON') return 'Compatible button'
  if (type === 'SWITCH') return 'Compatible switch'
  return `Compatible ${type}`
}

function projectedLabelNode(changes: ParsedFig['nodeChanges']): RawNodeChange {
  return expectDefined(
    changes.find((node) => {
      const marker = readFigmaProjectionMarker(node)
      return node.type === 'TEXT' && marker?.role === 'label' && marker.field === 'text'
    }),
    'projected Button label'
  )
}

function expectCompleteCJKGlyphCache(parsed: ParsedFig, node: RawNodeChange, text: string): void {
  const derived = expectDefined(node.derivedTextData, 'projected derived text')
  const glyphs = expectDefined(derived.glyphs, 'projected glyph cache')
  const fontMeta = expectDefined(derived.fontMetaData?.[0], 'projected font metadata')
  const baseline = expectDefined(derived.baselines?.[0], 'projected baseline')
  const fontSize = expectDefined(node.fontSize, 'projected font size')
  const nodeWidth = expectDefined(node.size?.x, 'projected text width')
  const nodeHeight = expectDefined(node.size?.y, 'projected text height')
  const authoredLineHeight = expectDefined(node.lineHeight?.value, 'projected line height')
  const characters = Array.from(text)
  const lineWidth = glyphs.reduce((width, glyph) => width + glyph.advance * fontSize, 0)
  const expectedX = (nodeWidth - lineWidth) / 2

  expect(glyphs).toHaveLength(characters.length)
  expect(glyphs[0]?.position.x).toBeCloseTo(expectedX, 4)
  expect(baseline.position.x).toBeCloseTo(expectedX, 4)
  expect(baseline.width).toBeCloseTo(lineWidth, 4)
  expect(baseline.endCharacter).toBe(characters.length)
  expect(baseline.lineY).toBeCloseTo((nodeHeight - authoredLineHeight) / 2, 4)
  expect(baseline.position.y).toBeCloseTo(glyphs[0]?.position.y ?? Number.NaN, 4)
  expect(baseline.lineHeight).toBeCloseTo(fontMeta.fontLineHeight * fontSize, 4)
  expect(Number.isInteger(baseline.lineAscent)).toBe(true)
  expect(derived.logicalIndexToCharacterOffsetMap).toHaveLength(characters.length)
  expect(fontMeta.key).toMatchObject({ family: 'Noto Sans SC', style: 'Regular' })
  expect(fontMeta.fontDigest).toBeInstanceOf(Uint8Array)
  expect(fontMeta.fontDigest).toHaveLength(20)
  for (const [index, glyph] of glyphs.entries()) {
    expect(typeof glyph.commandsBlob).toBe('number')
    expect(glyph.advance).toBeGreaterThan(0)
    expect(glyph.advance).toBeLessThanOrEqual(1)
    const blobLength = parsed.blobs[glyph.commandsBlob ?? -1]?.byteLength ?? 0
    if (/\s/u.test(characters[index] ?? '')) expect(blobLength).toBe(0)
    else expect(blobLength).toBeGreaterThan(0)
  }
}

describe('Figma-compatible lowcode visual projection', () => {
  test('covers every lowcode control with a native FRAME root and stable side-channel', () => {
    expect(FIGMA_PROJECTABLE_LOWCODE_TYPES).toEqual([
      'BUTTON',
      'INPUT',
      'TEXTAREA',
      'SELECT',
      'DATEPICKER',
      'CHECKBOX',
      'RADIO',
      'SWITCH',
      'FORM',
      'LIST'
    ])

    for (const type of FIGMA_PROJECTABLE_LOWCODE_TYPES) {
      const { plan } = projected(type)
      expect(plan.version).toBe(FIGMA_PROJECTION_VERSION)
      expect(plan.root.type).toBe('FRAME')
      expect(plan.figmaType).toBe('FRAME')
      expect(plan.sourceNodeType).toBe(type)
      expect(nodeTypeEntry(plan.root)).toBe(type)
      expect(marker(plan.root)).toBeNull()
      expect(plan.allNodes[0]).toBe(plan.root)
      for (const synthetic of plan.syntheticNodes) {
        expect(marker(synthetic)?.version).toBe(FIGMA_PROJECTION_VERSION)
      }
    }
  })

  test('projects editable text fields with importer-compatible markers', () => {
    const button = projected('BUTTON', { interactiveProps: { text: 'Save' } }).plan
    const input = projected('INPUT', {
      interactiveProps: { value: '', placeholder: 'Email address' }
    }).plan
    const textarea = projected('TEXTAREA', {
      interactiveProps: { value: 'Draft', placeholder: 'Details' }
    }).plan
    const select = projected('SELECT', {
      interactiveProps: { options: ['Draft', 'Published'], value: '' }
    }).plan
    const date = projected('DATEPICKER', { interactiveProps: { value: '2026-07-27' } }).plan

    expect(button.syntheticNodes[0]).toMatchObject({
      type: 'TEXT',
      text: 'Save',
      fills: [{ color: { r: 0.12, g: 0.14, b: 0.18, a: 1 } }]
    })
    expect(marker(button.syntheticNodes[0])).toEqual({
      version: FIGMA_PROJECTION_VERSION,
      role: 'label',
      field: 'text'
    })
    expect(input.syntheticNodes[0]).toMatchObject({ type: 'TEXT', text: 'Email address' })
    expect(marker(input.syntheticNodes[0])).toMatchObject({
      role: 'placeholder',
      field: 'placeholder'
    })
    expect(textarea.syntheticNodes[0]).toMatchObject({ type: 'TEXT', text: 'Draft' })
    expect(marker(textarea.syntheticNodes[0])).toMatchObject({ role: 'value', field: 'value' })
    expect(select.syntheticNodes[0]).toMatchObject({ type: 'TEXT', text: 'Draft' })
    expect(marker(select.syntheticNodes[0])).toEqual({
      version: FIGMA_PROJECTION_VERSION,
      role: 'option'
    })
    expect(marker(select.syntheticNodes[1])).toMatchObject({ role: 'chevron' })
    expect(date.syntheticNodes[0]).toMatchObject({ type: 'TEXT', text: '2026-07-27' })
    expect(marker(date.syntheticNodes[0])).toMatchObject({ role: 'value', field: 'value' })
    expect(marker(date.syntheticNodes[1])).toMatchObject({ role: 'calendar-icon' })
  })

  test('builds nested option rows and indexed option labels for RADIO and CHECKBOX groups', () => {
    for (const type of ['RADIO', 'CHECKBOX'] as const) {
      const { plan } = projected(type, {
        width: 220,
        height: 80,
        interactiveProps: { options: ['Alpha', 'Beta'], value: 'Beta', checked: true }
      })
      const rows = plan.childrenFor(plan.root)
      expect(rows).toHaveLength(2)
      expect(rows.every((row) => row.type === 'FRAME')).toBe(true)
      expect(rows.map((row) => marker(row)?.role)).toEqual(['option', 'option'])

      for (let index = 0; index < rows.length; index++) {
        const rowChildren = plan.childrenFor(rows[index])
        expect(rowChildren.map((child) => child.type)).toEqual([
          type === 'RADIO' ? 'ELLIPSE' : 'RECTANGLE',
          'TEXT'
        ])
        expect(marker(rowChildren[1])).toEqual({
          version: FIGMA_PROJECTION_VERSION,
          role: 'label',
          field: 'options',
          index
        })
        expect(rowChildren[1].text).toBe(index === 0 ? 'Alpha' : 'Beta')
      }
    }
  })

  test('projects boolean controls without text-field markers', () => {
    const checkbox = projected('CHECKBOX', { interactiveProps: { checked: true } }).plan
    const checkboxIndicator = checkbox.syntheticNodes[0]
    expect(checkboxIndicator.visible).toBe(true)
    expect(marker(checkboxIndicator)).toEqual({
      version: FIGMA_PROJECTION_VERSION,
      role: 'indicator'
    })

    const toggle = projected('SWITCH', { interactiveProps: { checked: true } }).plan
    expect(toggle.syntheticNodes.map((node) => node.type)).toEqual(['RECTANGLE', 'ELLIPSE'])
    expect(marker(toggle.syntheticNodes[0])).toEqual({
      version: FIGMA_PROJECTION_VERSION,
      role: 'track'
    })
    expect(marker(toggle.syntheticNodes[1])).toEqual({
      version: FIGMA_PROJECTION_VERSION,
      role: 'thumb'
    })
    expect(toggle.syntheticNodes[1].x).toBeGreaterThan(2)
  })

  test('FORM and LIST preserve authored children while becoming native containers', () => {
    for (const type of ['FORM', 'LIST'] as const) {
      const graph = new SceneGraph()
      const node = graph.createNode(type, graph.getPages()[0].id)
      const child = graph.createNode('RECTANGLE', node.id, { name: `${type} child` })
      const plan = projectLowcodeNodeForFigma(node, graph.getChildren(node.id))
      if (!plan) throw new Error(`Expected ${type} projection`)

      expect(plan.root.type).toBe('FRAME')
      expect(plan.root.childIds).toEqual([child.id])
      expect(plan.syntheticNodes).toEqual([])
      expect(plan.childrenFor(plan.root).map((entry) => entry.id)).toEqual([child.id])
    }
  })

  test('is deterministic and never mutates or aliases the source node', () => {
    const graph = new SceneGraph()
    const source = graph.createNode('BUTTON', graph.getPages()[0].id, {
      layoutMode: 'FREE',
      primaryAxisSizing: 'HUG',
      paddingLeft: 13,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      interactiveProps: { text: 'Continue' }
    })
    const before = structuredClone(source)
    const first = projectLowcodeNodeForFigma(source)
    const second = projectLowcodeNodeForFigma(source)
    if (!first || !second) throw new Error('Expected BUTTON projection')

    expect(source).toEqual(before)
    expect(first.root).toEqual(second.root)
    expect(first.syntheticNodes).toEqual(second.syntheticNodes)
    expect(first.root).toMatchObject({
      type: 'FRAME',
      layoutMode: 'FREE',
      primaryAxisSizing: 'HUG',
      paddingLeft: 13,
      fills: before.fills
    })

    first.root.fills[0].color.r = 1
    first.root.interactiveProps = { text: 'Changed only in projection' }
    expect(source).toEqual(before)
  })

  test('leaves ordinary Figma-native nodes outside the projection', () => {
    const graph = new SceneGraph()
    const rectangle = graph.createNode('RECTANGLE', graph.getPages()[0].id)
    expect(figmaTypeFor(rectangle)).toBe('RECTANGLE')
    expect(projectLowcodeNodeForFigma(rectangle)).toBeNull()
  })

  test('wires the compatible profile into raw NodeChanges without changing roundtrip export', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('BUTTON', page.id, {
      name: 'Compatible button',
      interactiveProps: { text: 'Continue' }
    })
    graph.createNode('SWITCH', page.id, {
      name: 'Compatible switch',
      interactiveProps: { checked: true }
    })
    for (const type of FIGMA_PROJECTABLE_LOWCODE_TYPES) {
      if (type === 'BUTTON' || type === 'SWITCH') continue
      graph.createNode(type, page.id, { name: `Compatible ${type}` })
    }

    const compatible = rawNodeChanges(
      await exportFigFileWithOptions(graph, { profile: 'figma-compatible' })
    )
    for (const type of FIGMA_PROJECTABLE_LOWCODE_TYPES) {
      const name = compatibleNodeName(type)
      expect(compatible.find((node) => node.name === name)?.type).toBe('FRAME')
    }

    const projectedText = compatible.find(
      (node) => node.type === 'TEXT' && readFigmaProjectionMarker(node)?.role === 'label'
    )
    const projectedThumb = compatible.find(
      (node) => node.type === 'ELLIPSE' && readFigmaProjectionMarker(node)?.role === 'thumb'
    )
    expect(projectedText?.textData?.characters).toBe('Continue')
    expect(readFigmaProjectionMarker(projectedText ?? {})).toEqual({
      version: FIGMA_PROJECTION_VERSION,
      role: 'label',
      field: 'text'
    })
    expect(readFigmaProjectionMarker(projectedThumb ?? {})).toEqual({
      version: FIGMA_PROJECTION_VERSION,
      role: 'thumb'
    })

    const roundtrip = rawNodeChanges(
      await exportFigFileWithOptions(graph, { profile: 'roundtrip' })
    )
    for (const type of FIGMA_PROJECTABLE_LOWCODE_TYPES) {
      const name = compatibleNodeName(type)
      expect(roundtrip.find((node) => node.name === name)?.type).toBe('RECTANGLE')
    }
    expect(roundtrip.some((node) => readFigmaProjectionMarker(node))).toBe(false)
  })

  test('exports Chinese Button text without .notdef glyphs and restores its lowcode value', async () => {
    const family = 'ProjectionLatinOnly'
    const label = '整理行囊 128'
    const latinOnlyFont = await Bun.file(
      'tests/fixtures/fonts/NotoNaskhArabic-Regular.ttf'
    ).arrayBuffer()
    fontManager.markLoaded(family, 'Regular', latinOnlyFont)

    const graph = new SceneGraph()
    const sourceButton = graph.createNode('BUTTON', graph.getPages()[0].id, {
      name: '中文按钮',
      width: 180,
      height: 44,
      fontFamily: family,
      fontWeight: 600,
      interactiveProps: { text: label }
    })

    const bytes = await exportFigFileWithOptions(graph, { profile: 'figma-compatible' })
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    const parsed = parseFigBuffer(buffer)
    const projectedLabel = projectedLabelNode(parsed.nodeChanges)

    expect(projectedLabel.textData?.characters).toBe(label)
    expect(projectedLabel.fontName).toEqual({
      family: 'Noto Sans SC',
      style: 'Regular',
      postscript: ''
    })
    const labelColor = expectDefined(projectedLabel.fillPaints?.[0]?.color, 'label color')
    expect(labelColor.r).toBeCloseTo(0.12, 5)
    expect(labelColor.g).toBeCloseTo(0.14, 5)
    expect(labelColor.b).toBeCloseTo(0.18, 5)
    expect(labelColor.a).toBe(1)
    expectCompleteCJKGlyphCache(parsed, projectedLabel, label)

    const reopened = await parseFigFile(buffer)
    const button = [...reopened.getAllNodes()].find((node) => node.name === '中文按钮')
    expect(button).toMatchObject({
      type: 'BUTTON',
      interactiveProps: { text: label }
    })
    expect([...reopened.getAllNodes()].some((node) => node.name.startsWith('[OpenPencil]'))).toBe(
      false
    )
    expect(sourceButton).toMatchObject({
      type: 'BUTTON',
      fontFamily: family,
      fontWeight: 600,
      interactiveProps: { text: label }
    })
  })

  test('keeps document writes roundtrip-safe and makes explicit exports Figma-compatible', async () => {
    const graph = new SceneGraph()
    graph.createNode('BUTTON', graph.getPages()[0].id, {
      name: 'Profile button',
      interactiveProps: { text: 'Export' }
    })
    if (!figFormat.writeDocument || !figFormat.exportContent) {
      throw new Error('Expected .fig write and export support')
    }

    const written = rawNodeChanges(binaryData((await figFormat.writeDocument(graph)).data))
    const exported = rawNodeChanges(
      binaryData(
        (
          await figFormat.exportContent({
            graph,
            target: { scope: 'document' }
          })
        ).data
      )
    )

    expect(written.find((node) => node.name === 'Profile button')?.type).toBe('RECTANGLE')
    expect(exported.find((node) => node.name === 'Profile button')?.type).toBe('FRAME')
    expect(exported.some((node) => readFigmaProjectionMarker(node))).toBe(true)
  })
})
