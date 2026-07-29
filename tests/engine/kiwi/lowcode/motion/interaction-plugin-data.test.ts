import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type {
  MotionDriverSpecV1,
  PluginDataEntry,
  PrototypeSpecV1,
  SceneNode
} from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  LOWCODE_MOTION_DRIVERS_KEY,
  LOWCODE_PROTOTYPE_KEY,
  LOWCODE_TRANSITION_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

function drivers(targetNodeId = '0:10'): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id: 'scrollHero',
        source: { kind: 'scroll', axis: 'y', metric: 'progress' },
        target: { targetNodeId, trackId: 'entrance' },
        mapping: { inputMin: 0, inputMax: 1, clamp: true, deadZone: 0.05 }
      }
    ]
  }
}

function prototype(targetNodeId = '0:20'): PrototypeSpecV1 {
  return {
    version: 1,
    connections: [
      {
        id: 'openDetails',
        trigger: { kind: 'click' },
        action: { kind: 'navigate', targetNodeId },
        transition: {
          kind: 'smartMatch',
          durationMs: 360,
          easing: 'ease-in-out',
          fallback: 'dissolve'
        },
        interruption: 'replace'
      }
    ]
  }
}

function node(fields: Partial<SceneNode>): SceneNode {
  return { type: 'FRAME', pluginData: [] as PluginDataEntry[], ...fields } as SceneNode
}

function entry(key: string, value: string) {
  return { pluginID: OPEN_PENCIL_PLUGIN_ID, key, value }
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function named(graph: SceneGraph, name: string): SceneNode {
  const result = [...graph.getAllNodes()].find((candidate) => candidate.name === name)
  if (!result) throw new Error(`Expected node named ${name}`)
  return result
}

describe('Motion interaction pluginData persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('serializes and strictly extracts drivers, prototype connections, and transition keys', () => {
    const motionDrivers = drivers()
    const prototypeSpec = prototype()
    const entries = serializeLowcodeFields(
      node({ motionDrivers, prototype: prototypeSpec, transitionKey: 'sharedHero' })
    )
    expect(entries).toEqual([
      {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_MOTION_DRIVERS_KEY,
        value: JSON.stringify(motionDrivers)
      },
      {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_PROTOTYPE_KEY,
        value: JSON.stringify(prototypeSpec)
      },
      {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_TRANSITION_KEY,
        value: JSON.stringify('sharedHero')
      }
    ])

    const extracted = extractLowcodeAndPluginData({
      pluginData: entries.map(({ key, value }) => entry(key, value))
    } as Pick<NodeChange, 'pluginData'>)
    expect(extracted).toMatchObject({
      motionDrivers,
      prototype: prototypeSpec,
      transitionKey: 'sharedHero',
      pluginData: []
    })
    expect(extracted.motionDrivers).not.toBe(motionDrivers)
    expect(extracted.prototype).not.toBe(prototypeSpec)
  })

  test('preserves malformed and future contracts inertly without cross-disabling valid fields', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const malformedDrivers = entry(LOWCODE_MOTION_DRIVERS_KEY, '{bad json')
      const futurePrototype = entry(
        LOWCODE_PROTOTYPE_KEY,
        JSON.stringify({ version: 2, connections: [] })
      )
      const invalidKey = entry(LOWCODE_TRANSITION_KEY, JSON.stringify('__proto__'))
      const validPrototype = prototype()
      const extracted = extractLowcodeAndPluginData({
        pluginData: [
          malformedDrivers,
          futurePrototype,
          invalidKey,
          entry(LOWCODE_PROTOTYPE_KEY, JSON.stringify(validPrototype))
        ]
      } as Pick<NodeChange, 'pluginData'>)

      expect(extracted.motionDrivers).toBeUndefined()
      expect(extracted.prototype).toEqual(validPrototype)
      expect(extracted.transitionKey).toBeUndefined()
      expect(extracted.pluginData).toEqual(
        [malformedDrivers, futurePrototype, invalidKey].map(({ pluginID, ...rest }) => ({
          pluginId: pluginID,
          ...rest
        }))
      )
    } finally {
      warn.mockRestore()
    }
  })

  test('preserves all interaction contracts through G0 to G1 to G2', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const destination = graph.createNode('FRAME', page.id, { name: 'Destination' })
    const owner = graph.createNode('FRAME', page.id, { name: 'Interaction owner' })
    const target = graph.createNode('RECTANGLE', owner.id, {
      name: 'Driven target',
      motion: {
        version: 1,
        tracks: [
          {
            id: 'entrance',
            trigger: 'mount',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 400 }
          }
        ]
      },
      transitionKey: 'sharedHero'
    })
    graph.updateNode(owner.id, { motionDrivers: drivers(target.id) })
    const source = graph.createNode('BUTTON', owner.id, {
      name: 'Prototype source',
      prototype: prototype(destination.id)
    })

    const g1 = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const g1Owner = named(g1, owner.name)
    const g1Target = named(g1, target.name)
    const g1Destination = named(g1, destination.name)
    expect(g1Owner.motionDrivers).toEqual(drivers(g1Target.id))
    expect(g1Target.transitionKey).toBe('sharedHero')
    expect(named(g1, source.name).prototype).toEqual(prototype(g1Destination.id))
    expect(g1Owner.source.editedFields).toEqual([])

    const g2 = await parseFigFile(exactBuffer(await exportFigFile(g1)))
    const g2Owner = named(g2, owner.name)
    const g2Target = named(g2, target.name)
    const g2Destination = named(g2, destination.name)
    expect(g2Owner.motionDrivers).toEqual(drivers(g2Target.id))
    expect(g2Target.transitionKey).toBe('sharedHero')
    expect(named(g2, source.name).prototype).toEqual(prototype(g2Destination.id))
    expect(g2Owner.source.editedFields).toEqual([])
  })

  test('raw future data wins deterministically over a conflicting structured value', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const future: PluginDataEntry = {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_MOTION_DRIVERS_KEY,
        value: JSON.stringify({ version: 2, drivers: [] })
      }
      const serialized = serializeLowcodeFields(
        node({ motionDrivers: drivers(), pluginData: [future] })
      )
      expect(serialized).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        '[lowcode] structured motion drivers conflicts with inert private data; preserving the raw payload and suppressing the structured value'
      )
    } finally {
      warn.mockRestore()
    }
  })
})
