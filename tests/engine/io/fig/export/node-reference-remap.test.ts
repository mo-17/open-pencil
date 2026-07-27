import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, SceneGraph } from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/fig'
import { guidToString, nodeChangeToProps } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

type RawNodeChange = NodeChange & Record<string, unknown>
type RawRecord = Record<string, unknown>

const guid = (sessionID: number, localID: number): GUID => ({ sessionID, localID })

function setFigSource(
  node: SceneNode,
  sourceId: string,
  rawNodeFields: Record<string, unknown> = {}
): void {
  node.source = {
    ...node.source,
    format: 'fig',
    id: sourceId,
    fig: {
      ...node.source.fig,
      rawNodeFields: structuredClone(rawNodeFields)
    }
  }
}

function decodeExport(bytes: Uint8Array): RawNodeChange[] {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return parseFigBuffer(buffer).nodeChanges as RawNodeChange[]
}

function findByName(nodeChanges: RawNodeChange[], name: string): RawNodeChange {
  const nodeChange = nodeChanges.find((candidate) => candidate.name === name)
  if (!nodeChange) throw new Error(`Expected exported NodeChange named ${name}`)
  return nodeChange
}

function expectGuid(value: unknown, expected: GUID): void {
  expect(value).toEqual(expected)
}

function firstAction(nodeChange: RawNodeChange, field: string): RawRecord {
  const interactions = nodeChange[field] as Array<{ actions?: RawRecord[] }> | undefined
  const action = interactions?.[0]?.actions?.[0]
  if (!action) throw new Error(`Expected ${field} to contain an action`)
  return action
}

describe('FIG export node-reference remapping', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('remaps prototype, object-animation, and behavior targets from A to B', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    setFigSource(page, '21:1')

    const target = graph.createNode('RECTANGLE', page.id, {
      name: 'Target B',
      width: 100,
      height: 100
    })
    setFigSource(target, '21:3')

    const owner = graph.createNode('RECTANGLE', page.id, {
      name: 'Owner A',
      width: 100,
      height: 100
    })
    setFigSource(owner, '21:2', {
      transitionNodeID: guid(21, 3),
      prototypeStartNodeID: guid(21, 3),
      prototypeInteractions: [
        {
          id: guid(21, 10),
          event: { interactionType: 'ON_CLICK' },
          actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: guid(21, 3) }]
        }
      ],
      objectAnimations: [
        {
          id: guid(21, 11),
          event: { interactionType: 'ON_CLICK' },
          actions: [
            {
              connectionType: 'OBJECT_ANIMATION',
              animationType: 'FADE',
              animationTargetId: guid(21, 3),
              animationPhase: 'OUT'
            }
          ]
        }
      ],
      behaviors: {
        link: { type: 'PAGE', page: guid(21, 1) },
        appear: { trigger: 'OTHER_LAYER_IN_VIEW', otherLayer: guid(21, 3) },
        scrollTransform: { trigger: 'OTHER_LAYER_IN_VIEW', otherLayer: guid(21, 3) },
        cursor: { cursorGuid: guid(21, 3), hotspotX: 0, hotspotY: 0 }
      }
    })

    const nodeChanges = decodeExport(await exportFigFile(graph))
    const exportedOwner = findByName(nodeChanges, 'Owner A')
    const exportedTarget = findByName(nodeChanges, 'Target B')
    const exportedPage = findByName(nodeChanges, page.name)
    if (!exportedTarget.guid || !exportedPage.guid) throw new Error('Expected exported GUIDs')

    expectGuid(exportedOwner.transitionNodeID, exportedTarget.guid)
    expectGuid(exportedOwner.prototypeStartNodeID, exportedTarget.guid)
    expectGuid(
      firstAction(exportedOwner, 'prototypeInteractions').transitionNodeID,
      exportedTarget.guid
    )
    expectGuid(
      firstAction(exportedOwner, 'objectAnimations').animationTargetId,
      exportedTarget.guid
    )

    const behaviors = exportedOwner.behaviors as {
      link?: { page?: GUID }
      appear?: { otherLayer?: GUID }
      scrollTransform?: { otherLayer?: GUID }
      cursor?: { cursorGuid?: GUID }
    }
    expectGuid(behaviors.link?.page, exportedPage.guid)
    expectGuid(behaviors.appear?.otherLayer, exportedTarget.guid)
    expectGuid(behaviors.scrollTransform?.otherLayer, exportedTarget.guid)
    expectGuid(behaviors.cursor?.cursorGuid, exportedTarget.guid)
  })

  test('remaps Message.objectAnimations targets when an imported GUID is reassigned', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    setFigSource(page, '22:1')

    const target = graph.createNode('RECTANGLE', page.id, {
      name: 'Message-level target',
      width: 100,
      height: 100
    })
    // 0:0 is reserved for DOCUMENT, so this node must receive a fresh export GUID.
    setFigSource(target, '0:0')
    graph.figMessageObjectAnimations = {
      entries: [
        {
          targetNodeId: guid(0, 0),
          animation: {
            connectionType: 'OBJECT_ANIMATION',
            animationType: 'FADE',
            animationTargetId: guid(0, 0),
            animationPhase: 'OUT'
          }
        }
      ]
    }

    const bytes = await exportFigFile(graph)
    const parsed = parseFigBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    )
    const exportedTarget = findByName(parsed.nodeChanges as RawNodeChange[], target.name)
    if (!exportedTarget.guid) throw new Error('Expected the target to receive an export GUID')
    expect(guidToString(exportedTarget.guid)).not.toBe('0:0')

    const entry = (
      parsed.objectAnimations as {
        entries?: Array<{ targetNodeId?: GUID; animation?: { animationTargetId?: GUID } }>
      }
    ).entries?.[0]
    expectGuid(entry?.targetNodeId, exportedTarget.guid)
    expectGuid(entry?.animation?.animationTargetId, exportedTarget.guid)
  })

  test('uses the owner Canvas to disambiguate duplicate source GUIDs', async () => {
    const graph = new SceneGraph()
    const firstPage = graph.getPages()[0]
    firstPage.name = 'First page'
    setFigSource(firstPage, '31:1')
    const secondPage = graph.addPage('Second page')
    setFigSource(secondPage, '31:2')

    const firstTarget = graph.createNode('RECTANGLE', firstPage.id, {
      name: 'First duplicate target',
      width: 50,
      height: 50
    })
    setFigSource(firstTarget, '31:99')
    const secondTarget = graph.createNode('RECTANGLE', secondPage.id, {
      name: 'Second duplicate target',
      width: 50,
      height: 50
    })
    setFigSource(secondTarget, '31:99')

    const owner = graph.createNode('RECTANGLE', secondPage.id, {
      name: 'Second page owner',
      width: 50,
      height: 50
    })
    setFigSource(owner, '31:3', {
      prototypeInteractions: [
        {
          id: guid(31, 10),
          event: { interactionType: 'ON_CLICK' },
          actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: guid(31, 99) }]
        }
      ],
      behaviors: {
        appear: { trigger: 'OTHER_LAYER_IN_VIEW', otherLayer: guid(31, 99) }
      }
    })

    const nodeChanges = decodeExport(await exportFigFile(graph))
    const exportedOwner = findByName(nodeChanges, 'Second page owner')
    const exportedFirstTarget = findByName(nodeChanges, 'First duplicate target')
    const exportedSecondTarget = findByName(nodeChanges, 'Second duplicate target')
    if (!exportedFirstTarget.guid || !exportedSecondTarget.guid) {
      throw new Error('Expected duplicate targets to receive exported GUIDs')
    }

    expect(guidToString(exportedFirstTarget.guid)).not.toBe(guidToString(exportedSecondTarget.guid))
    expectGuid(
      firstAction(exportedOwner, 'prototypeInteractions').transitionNodeID,
      exportedSecondTarget.guid
    )
    expectGuid(
      (exportedOwner.behaviors as { appear?: { otherLayer?: GUID } }).appear?.otherLayer,
      exportedSecondTarget.guid
    )
  })

  test('filters references and target-dependent branches after deleting a target', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    setFigSource(page, '41:1')
    const missingGuid = guid(41, 3)

    const target = graph.createNode('RECTANGLE', page.id, {
      name: 'Deleted target',
      width: 50,
      height: 50
    })
    setFigSource(target, guidToString(missingGuid))

    const owner = graph.createNode('RECTANGLE', page.id, {
      name: 'Surviving owner',
      width: 50,
      height: 50
    })
    setFigSource(owner, '41:2', {
      transitionNodeID: missingGuid,
      prototypeStartNodeID: missingGuid,
      prototypeInteractions: [
        {
          id: guid(41, 10),
          event: { interactionType: 'ON_CLICK' },
          actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: missingGuid }]
        }
      ],
      objectAnimations: [
        {
          id: guid(41, 11),
          event: { interactionType: 'ON_CLICK' },
          actions: [
            {
              connectionType: 'OBJECT_ANIMATION',
              animationType: 'FADE',
              animationTargetId: missingGuid,
              animationPhase: 'OUT'
            }
          ]
        }
      ],
      behaviors: {
        appear: { trigger: 'OTHER_LAYER_IN_VIEW', otherLayer: missingGuid },
        cursor: { cursorGuid: missingGuid, hotspotX: 0, hotspotY: 0 },
        marquee: { direction: 'LEFT', speed: 20, shouldLoopInfinitely: true }
      }
    })
    graph.deleteNode(target.id)

    const exportedOwner = findByName(decodeExport(await exportFigFile(graph)), 'Surviving owner')
    expect(exportedOwner.transitionNodeID).toBeUndefined()
    expect(exportedOwner.prototypeStartNodeID).toBeUndefined()
    expect(exportedOwner.prototypeInteractions).toBeUndefined()
    expect(exportedOwner.objectAnimations).toBeUndefined()
    expect(exportedOwner.behaviors).toEqual({
      marquee: { direction: 'LEFT', speed: 20, shouldLoopInfinitely: true }
    })
  })

  test('leaves opaque timeline, preset, track, style, and interaction GUIDs unchanged', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    setFigSource(page, '51:1')

    const timelineGuid = guid(91, 100)
    const containingTimelineGuid = guid(91, 101)
    const presetGuid = guid(91, 102)
    const trackGuid = guid(91, 103)
    const styleGuid = guid(91, 104)
    const interactionGuid = guid(91, 105)
    const opaqueFields = {
      clipId: trackGuid,
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
          animationStyleId: { guid: styleGuid },
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
      }
    }

    const owner = graph.createNode('RECTANGLE', page.id, {
      name: 'Opaque timeline owner',
      width: 50,
      height: 50
    })
    const imported = nodeChangeToProps(
      {
        guid: guid(51, 2),
        phase: 'CREATED',
        type: 'RECTANGLE',
        name: owner.name,
        ...opaqueFields
      } as NodeChange,
      []
    )
    if (!imported.source) throw new Error('Expected imported Figma source metadata')
    owner.source = imported.source

    const exportedOwner = findByName(
      decodeExport(await exportFigFile(graph)),
      'Opaque timeline owner'
    )
    for (const [field, value] of Object.entries(opaqueFields)) {
      expect(exportedOwner[field]).toEqual(value)
    }
  })
})
