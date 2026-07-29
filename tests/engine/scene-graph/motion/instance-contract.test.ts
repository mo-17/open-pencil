import { describe, expect, test } from 'bun:test'

import {
  createMotionPreset,
  SceneGraph,
  type MotionDriverSpecV1,
  type MotionSceneSpec,
  type PrototypeSpecV1,
  type SceneNode
} from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

const EXTERNAL_SCENE_TARGET = '99:91'
const EXTERNAL_DRIVER_SOURCE = '99:92'
const EXTERNAL_PROTOTYPE_TARGET = '99:93'

function scene(targetNodeId: string): MotionSceneSpec {
  return {
    version: 1,
    id: 'component-scene',
    sequences: [
      {
        id: 'intro',
        trigger: 'manual',
        cues: [
          { id: 'inside', targetNodeId, trackId: 'entrance', startMs: 0 },
          {
            id: 'outside',
            targetNodeId: EXTERNAL_SCENE_TARGET,
            trackId: 'external',
            startMs: 80
          }
        ]
      }
    ]
  }
}

function drivers(sourceNodeId: string, targetNodeId: string, ownerId: string): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id: 'internal-scroll',
        source: { kind: 'scroll', sourceNodeId, axis: 'y', metric: 'progress' },
        target: { targetNodeId, trackId: 'entrance' },
        mapping: { inputMin: 0, inputMax: 1 }
      },
      {
        id: 'external-pointer',
        source: {
          kind: 'pointer',
          sourceNodeId: EXTERNAL_DRIVER_SOURCE,
          axis: 'x',
          space: 'viewport'
        },
        target: { targetNodeId: ownerId, trackId: 'owner-track' },
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
        id: 'inside',
        trigger: { kind: 'click' },
        action: { kind: 'navigate', targetNodeId },
        transition: { kind: 'instant' }
      },
      {
        id: 'outside',
        trigger: { kind: 'afterDelay', delayMs: 10 },
        action: {
          kind: 'openOverlay',
          targetNodeId: EXTERNAL_PROTOTYPE_TARGET,
          placement: 'center'
        },
        transition: { kind: 'instant' }
      }
    ]
  }
}

interface ComponentFixture {
  graph: SceneGraph
  page: SceneNode
  component: SceneNode
  source: SceneNode
  target: SceneNode
  destination: SceneNode
}

function componentFixture(): ComponentFixture {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'default page')
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'Motion component',
    transitionKey: 'componentRoot'
  })
  const source = graph.createNode('FRAME', component.id, { name: 'Source' })
  const target = graph.createNode('RECTANGLE', component.id, {
    name: 'Target',
    motion: createMotionPreset('fade-in'),
    transitionKey: 'componentTarget'
  })
  const destination = graph.createNode('FRAME', component.id, { name: 'Destination' })
  graph.updateNode(component.id, {
    motionScene: scene(target.id),
    motionDrivers: drivers(source.id, target.id, component.id),
    prototype: prototype(destination.id)
  })
  graph.updateNode(source.id, {
    prototype: prototype(destination.id),
    transitionKey: 'componentSource'
  })
  return { graph, page, component, source, target, destination }
}

function child(node: SceneNode, graph: SceneGraph, name: string): SceneNode {
  return expectDefined(
    graph.getChildren(node.id).find((candidate) => candidate.name === name),
    `${name} child`
  )
}

describe('component Motion owner and interaction metadata contract', () => {
  // eslint-disable-next-line complexity -- One fixture verifies the complete inherited contract.
  test('deep-copies clean component metadata and remaps instance-local references', () => {
    const { graph, page, component, destination } = componentFixture()
    const instance = expectDefined(graph.createInstance(component.id, page.id), 'instance')
    const instanceSource = child(instance, graph, 'Source')
    const instanceTarget = child(instance, graph, 'Target')
    const instanceDestination = child(instance, graph, 'Destination')

    expect(instance.motionScene?.id).toBe(component.motionScene?.id)
    expect(instance.motionScene).not.toBe(component.motionScene)
    expect(instance.motionScene?.sequences[0]?.cues.map((cue) => cue.targetNodeId)).toEqual([
      instanceTarget.id,
      EXTERNAL_SCENE_TARGET
    ])
    expect(instance.motionDrivers).not.toBe(component.motionDrivers)
    expect(instance.motionDrivers?.drivers[0]?.source).toMatchObject({
      sourceNodeId: instanceSource.id
    })
    expect(instance.motionDrivers?.drivers[0]?.target.targetNodeId).toBe(instanceTarget.id)
    expect(instance.motionDrivers?.drivers[1]?.source).toMatchObject({
      sourceNodeId: EXTERNAL_DRIVER_SOURCE
    })
    expect(instance.motionDrivers?.drivers[1]?.target.targetNodeId).toBe(instance.id)
    expect(instance.prototype?.connections[0]?.action).toEqual({
      kind: 'navigate',
      targetNodeId: instanceDestination.id
    })
    expect(instance.prototype?.connections[1]?.action).toMatchObject({
      targetNodeId: EXTERNAL_PROTOTYPE_TARGET
    })
    expect(instance.transitionKey).toBe('componentRoot')
    expect(instanceSource.prototype?.connections[0]?.action).toEqual({
      kind: 'navigate',
      targetNodeId: instanceDestination.id
    })
    expect(instanceSource.transitionKey).toBe('componentSource')
    expect(instanceTarget.transitionKey).toBe('componentTarget')

    const updatedPrototype = prototype(destination.id)
    const updatedConnection = expectDefined(updatedPrototype.connections[0], 'updated connection')
    updatedConnection.transition = {
      kind: 'dissolve',
      durationMs: 180,
      easing: 'ease-out'
    }
    graph.updateNode(component.id, {
      transitionKey: 'componentRootNext',
      prototype: updatedPrototype
    })
    graph.syncInstances(component.id)
    expect(instance.transitionKey).toBe('componentRootNext')
    expect(instance.prototype?.connections[0]?.transition).toEqual({
      kind: 'dissolve',
      durationMs: 180,
      easing: 'ease-out'
    })

    graph.clearNodeFields(component.id, [
      'motionScene',
      'motionDrivers',
      'prototype',
      'transitionKey'
    ])
    graph.syncInstances(component.id)
    for (const field of ['motionScene', 'motionDrivers', 'prototype', 'transitionKey'] as const) {
      expect(instance[field]).toBeUndefined()
      expect(Object.hasOwn(instance, field)).toBe(false)
    }
  })

  test('honors root and descendant null tombstones across component updates', () => {
    const { graph, page, component, source, target, destination } = componentFixture()
    const instance = expectDefined(graph.createInstance(component.id, page.id), 'instance')
    const instanceSource = child(instance, graph, 'Source')
    const instanceTarget = child(instance, graph, 'Target')

    graph.updateNode(instance.id, {
      overrides: {
        ...instance.overrides,
        motionScene: null,
        motionDrivers: null,
        prototype: null,
        transitionKey: null,
        [`${instanceSource.id}:prototype`]: null,
        [`${instanceSource.id}:transitionKey`]: null
      }
    })
    graph.clearNodeFields(instance.id, [
      'motionScene',
      'motionDrivers',
      'prototype',
      'transitionKey'
    ])
    graph.clearNodeFields(instanceSource.id, ['prototype', 'transitionKey'])

    graph.updateNode(component.id, {
      motionScene: scene(target.id),
      motionDrivers: drivers(source.id, target.id, component.id),
      prototype: prototype(destination.id),
      transitionKey: 'componentRootUpdated'
    })
    graph.updateNode(source.id, {
      prototype: prototype(destination.id),
      transitionKey: 'componentSourceUpdated'
    })
    graph.syncInstances(component.id)

    for (const field of ['motionScene', 'motionDrivers', 'prototype', 'transitionKey'] as const) {
      expect(instance[field]).toBeUndefined()
      expect(instance.overrides[field]).toBeNull()
    }
    expect(instanceSource.prototype).toBeUndefined()
    expect(instanceSource.transitionKey).toBeUndefined()
    expect(instance.overrides[`${instanceSource.id}:prototype`]).toBeNull()
    expect(instance.overrides[`${instanceSource.id}:transitionKey`]).toBeNull()
    expect(instanceTarget.transitionKey).toBe('componentTarget')
  })

  // eslint-disable-next-line complexity -- One fixture verifies clone, override, and detach invariants.
  test('clone remaps override snapshots and detach freezes the resolved local contract', () => {
    const { graph, page, component } = componentFixture()
    const instance = expectDefined(graph.createInstance(component.id, page.id), 'instance')
    const instanceSource = child(instance, graph, 'Source')
    const instanceTarget = child(instance, graph, 'Target')
    const instanceDestination = child(instance, graph, 'Destination')
    const rootScene = scene(instanceTarget.id)
    const rootDrivers = drivers(instanceSource.id, instanceTarget.id, instance.id)
    const rootPrototype = prototype(instanceDestination.id)
    const childPrototype = prototype(instanceDestination.id)
    graph.updateNode(instance.id, {
      motionScene: rootScene,
      motionDrivers: rootDrivers,
      prototype: rootPrototype,
      transitionKey: 'instanceRoot',
      overrides: {
        ...instance.overrides,
        motionScene: structuredClone(rootScene),
        motionDrivers: structuredClone(rootDrivers),
        prototype: structuredClone(rootPrototype),
        transitionKey: 'instanceRoot',
        [`${instanceSource.id}:prototype`]: structuredClone(childPrototype)
      }
    })
    graph.updateNode(instanceSource.id, { prototype: childPrototype })

    const clone = expectDefined(graph.cloneTree(instance.id, page.id), 'cloned instance')
    const cloneSource = child(clone, graph, 'Source')
    const cloneTarget = child(clone, graph, 'Target')
    const cloneDestination = child(clone, graph, 'Destination')

    expect(clone.motionScene?.sequences[0]?.cues[0]?.targetNodeId).toBe(cloneTarget.id)
    expect(clone.motionDrivers?.drivers[0]?.source).toMatchObject({
      sourceNodeId: cloneSource.id
    })
    expect(clone.motionDrivers?.drivers[0]?.target.targetNodeId).toBe(cloneTarget.id)
    expect(clone.motionDrivers?.drivers[1]?.target.targetNodeId).toBe(clone.id)
    expect(clone.prototype?.connections[0]?.action).toMatchObject({
      targetNodeId: cloneDestination.id
    })
    const sceneOverride = clone.overrides.motionScene as MotionSceneSpec
    const driverOverride = clone.overrides.motionDrivers as MotionDriverSpecV1
    const prototypeOverride = clone.overrides.prototype as PrototypeSpecV1
    expect(sceneOverride.sequences[0]?.cues[0]?.targetNodeId).toBe(cloneTarget.id)
    expect(driverOverride.drivers[0]?.source).toMatchObject({ sourceNodeId: cloneSource.id })
    expect(driverOverride.drivers[0]?.target.targetNodeId).toBe(cloneTarget.id)
    expect(prototypeOverride.connections[0]?.action).toMatchObject({
      targetNodeId: cloneDestination.id
    })
    expect(clone.overrides[`${instanceSource.id}:prototype`]).toBeUndefined()
    const clonedChildOverride = clone.overrides[`${cloneSource.id}:prototype`] as PrototypeSpecV1
    expect(clonedChildOverride.connections[0]?.action).toMatchObject({
      targetNodeId: cloneDestination.id
    })
    expect(clone.motionScene?.sequences[0]?.cues[1]?.targetNodeId).toBe(EXTERNAL_SCENE_TARGET)
    expect(clone.transitionKey).toBe('instanceRoot')

    graph.detachInstance(clone.id)
    expect(clone.type).toBe('FRAME')
    expect(clone.componentId).toBeNull()
    expect(clone.overrides).toEqual({})
    expect(clone.motionScene?.sequences[0]?.cues[0]?.targetNodeId).toBe(cloneTarget.id)
    expect(clone.prototype?.connections[0]?.action).toMatchObject({
      targetNodeId: cloneDestination.id
    })

    graph.updateNode(component.id, { transitionKey: 'componentAfterDetach' })
    graph.syncInstances(component.id)
    expect(clone.transitionKey).toBe('instanceRoot')
  })
})
