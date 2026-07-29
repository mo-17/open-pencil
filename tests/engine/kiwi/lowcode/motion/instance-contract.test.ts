import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import type {
  MotionDriverSpecV1,
  MotionSceneSpec,
  MotionSpec,
  PrototypeSpecV1,
  SceneNode
} from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function scene(targetNodeId: string): MotionSceneSpec {
  return {
    version: 1,
    id: 'instance-scene',
    sequences: [
      {
        id: 'intro',
        trigger: 'manual',
        cues: [{ id: 'target', targetNodeId, trackId: 'entrance', startMs: 0 }]
      }
    ]
  }
}

function drivers(sourceNodeId: string, targetNodeId: string): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id: 'instance-scroll',
        source: { kind: 'scroll', sourceNodeId, axis: 'y', metric: 'progress' },
        target: { targetNodeId, trackId: 'entrance' },
        mapping: { inputMin: 0, inputMax: 1 }
      }
    ]
  }
}

function prototype(targetNodeId: string): PrototypeSpecV1 {
  return {
    version: 1,
    connections: [
      {
        id: 'instance-navigate',
        trigger: { kind: 'click' },
        action: { kind: 'navigate', targetNodeId },
        transition: { kind: 'instant' }
      }
    ]
  }
}

function motion(distance: number): MotionSpec {
  return {
    version: 3,
    tracks: [
      {
        id: 'entrance',
        name: 'Entrance',
        trigger: 'mount',
        keyframes: [
          { id: 'start', offset: 0, x: 0 },
          { id: 'end', offset: 1, x: distance }
        ],
        timing: { duration: 300, easing: 'ease-out' },
        composition: { mode: 'replace', weight: 1, priority: 0 }
      }
    ]
  }
}

function named(graph: SceneGraph, name: string): SceneNode {
  return expectDefined(
    [...graph.getAllNodes()].find((node) => node.name === name),
    `node ${name}`
  )
}

function namedChild(graph: SceneGraph, parent: SceneNode, name: string): SceneNode {
  return expectDefined(
    graph.getChildren(parent.id).find((node) => node.name === name),
    `child ${name}`
  )
}

describe('Figma instance Motion contract overrides', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('round-trips reference-bearing root overrides and descendant null tombstones', async () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'Motion contract master'
    })
    const source = graph.createNode('FRAME', component.id, { name: 'Contract source' })
    const target = graph.createNode('RECTANGLE', component.id, { name: 'Contract target' })
    const destination = graph.createNode('FRAME', component.id, { name: 'Contract destination' })
    graph.updateNode(component.id, {
      motion: motion(24),
      motionScene: scene(target.id),
      motionDrivers: drivers(source.id, target.id),
      prototype: prototype(destination.id),
      transitionKey: 'masterRoot',
      generatedEffect: generatedEffect('noise')
    })
    graph.updateNode(source.id, {
      motion: motion(12),
      motionScene: scene(target.id),
      motionDrivers: drivers(source.id, target.id),
      prototype: prototype(destination.id),
      transitionKey: 'masterChild',
      generatedEffect: generatedEffect('shimmer')
    })

    const inherited = expectDefined(graph.createInstance(component.id, page.id), 'plain instance')
    graph.updateNode(inherited.id, { name: 'Inherited Motion contract instance' })

    const custom = expectDefined(graph.createInstance(component.id, page.id), 'custom instance')
    graph.updateNode(custom.id, { name: 'Custom Motion contract instance' })
    const customSource = namedChild(graph, custom, source.name)
    const customTarget = namedChild(graph, custom, target.name)
    const customDestination = namedChild(graph, custom, destination.name)
    const customScene = scene(customTarget.id)
    const customDrivers = drivers(customSource.id, customTarget.id)
    const customPrototype = prototype(customDestination.id)
    graph.updateNode(custom.id, {
      motionScene: customScene,
      motionDrivers: customDrivers,
      prototype: customPrototype,
      transitionKey: 'customRoot',
      overrides: {
        motionScene: structuredClone(customScene),
        motionDrivers: structuredClone(customDrivers),
        prototype: structuredClone(customPrototype),
        transitionKey: 'customRoot'
      }
    })

    const cleared = expectDefined(graph.createInstance(component.id, page.id), 'cleared instance')
    const clearedSource = namedChild(graph, cleared, source.name)
    graph.updateNode(cleared.id, {
      name: 'Cleared Motion contract instance',
      overrides: {
        motionScene: null,
        motionDrivers: null,
        prototype: null,
        transitionKey: null,
        [`${clearedSource.id}:motionScene`]: null,
        [`${clearedSource.id}:motionDrivers`]: null,
        [`${clearedSource.id}:prototype`]: null,
        [`${clearedSource.id}:transitionKey`]: null
      }
    })
    graph.clearNodeFields(cleared.id, [
      'motionScene',
      'motionDrivers',
      'prototype',
      'transitionKey'
    ])
    graph.clearNodeFields(clearedSource.id, [
      'motionScene',
      'motionDrivers',
      'prototype',
      'transitionKey'
    ])

    const reopened = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const reopenedComponent = named(reopened, component.name)
    const reopenedInherited = named(reopened, inherited.name)
    const reopenedCustom = named(reopened, custom.name)
    const reopenedCustomSource = namedChild(reopened, reopenedCustom, source.name)
    const reopenedCustomTarget = namedChild(reopened, reopenedCustom, target.name)
    const reopenedCustomDestination = namedChild(reopened, reopenedCustom, destination.name)
    const reopenedCleared = named(reopened, cleared.name)
    const reopenedClearedSource = namedChild(reopened, reopenedCleared, source.name)

    expect(
      reopened
        .getInstances(reopenedComponent.id)
        .map(({ id }) => id)
        .sort()
    ).toEqual([reopenedInherited.id, reopenedCustom.id, reopenedCleared.id].sort())

    expect(reopenedCustom.motionScene).toEqual(scene(reopenedCustomTarget.id))
    expect(reopenedCustom.motionDrivers).toEqual(
      drivers(reopenedCustomSource.id, reopenedCustomTarget.id)
    )
    expect(reopenedCustom.prototype).toEqual(prototype(reopenedCustomDestination.id))
    expect(reopenedCustom.transitionKey).toBe('customRoot')
    expect(reopenedCustom.overrides.motionScene).toEqual(scene(reopenedCustomTarget.id))
    expect(reopenedCustom.overrides.motionDrivers).toEqual(
      drivers(reopenedCustomSource.id, reopenedCustomTarget.id)
    )
    expect(reopenedCustom.overrides.prototype).toEqual(prototype(reopenedCustomDestination.id))
    expect(reopenedCustom.overrides.transitionKey).toBe('customRoot')
    expect(reopenedCustom.source.editedFields).toEqual([])

    for (const field of ['motionScene', 'motionDrivers', 'prototype', 'transitionKey'] as const) {
      expect(reopenedCleared[field]).toBeUndefined()
      expect(reopenedCleared.overrides[field]).toBeNull()
      expect(reopenedClearedSource[field]).toBeUndefined()
      expect(reopenedCleared.overrides[`${reopenedClearedSource.id}:${field}`]).toBeNull()
    }
    expect(reopenedCleared.source.editedFields).toEqual([])

    const reopenedComponentSource = namedChild(reopened, reopenedComponent, source.name)
    const reopenedComponentTarget = namedChild(reopened, reopenedComponent, target.name)
    const reopenedComponentDestination = namedChild(reopened, reopenedComponent, destination.name)
    reopened.updateNode(reopenedComponent.id, {
      motion: motion(96),
      motionScene: scene(reopenedComponentTarget.id),
      motionDrivers: drivers(reopenedComponentSource.id, reopenedComponentTarget.id),
      transitionKey: 'masterUpdated',
      prototype: prototype(reopenedComponentDestination.id),
      generatedEffect: generatedEffect('particles')
    })
    reopened.updateNode(reopenedComponentSource.id, {
      motion: motion(48),
      motionScene: scene(reopenedComponentTarget.id),
      motionDrivers: drivers(reopenedComponentSource.id, reopenedComponentTarget.id),
      prototype: prototype(reopenedComponentDestination.id),
      transitionKey: 'masterChildUpdated',
      generatedEffect: generatedEffect('scanlines')
    })
    reopened.syncInstances(reopenedComponent.id)

    const reopenedInheritedSource = namedChild(reopened, reopenedInherited, source.name)
    const reopenedInheritedTarget = namedChild(reopened, reopenedInherited, target.name)
    const reopenedInheritedDestination = namedChild(reopened, reopenedInherited, destination.name)
    expect(reopenedInherited.motion).toEqual(motion(96))
    expect(reopenedInherited.motionScene).toEqual(scene(reopenedInheritedTarget.id))
    expect(reopenedInherited.motionDrivers).toEqual(
      drivers(reopenedInheritedSource.id, reopenedInheritedTarget.id)
    )
    expect(reopenedInherited.prototype).toEqual(prototype(reopenedInheritedDestination.id))
    expect(reopenedInherited.transitionKey).toBe('masterUpdated')
    expect(reopenedInherited.generatedEffect).toEqual(generatedEffect('particles'))
    expect(reopenedInheritedSource.motion).toEqual(motion(48))
    expect(reopenedInheritedSource.motionScene).toEqual(scene(reopenedInheritedTarget.id))
    expect(reopenedInheritedSource.motionDrivers).toEqual(
      drivers(reopenedInheritedSource.id, reopenedInheritedTarget.id)
    )
    expect(reopenedInheritedSource.prototype).toEqual(prototype(reopenedInheritedDestination.id))
    expect(reopenedInheritedSource.transitionKey).toBe('masterChildUpdated')
    expect(reopenedInheritedSource.generatedEffect).toEqual(generatedEffect('scanlines'))

    expect(reopenedCustom.transitionKey).toBe('customRoot')
    expect(reopenedCleared.transitionKey).toBeUndefined()
    expect(reopenedCleared.prototype).toBeUndefined()
    for (const field of ['motionScene', 'motionDrivers', 'prototype', 'transitionKey'] as const) {
      expect(reopenedClearedSource[field]).toBeUndefined()
    }
  })
})
