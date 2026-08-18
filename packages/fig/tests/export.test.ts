import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  buildComponentPropIndex,
  fractionalPosition,
  mapToFigmaType,
  sceneNodeToKiwi,
  type FigNodeChangeExportRuntime
} from '../src/node-change'

const ALIGNMENT_RUNTIME: FigNodeChangeExportRuntime = {
  getGlyphOutlineMetrics: () => [
    { commands: [{ type: 'M', x: 0, y: 0 }], x: 0, advance: 10 },
    { commands: [{ type: 'M', x: 0, y: 0 }], x: 10, advance: 10 }
  ],
  getFontVerticalMetrics: () => ({ ascent: 14, descent: 2, naturalLineHeight: 16 })
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`)
  return value
}

function expectGeneratedTextAlignment(
  alignment: 'LEFT' | 'CENTER' | 'RIGHT',
  offset: number
): void {
  const graph = new SceneGraph()
  const text = graph.createNode('TEXT', graph.getPages()[0].id, {
    text: 'AB',
    width: 100,
    height: 40,
    fontSize: 16,
    textAlignHorizontal: alignment,
    textAlignVertical: 'CENTER'
  })
  const [change] = sceneNodeToKiwi(
    text,
    { sessionID: 1, localID: 1 },
    0,
    { value: 2 },
    graph,
    [],
    undefined,
    new Map([['Inter|Regular', new Uint8Array([1, 2, 3])]]),
    undefined,
    new Map(),
    undefined,
    undefined,
    ALIGNMENT_RUNTIME
  )
  const derived = required(change.derivedTextData, 'derived text data')
  const glyphs = required(derived.glyphs, 'derived glyphs')
  const baseline = required(derived.baselines?.[0], 'derived baseline')

  expect(glyphs.map((glyph) => glyph.position.x)).toEqual([offset, offset + 10])
  expect(baseline.position).toEqual({ x: offset, y: 26 })
  expect(baseline.width).toBe(20)
  expect(baseline.lineY).toBe(10)
  expect(baseline.lineHeight).toBe(20)
  expect(baseline.endCharacter).toBe(2)
  expect(baseline.lineAscent).toBe(14)
  expect(glyphs.map((glyph) => glyph.position.y)).toEqual([26, 26])
  expect(glyphs.map((glyph) => glyph.advance)).toEqual([0.625, 0.625])
  expect(derived.logicalIndexToCharacterOffsetMap).toEqual([0, 10])
  expect(derived.layoutSize).toEqual({ x: 100, y: 40 })
}

describe('@open-pencil/fig SceneGraph export policy', () => {
  test('maps node types and sibling positions deterministically', () => {
    expect(mapToFigmaType('COMPONENT')).toBe('SYMBOL')
    expect([0, 93, 94, 188].map(fractionalPosition)).toEqual(['!', '~', '~!', '~~!'])
  })

  test('reuses an export-scoped component property definition index', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, {
      componentPropertyDefinitions: [
        { id: '1:100', name: 'Label', type: 'TEXT', defaultValue: 'Default' }
      ]
    })
    const instance = graph.createNode('INSTANCE', page.id, {
      componentId: component.id,
      componentPropertyAssignments: { '1:100': 'Override' }
    })
    const serialize = (definitions?: ReturnType<typeof buildComponentPropIndex>) =>
      sceneNodeToKiwi(
        instance,
        { sessionID: 1, localID: 1 },
        0,
        { value: 2 },
        graph,
        [],
        new Map(),
        undefined,
        undefined,
        undefined,
        undefined,
        new Set(),
        undefined,
        definitions
      )[0].componentPropAssignments

    const definitions = buildComponentPropIndex(graph)
    expect(definitions.get('1:100')).toBe(component.componentPropertyDefinitions[0])
    expect(serialize(definitions)).toEqual(serialize())
  })

  test('merges edited text into an existing override path', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id)
    const sourceText = graph.createNode('TEXT', component.id, {
      overrideKey: '2:20',
      text: 'Default'
    })
    const instance = graph.createInstance(component.id, page.id)
    expect(instance).toBeDefined()
    const targetText = graph.getChildren(instance?.id ?? '')[0]
    expect(targetText).toBeDefined()
    const originalOverride = {
      guidPath: { guids: [{ sessionID: 2, localID: 20 }] },
      textData: { characters: 'Stale' },
      opacity: 0.5
    }
    graph.updateNode(instance?.id ?? '', {
      overrides: { [`${targetText?.id}:text`]: 'Edited' },
      source: {
        ...instance?.source,
        fig: {
          ...instance?.source.fig,
          symbolOverrides: [originalOverride]
        }
      }
    })

    const [change] = sceneNodeToKiwi(
      graph.getNode(instance?.id ?? '') ?? instance,
      { sessionID: 1, localID: 1 },
      0,
      { value: 2 },
      graph,
      []
    )

    expect(sourceText.overrideKey).toBe('2:20')
    expect(change.symbolData?.symbolOverrides).toEqual([
      {
        ...originalOverride,
        textData: { characters: 'Edited' }
      }
    ])
  })

  test('injects runtime glyph outlines into derived text data', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: 'A',
      width: 20,
      height: 20,
      fontSize: 16
    })
    const blobs: Uint8Array[] = []
    const runtime: FigNodeChangeExportRuntime = {
      getGlyphOutlineMetrics: () => [
        {
          commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 8, y: 16 }, { type: 'Z' }],
          x: 0,
          advance: 10
        }
      ]
    }

    const [change] = sceneNodeToKiwi(
      text,
      { sessionID: 1, localID: 1 },
      0,
      { value: 2 },
      graph,
      blobs,
      undefined,
      new Map([['Inter|Regular', new Uint8Array([1, 2, 3])]]),
      undefined,
      new Map(),
      undefined,
      undefined,
      runtime
    )

    expect(change.derivedTextData?.glyphs).toHaveLength(1)
    expect(blobs).toHaveLength(1)
  })

  test('bakes horizontal text alignment into generated glyph positions', () => {
    const expectedOffsets = { LEFT: 0, CENTER: 40, RIGHT: 80 } as const
    for (const [alignment, offset] of Object.entries(expectedOffsets)) {
      expectGeneratedTextAlignment(alignment as keyof typeof expectedOffsets, offset)
    }
  })

  test('excludes trailing whitespace and uses Unicode code-point indices', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: '🐸 ',
      width: 100,
      height: 40,
      fontSize: 16,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'CENTER'
    })
    const [change] = sceneNodeToKiwi(
      text,
      { sessionID: 1, localID: 1 },
      0,
      { value: 2 },
      graph,
      [],
      undefined,
      new Map([['Inter|Regular', new Uint8Array([1, 2, 3])]]),
      undefined,
      new Map(),
      undefined,
      undefined,
      ALIGNMENT_RUNTIME
    )
    const derived = required(change.derivedTextData, 'derived text data')
    const glyphs = required(derived.glyphs, 'derived glyphs')
    const baseline = required(derived.baselines?.[0], 'derived baseline')

    expect(glyphs.map((glyph) => glyph.position.x)).toEqual([45, 55])
    expect(baseline.position.x).toBe(45)
    expect(baseline.width).toBe(20)
    expect(baseline.endCharacter).toBe(2)
    expect(glyphs.map((glyph) => glyph.firstCharacter)).toEqual([0, 1])
    expect(derived.logicalIndexToCharacterOffsetMap).toEqual([0, 10])
  })

  test('preserves zero-advance generated glyph metrics', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: 'A\u0301',
      width: 100,
      height: 20,
      fontSize: 16,
      textAlignHorizontal: 'CENTER'
    })
    const runtime: FigNodeChangeExportRuntime = {
      getGlyphOutlineMetrics: () => [
        { commands: [{ type: 'M', x: 0, y: 0 }], x: 0, advance: 10 },
        { commands: [{ type: 'M', x: 0, y: 0 }], x: 10, advance: 0 }
      ]
    }
    const [change] = sceneNodeToKiwi(
      text,
      { sessionID: 1, localID: 1 },
      0,
      { value: 2 },
      graph,
      [],
      undefined,
      new Map([['Inter|Regular', new Uint8Array([1, 2, 3])]]),
      undefined,
      new Map(),
      undefined,
      undefined,
      runtime
    )
    const glyphs = required(change.derivedTextData?.glyphs, 'derived glyphs')

    expect(glyphs.map((glyph) => glyph.position.x)).toEqual([45, 55])
    expect(glyphs.map((glyph) => glyph.advance)).toEqual([0.625, 0])
  })

  test('keeps derived text metadata but omits the glyph field when outlines are unavailable', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: '整理行囊',
      width: 80,
      height: 20,
      fontSize: 16
    })
    const blobs: Uint8Array[] = []

    const [change] = sceneNodeToKiwi(
      text,
      { sessionID: 1, localID: 1 },
      0,
      { value: 2 },
      graph,
      blobs,
      undefined,
      new Map([['Inter|Regular', new Uint8Array([1, 2, 3])]])
    )

    expect(change.textData?.characters).toBe('整理行囊')
    expect(change.derivedTextData).toBeDefined()
    expect(Object.hasOwn(change.derivedTextData ?? {}, 'glyphs')).toBe(false)
    expect(change.derivedTextData?.fontMetaData).toHaveLength(1)
    expect(change.derivedTextData?.layoutSize).toEqual({ x: 80, y: 20 })
    expect(blobs).toHaveLength(0)
  })

  test('preserves imported derived glyphs without runtime outlines', () => {
    const graph = new SceneGraph()
    const commandsBlob = new Uint8Array([1, 2, 3])
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: 'A',
      width: 20,
      height: 20,
      fontSize: 16,
      textAlignHorizontal: 'CENTER',
      derivedTextGlyphs: [{ commandsBlob, x: 0, y: 16, fontSize: 16, rotation: 0 }]
    })
    const blobs: Uint8Array[] = []

    const [change] = sceneNodeToKiwi(
      text,
      { sessionID: 1, localID: 1 },
      0,
      { value: 2 },
      graph,
      blobs,
      undefined,
      new Map([['Inter|Regular', new Uint8Array([1, 2, 3])]])
    )

    expect(change.derivedTextData?.glyphs).toHaveLength(1)
    expect(change.derivedTextData?.glyphs?.[0]?.position?.x).toBe(0)
    expect(blobs).toEqual([commandsBlob])
  })
})
