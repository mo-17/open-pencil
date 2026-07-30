import { describe, expect, test } from 'bun:test'

import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'

import {
  applyStyleRefsToFields,
  buildStyleOverrideTable,
  convertEffects,
  convertFills,
  convertFontFeatures,
  convertLetterSpacing,
  convertLineHeight,
  convertStrokes,
  decodeVectorNetworkBlob,
  encodePathCommandsBlob,
  encodeVectorNetworkBlob,
  FIGMA_OPAQUE_NODE_TYPES,
  materializeFigmaPayload,
  mapTextDecoration,
  nodeChangeToProps,
  preserveFigmaPayloadBlobs,
  setVariableColorResolver
} from '../src/node-change'

describe('@open-pencil/fig NodeChange policy', () => {
  test('converts normalized text values', () => {
    expect(convertLineHeight({ value: 120, units: 'PERCENT' }, 20)).toBe(24)
    expect(convertLetterSpacing({ value: 10, units: 'PERCENT' }, 20)).toBe(2)
    expect(mapTextDecoration('UNDERLINE')).toBe('UNDERLINE')
  })

  test('converts Figma OpenType feature toggles', () => {
    expect(
      convertFontFeatures({
        toggledOnOTFeatures: ['DLIG'],
        toggledOffOTFeatures: ['LIGA']
      })
    ).toEqual([
      { tag: 'DLIG', enabled: true },
      { tag: 'LIGA', enabled: false }
    ])
  })

  test('normalizes imported paints and effects', () => {
    expect(convertFills([{ type: 'SOLID' }])[0]).toMatchObject({
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true
    })
    expect(convertEffects([{ type: 'DROP_SHADOW' }])[0]).toMatchObject({
      type: 'DROP_SHADOW',
      radius: 0,
      visible: true
    })
  })

  test('keeps resolved variable alpha in paint opacity', () => {
    setVariableColorResolver(() => ({ r: 1, g: 0, b: 0, a: 0.4 }))
    try {
      const paint: Paint = {
        type: 'SOLID',
        color: { r: 0, g: 0, b: 0, a: 1 },
        colorVar: { value: { alias: { guid: { sessionID: 1, localID: 2 } } } }
      }
      expect(convertFills([paint])[0]).toMatchObject({
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 0.4
      })
      expect(convertStrokes([paint])[0]).toMatchObject({
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 0.4
      })
    } finally {
      setVariableColorResolver(null)
    }
  })

  test('uses vector-region winding rules for rendered geometry', () => {
    const network = {
      vertices: [
        { x: 0, y: 0, handleMirroring: 'NONE' as const },
        { x: 10, y: 0, handleMirroring: 'NONE' as const },
        { x: 0, y: 10, handleMirroring: 'NONE' as const }
      ],
      segments: [
        {
          start: 0,
          end: 1,
          tangentStart: { x: 0, y: 0 },
          tangentEnd: { x: 0, y: 0 }
        },
        {
          start: 1,
          end: 2,
          tangentStart: { x: 0, y: 0 },
          tangentEnd: { x: 0, y: 0 }
        },
        {
          start: 2,
          end: 0,
          tangentStart: { x: 0, y: 0 },
          tangentEnd: { x: 0, y: 0 }
        }
      ],
      regions: [{ windingRule: 'EVENODD' as const, loops: [[0, 1, 2]] }]
    }
    const props = nodeChangeToProps(
      {
        type: 'VECTOR',
        fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: 0 }],
        vectorData: { vectorNetworkBlob: 1 }
      } as NodeChange,
      [
        encodePathCommandsBlob([
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: 10, y: 0 },
          { type: 'L', x: 0, y: 10 },
          { type: 'Z' }
        ]),
        encodeVectorNetworkBlob(network)
      ]
    )

    expect(props.fillGeometry?.[0]?.windingRule).toBe('EVENODD')
  })

  test('round-trips vector network blobs with handle mirroring', () => {
    const network = {
      vertices: [
        { x: 0, y: 0, handleMirroring: 'ANGLE' as const },
        { x: 10, y: 0, handleMirroring: 'NONE' as const }
      ],
      segments: [
        {
          start: 0,
          end: 1,
          tangentStart: { x: 0, y: 0 },
          tangentEnd: { x: 0, y: 0 }
        }
      ],
      regions: []
    }
    const { table, mirroringToId } = buildStyleOverrideTable(network)
    expect(decodeVectorNetworkBlob(encodeVectorNetworkBlob(network, mirroringToId), table)).toEqual(
      network
    )
  })

  test('resolves imported style references before SceneGraph conversion', () => {
    const fields: Record<string, unknown> = {
      styleIdForFill: { guid: { sessionID: 2, localID: 3 } }
    }
    applyStyleRefsToFields(
      new Map([
        [
          '2:3',
          {
            type: 'RECTANGLE',
            styleType: 'FILL',
            fillPaints: [{ type: 'SOLID', visible: true }]
          }
        ]
      ]),
      fields
    )
    expect(fields.fillPaints).toEqual([{ type: 'SOLID', visible: true }])
  })

  test('projects opaque Figma node types to rectangles while retaining their source type', () => {
    expect(FIGMA_OPAQUE_NODE_TYPES).toHaveLength(5)
    for (const type of FIGMA_OPAQUE_NODE_TYPES) {
      const props = nodeChangeToProps({ type } as NodeChange, [])
      expect(props.nodeType).toBe('RECTANGLE')
      expect(props.source?.fig.rawNodeType).toBe(type)
      expect(props.source?.fig.rawStructuralFieldPresence).toEqual({
        name: false,
        visible: false,
        opacity: false,
        size: false,
        transform: false,
        frameMaskDisabled: false
      })
    }
  })

  test('deep-clones motion payloads and materializes nested keyframe blobs', () => {
    const glyphBlob = new Uint8Array([0x4d, 0x4f, 0x54, 0x4e])
    const imageBlob = new Uint8Array([0x49, 0x4d, 0x47])
    const keyframeValue = {
      value: {
        textDataValue: {
          characters: '动',
          glyphs: [
            {
              commandsBlob: 0,
              position: { x: 1, y: 2 },
              fontSize: 16,
              firstCharacter: 0,
              advance: 8,
              rotation: 0
            }
          ]
        }
      },
      valueType: 'TEXT_DATA'
    }
    const motionTransform = {
      translation: { x: 12, y: 24 },
      rotation: 0.5,
      scale: { x: 1.2, y: 0.8 },
      shearX: 0.1
    }

    const props = nodeChangeToProps(
      {
        type: 'RECTANGLE',
        keyframeValue,
        keyframeValueRef: {
          value: {
            imageValue: {
              image: { hash: new Uint8Array([1, 2]), name: 'keyframe.png', dataBlob: 1 }
            }
          },
          dataType: 'IMAGE',
          resolvedDataType: 'IMAGE'
        },
        motionTransform
      } as NodeChange,
      [glyphBlob, imageBlob]
    )
    const raw = props.source?.fig.rawNodeFields
    if (!raw) throw new Error('Expected raw Figma node fields to be preserved')
    const preservedKeyframe = raw.keyframeValue as {
      value: {
        textDataValue: {
          glyphs: Array<{ commandsBlob: { __openPencilFigmaBlob: Uint8Array } }>
        }
      }
    }
    const preservedTransform = raw?.motionTransform as typeof motionTransform
    const preservedBlob =
      preservedKeyframe.value.textDataValue.glyphs[0].commandsBlob.__openPencilFigmaBlob
    const preservedImageBlob = (
      raw.keyframeValueRef as {
        value: {
          imageValue: {
            image: { dataBlob: { __openPencilFigmaBlob: Uint8Array } }
          }
        }
      }
    ).value.imageValue.image.dataBlob.__openPencilFigmaBlob

    expect(preservedKeyframe).not.toBe(keyframeValue)
    expect(preservedKeyframe.value).not.toBe(keyframeValue.value)
    expect(preservedTransform).not.toBe(motionTransform)
    expect(preservedBlob).not.toBe(glyphBlob)
    expect(preservedBlob).toEqual(glyphBlob)
    expect(preservedImageBlob).not.toBe(imageBlob)
    expect(preservedImageBlob).toEqual(imageBlob)

    glyphBlob[0] = 0
    imageBlob[0] = 0
    keyframeValue.value.textDataValue.characters = '改'
    motionTransform.translation.x = 99
    expect(preservedBlob).toEqual(new Uint8Array([0x4d, 0x4f, 0x54, 0x4e]))
    expect(preservedImageBlob).toEqual(new Uint8Array([0x49, 0x4d, 0x47]))
    const rawKeyframeValue = raw?.keyframeValue as
      | { value: { textDataValue: { characters: string } } }
      | undefined
    expect(rawKeyframeValue?.value.textDataValue.characters).toBe('动')
    expect(preservedTransform.translation.x).toBe(12)

    const blobs: Uint8Array[] = []
    const materialized = materializeFigmaPayload(preservedKeyframe, blobs, {
      blobIndexByHex: new Map()
    }) as typeof keyframeValue
    expect(materialized.value.textDataValue.glyphs[0].commandsBlob).toBe(0)
    expect(blobs).toEqual([new Uint8Array([0x4d, 0x4f, 0x54, 0x4e])])

    const directClone = preserveFigmaPayloadBlobs({ bytes: preservedBlob }, []) as {
      bytes: Uint8Array
    }
    expect(directClone.bytes).not.toBe(preservedBlob)
    expect(directClone.bytes).toEqual(preservedBlob)
  })
})
