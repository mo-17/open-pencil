import { beforeAll, describe, expect, test } from 'bun:test'

import { deflateSync } from 'fflate'

import {
  exportFigFile,
  getSchemaBytes,
  importNodeChanges,
  initCodec,
  parseFigFile
} from '@open-pencil/core'
import { parseFigBuffer, writeFigArchive } from '@open-pencil/fig'
import {
  FIGMA_INTERACTION_MEDIA_MOTION_RAW_FIELD_KEYS,
  guidToString
} from '@open-pencil/fig/node-change'
import { encodeMessage } from '@open-pencil/kiwi/fig/codec'
import type { FigmaMessage, NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  ByteBuffer,
  decodeBinarySchema,
  encodeBinarySchema
} from '@open-pencil/kiwi/schema-runtime'

const documentGuid = { sessionID: 0, localID: 0 }
const canvasGuid = { sessionID: 0, localID: 1 }
const timelineGuid = { sessionID: 7, localID: 100 }
const containingTimelineGuid = { sessionID: 7, localID: 101 }
const presetGuid = { sessionID: 7, localID: 102 }
const trackGuid = { sessionID: 7, localID: 103 }
const animationStyleGuid = { sessionID: 7, localID: 104 }
const targetGuid = { sessionID: 7, localID: 105 }
const interactionGuid = { sessionID: 7, localID: 106 }
const prototypeInteractionGuid = { sessionID: 7, localID: 107 }

const expectedGlyphBlob = new Uint8Array([0x47, 0x4c, 0x59, 0x50, 0x48])
const expectedImageBlob = new Uint8Array([0x49, 0x4d, 0x41, 0x47, 0x45])

function opaqueMetadata(): Record<string, unknown> {
  return {
    transitionNodeID: targetGuid,
    prototypeStartNodeID: targetGuid,
    prototypeBackgroundColor: { r: 0.125, g: 0.25, b: 0.5, a: 1 },
    transitionInfo: { type: 'DISSOLVE', duration: 0.25 },
    transitionType: 'SMART_ANIMATE',
    transitionDuration: 0.5,
    easingType: 'CUSTOM_CUBIC',
    scrollDirection: 'VERTICAL',
    scrollOffset: { x: 0, y: 24 },
    scrollContractedState: 'CONTRACTED',
    transitionPreserveScroll: true,
    connectionType: 'OBJECT_ANIMATION',
    connectionURL: 'https://example.com',
    prototypeDevice: { type: 'CUSTOM', size: { x: 390, y: 844 }, rotation: 'NONE' },
    scrollBehavior: 'STICKY_SCROLLS',
    interactionType: 'ON_CLICK',
    transitionTimeout: 1.25,
    interactionMaintained: true,
    interactionDuration: 0.75,
    destinationIsOverlay: true,
    navigationType: 'OVERLAY',
    overlayPositionType: 'MANUAL',
    overlayRelativePosition: { x: 12, y: 16 },
    overlayBackgroundInteraction: 'CLOSE_ON_CLICK_OUTSIDE',
    overlayBackgroundAppearance: {
      backgroundType: 'SOLID_COLOR',
      backgroundColor: { r: 0, g: 0, b: 0, a: 0.5 }
    },
    transitionShouldSmartAnimate: true,
    keyTrigger: { keyCodes: [13], triggerDevice: 'KEYBOARD' },
    prototypeInteractions: [
      {
        id: prototypeInteractionGuid,
        event: { interactionType: 'ON_CLICK' },
        actions: [
          {
            transitionNodeID: targetGuid,
            transitionType: 'DISSOLVE',
            transitionDuration: 0.25,
            easingType: 'INOUT_CUBIC',
            connectionType: 'INTERNAL_NODE'
          }
        ]
      }
    ],
    voiceEventPhrase: 'play',
    prototypeStartingPoint: { name: 'Start', description: 'Demo', position: '0,0' },
    objectAnimations: [
      {
        id: interactionGuid,
        event: { interactionType: 'ON_CLICK' },
        actions: [
          {
            connectionType: 'OBJECT_ANIMATION',
            animationType: 'FADE',
            animationTargetId: targetGuid,
            animationPhase: 'OUT'
          }
        ]
      }
    ],
    isEmbeddedPrototype: true,
    embedData: {
      url: 'https://example.com/embed',
      title: 'Embedded media',
      width: 640,
      height: 360,
      embedType: 'video'
    },
    richMediaData: { mediaHash: 'media-hash', richMediaType: 'VIDEO' },
    videoPlayback: {
      autoplay: true,
      mediaLoop: true,
      muted: true,
      showControls: false,
      startTimeMs: 100,
      endTimeMs: 2_000
    },
    behaviors: {},
    styleAnimations: [{ animationPresetId: { guid: presetGuid } }],
    motionTransform: {
      translation: { x: 12, y: 24 },
      rotation: 0.5,
      scale: { x: 1.25, y: 0.75 },
      shearX: 0.125
    },
    timelinePosition: 125_000n,
    keyframeValue: {
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
    },
    keyframeValueRef: {
      value: {
        imageValue: {
          image: {
            hash: new Uint8Array([1, 2, 3, 4]),
            name: 'poster.png',
            dataBlob: 1
          },
          originalImageWidth: 640,
          originalImageHeight: 360,
          animationFrame: 0
        }
      },
      dataType: 'IMAGE',
      resolvedDataType: 'IMAGE'
    },
    interpolationType: 'BEZIER',
    bezierHandles: { p1x: 0.25, p1y: 0.125, p2x: 0.75, p2y: 0.875 },
    easingData: {
      easingType: 'CUSTOM_CUBIC',
      easingValue: {
        bezierEasing: { p1x: 0.25, p1y: 0.125, p2x: 0.75, p2y: 0.875 }
      }
    },
    keyframeOperation: 'OFFSET',
    timelinePositionType: 'RELATIVE',
    isClip: true,
    clipId: trackGuid,
    timelineDuration: 2_000_000n,
    timelineOffset: 250_000n,
    timelineDisabled: true,
    playbackStyle: 'BOOMERANG',
    timelineDefinitions: {
      entries: [
        {
          id: timelineGuid,
          data: { durationUs: 2_000_000n, defaultTimeline: true, playbackStyle: 'LOOP' }
        }
      ]
    },
    timelineAssignments: {
      entries: [
        {
          key: { assignedTimelineId: timelineGuid, containingTimelineId: containingTimelineGuid },
          value: { offsetUs: 250_000n, disabled: true }
        }
      ]
    },
    animationPresets: {
      presets: [{ animationPresetId: { guid: presetGuid }, timelineDefId: timelineGuid }]
    },
    styleIdsForAnimation: [
      {
        id: trackGuid,
        timelineDefId: timelineGuid,
        animationStyleId: { guid: animationStyleGuid },
        timelineOffset: 250_000n
      }
    ],
    backingAnimationPresetId: { guid: presetGuid },
    transitionOverrides: {
      all: [
        {
          id: trackGuid,
          duration: 0.5,
          delay: 0.25,
          easing: {
            easingType: 'CUSTOM_CUBIC',
            easingValue: {
              bezierEasing: { p1x: 0.25, p1y: 0.125, p2x: 0.75, p2y: 0.875 }
            }
          },
          createdAtMs: 1_024n,
          interactionIDs: [interactionGuid],
          disabled: true
        }
      ]
    },
    useLegacySmartAnimate: true
  }
}

function createImportedGraph(metadata: Record<string, unknown>) {
  const sourceBlobs = [new Uint8Array(expectedGlyphBlob), new Uint8Array(expectedImageBlob)]
  const graph = importNodeChanges(
    [
      {
        guid: documentGuid,
        phase: 'CREATED',
        type: 'DOCUMENT',
        name: 'Document',
        ...metadata
      } as NodeChange,
      {
        guid: canvasGuid,
        parentIndex: { guid: documentGuid, position: 'a' },
        phase: 'CREATED',
        type: 'CANVAS',
        name: 'Motion page',
        ...metadata
      } as NodeChange,
      {
        guid: targetGuid,
        parentIndex: { guid: canvasGuid, position: 'a' },
        phase: 'CREATED',
        type: 'RECTANGLE',
        name: 'Animation target',
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      } as NodeChange
    ],
    sourceBlobs
  )
  return { graph, sourceBlobs }
}

function customEmbeddedSchema(): Uint8Array {
  const schema = decodeBinarySchema(new ByteBuffer(getSchemaBytes()))
  const nodeChange = schema.definitions.find((definition) => definition.name === 'NodeChange')
  if (!nodeChange) throw new Error('Expected NodeChange in embedded schema')
  nodeChange.fields = nodeChange.fields.filter((field) => field.name !== 'specEmbedUrl')
  return deflateSync(encodeBinarySchema(schema))
}

function decode(bytes: Uint8Array) {
  return parseFigBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function byGuid(nodeChanges: NodeChange[], id: string): NodeChange | undefined {
  return nodeChanges.find((nodeChange) => nodeChange.guid && guidToString(nodeChange.guid) === id)
}

function expectBlobBackedFields(nodeChange: NodeChange, blobs: Uint8Array[]): void {
  const commandsBlob = (
    nodeChange.keyframeValue as {
      value?: { textDataValue?: { glyphs?: Array<{ commandsBlob?: number }> } }
    }
  ).value?.textDataValue?.glyphs?.[0]?.commandsBlob
  const dataBlob = (
    nodeChange.keyframeValueRef as {
      value?: { imageValue?: { image?: { dataBlob?: number } } }
    }
  ).value?.imageValue?.image?.dataBlob
  expect(typeof commandsBlob).toBe('number')
  expect(typeof dataBlob).toBe('number')
  expect(blobs[commandsBlob as number]).toEqual(expectedGlyphBlob)
  expect(blobs[dataBlob as number]).toEqual(expectedImageBlob)
}

function expectOpaqueFields(
  nodeChange: NodeChange | undefined,
  expected: Record<string, unknown>
): void {
  expect(nodeChange).toBeDefined()
  const actual = nodeChange as NodeChange & Record<string, unknown>
  for (const field of FIGMA_INTERACTION_MEDIA_MOTION_RAW_FIELD_KEYS) {
    if (field === 'keyframeValue' || field === 'keyframeValueRef') continue
    expect(actual[field]).toEqual(expected[field])
  }
}

describe('fig root motion metadata roundtrip', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('preserves DOCUMENT and CANVAS metadata with an embedded custom schema', async () => {
    const metadata = opaqueMetadata()
    const expected = Object.fromEntries(
      Object.entries(metadata).map(([field, value]) => [field, structuredClone(value)])
    )
    const { graph, sourceBlobs } = createImportedGraph(metadata)
    const root = graph.getNode(graph.rootId)
    const page = graph.getPages()[0]
    if (!root || !page) throw new Error('Expected imported document and canvas')

    graph.figSchemaDeflated = customEmbeddedSchema()

    ;(
      metadata.timelineDefinitions as {
        entries: Array<{ data: { durationUs: bigint } }>
      }
    ).entries[0].data.durationUs = 1n
    sourceBlobs[0][0] = 0
    sourceBlobs[1][0] = 0

    expect(root.source.fig.rawNodeFields.timelineDefinitions).toEqual(expected.timelineDefinitions)
    expect(page.source.fig.rawNodeFields.timelineDefinitions).toEqual(expected.timelineDefinitions)

    const g1Bytes = await exportFigFile(graph)
    const g1 = decode(g1Bytes)
    expect(g1.figSchemaDeflated).toEqual(graph.figSchemaDeflated)

    const g1Document = byGuid(g1.nodeChanges, '0:0')
    const g1Canvas = byGuid(g1.nodeChanges, '0:1')
    expect(byGuid(g1.nodeChanges, '7:105')?.name).toBe('Animation target')
    expectOpaqueFields(g1Document, expected)
    expectOpaqueFields(g1Canvas, expected)
    expectBlobBackedFields(g1Document as NodeChange, g1.blobs)
    expectBlobBackedFields(g1Canvas as NodeChange, g1.blobs)

    const g2Graph = await parseFigFile(
      g1Bytes.buffer.slice(g1Bytes.byteOffset, g1Bytes.byteOffset + g1Bytes.byteLength)
    )
    const g2 = decode(await exportFigFile(g2Graph))
    expect(g2.figSchemaDeflated).toEqual(g1.figSchemaDeflated)
    const g2Document = byGuid(g2.nodeChanges, '0:0')
    const g2Canvas = byGuid(g2.nodeChanges, '0:1')
    expect(byGuid(g2.nodeChanges, '7:105')?.name).toBe('Animation target')
    expectOpaqueFields(g2Document, g1Document as NodeChange & Record<string, unknown>)
    expectOpaqueFields(g2Canvas, g1Canvas as NodeChange & Record<string, unknown>)
    expectBlobBackedFields(g2Document as NodeChange, g2.blobs)
    expectBlobBackedFields(g2Canvas as NodeChange, g2.blobs)
  })

  test('preserves Message.objectAnimations through parse, G1, and G2 exports', async () => {
    const messageTargetGuid = { sessionID: 12, localID: 3 }
    const objectAnimations = {
      entries: [
        {
          targetNodeId: messageTargetGuid,
          animation: {
            connectionType: 'OBJECT_ANIMATION',
            animationType: 'FADE',
            animationTargetId: messageTargetGuid,
            animationPhase: 'OUT'
          }
        }
      ]
    }
    const message: FigmaMessage = {
      type: 'NODE_CHANGES',
      sessionID: 0,
      ackID: 0,
      nodeChanges: [
        {
          guid: documentGuid,
          phase: 'CREATED',
          type: 'DOCUMENT',
          name: 'Document'
        },
        {
          guid: canvasGuid,
          parentIndex: { guid: documentGuid, position: 'a' },
          phase: 'CREATED',
          type: 'CANVAS',
          name: 'Message animation page'
        },
        {
          guid: messageTargetGuid,
          parentIndex: { guid: canvasGuid, position: 'a' },
          phase: 'CREATED',
          type: 'RECTANGLE',
          name: 'Message animation target',
          size: { x: 100, y: 100 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
        }
      ],
      objectAnimations
    }
    const g0Bytes = writeFigArchive({
      schemaDeflated: deflateSync(getSchemaBytes()),
      kiwiData: encodeMessage(message),
      thumbnailPng: new Uint8Array([1]),
      metaJson: '{}'
    })

    const g0Decoded = decode(g0Bytes)
    expect(g0Decoded.objectAnimations).toEqual(objectAnimations)

    const g1Graph = await parseFigFile(exactBuffer(g0Bytes))
    expect(g1Graph.figMessageObjectAnimations).toEqual(objectAnimations)
    const g1 = decode(await exportFigFile(g1Graph))
    expect(g1.objectAnimations).toEqual(objectAnimations)

    const g2Graph = await parseFigFile(exactBuffer(await exportFigFile(g1Graph)))
    expect(g2Graph.figMessageObjectAnimations).toEqual(objectAnimations)
    const g2 = decode(await exportFigFile(g2Graph))
    expect(g2.objectAnimations).toEqual(objectAnimations)
  })

  test('raw metadata cannot replace DOCUMENT or CANVAS structural fields', async () => {
    const { graph } = createImportedGraph(opaqueMetadata())
    const root = graph.getNode(graph.rootId)
    const page = graph.getPages()[0]
    if (!root || !page) throw new Error('Expected imported document and canvas')

    const unsafe = {
      guid: { sessionID: 99, localID: 99 },
      parentIndex: { guid: { sessionID: 99, localID: 98 }, position: 'unsafe' },
      phase: 'REMOVED',
      type: 'RECTANGLE',
      name: 'Unsafe raw name'
    }
    Object.assign(root.source.fig.rawNodeFields, unsafe)
    Object.assign(page.source.fig.rawNodeFields, unsafe)

    const decoded = decode(await exportFigFile(graph))
    const document = byGuid(decoded.nodeChanges, '0:0')
    const canvas = byGuid(decoded.nodeChanges, '0:1')

    expect(document?.type).toBe('DOCUMENT')
    expect(document?.name).toBe('Document')
    expect(document?.phase).toBe('CREATED')
    expect(document?.parentIndex).toBeUndefined()
    expect(canvas?.type).toBe('CANVAS')
    expect(canvas?.name).toBe('Motion page')
    expect(canvas?.phase).toBe('CREATED')
    expect(canvas?.parentIndex?.guid).toEqual(documentGuid)
  })
})
