import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/scene-graph'

import { reapplyInstanceOverrides } from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
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

describe('Figma instance generated-effect overrides', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('round-trips custom and null overrides and preserves them during master sync', async () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'Generated effect master',
      generatedEffect: generatedEffect('noise')
    })
    const componentChild = graph.createNode('RECTANGLE', component.id, {
      name: 'Generated effect child',
      generatedEffect: generatedEffect('shimmer')
    })

    const custom = expectDefined(graph.createInstance(component.id, page.id), 'custom instance')
    graph.updateNode(custom.id, { name: 'Custom generated effect instance' })
    const customChild = namedChild(graph, custom, componentChild.name)
    const customRootEffect = generatedEffect('particles')
    const customChildEffect = generatedEffect('scanlines')
    graph.updateNode(customChild.id, { generatedEffect: customChildEffect })
    graph.updateNode(custom.id, {
      generatedEffect: customRootEffect,
      overrides: {
        generatedEffect: structuredClone(customRootEffect),
        [`${customChild.id}:generatedEffect`]: structuredClone(customChildEffect)
      }
    })

    const cleared = expectDefined(graph.createInstance(component.id, page.id), 'cleared instance')
    graph.updateNode(cleared.id, { name: 'Cleared generated effect instance' })
    const clearedChild = namedChild(graph, cleared, componentChild.name)
    graph.clearNodeFields(cleared.id, ['generatedEffect'])
    graph.clearNodeFields(clearedChild.id, ['generatedEffect'])
    graph.updateNode(cleared.id, {
      overrides: {
        generatedEffect: null,
        [`${clearedChild.id}:generatedEffect`]: null
      }
    })

    const reopened = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const reopenedComponent = named(reopened, component.name)
    const reopenedComponentChild = namedChild(reopened, reopenedComponent, componentChild.name)
    const reopenedCustom = named(reopened, custom.name)
    const reopenedCustomChild = namedChild(reopened, reopenedCustom, componentChild.name)
    const reopenedCleared = named(reopened, cleared.name)
    const reopenedClearedChild = namedChild(reopened, reopenedCleared, componentChild.name)

    expect(reopenedCustom.generatedEffect).toEqual(customRootEffect)
    expect(reopenedCustom.overrides.generatedEffect).toEqual(customRootEffect)
    expect(reopenedCustom.overrides.generatedEffect).not.toBe(reopenedCustom.generatedEffect)
    expect(reopenedCustomChild.generatedEffect).toEqual(customChildEffect)
    expect(reopenedCustom.overrides[`${reopenedCustomChild.id}:generatedEffect`]).toEqual(
      customChildEffect
    )
    expect(reopenedCleared.generatedEffect).toBeUndefined()
    expect(reopenedCleared.overrides.generatedEffect).toBeNull()
    expect(reopenedClearedChild.generatedEffect).toBeUndefined()
    expect(reopenedCleared.overrides[`${reopenedClearedChild.id}:generatedEffect`]).toBeNull()
    expect(reopenedCustom.pendingInstanceOverrides).toBeUndefined()
    expect(reopenedCleared.pendingInstanceOverrides).toBeUndefined()

    reopened.updateNode(reopenedComponent.id, {
      generatedEffect: generatedEffect('scanlines')
    })
    reopened.updateNode(reopenedComponentChild.id, {
      generatedEffect: generatedEffect('particles')
    })
    reopened.syncInstances(reopenedComponent.id)

    expect(reopenedCustom.generatedEffect).toEqual(customRootEffect)
    expect(reopenedCustomChild.generatedEffect).toEqual(customChildEffect)
    expect(reopenedCleared.generatedEffect).toBeUndefined()
    expect(reopenedClearedChild.generatedEffect).toBeUndefined()
  })

  test('strictly rejects malformed root and descendant generated-effect snapshots', () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const componentRootEffect = generatedEffect('noise')
    const componentChildEffect = generatedEffect('shimmer')
    const component = graph.createNode('COMPONENT', page.id, {
      generatedEffect: componentRootEffect
    })
    graph.createNode('RECTANGLE', component.id, { generatedEffect: componentChildEffect })
    const instance = expectDefined(graph.createInstance(component.id, page.id), 'instance')
    const instanceChild = expectDefined(graph.getChildren(instance.id)[0], 'instance child')
    const invalid = { ...generatedEffect('particles'), version: 2 }

    graph.updateNode(instance.id, {
      pendingInstanceOverrides: {
        ':generatedEffect': invalid,
        '0:generatedEffect': invalid
      }
    })
    reapplyInstanceOverrides(graph, [instance.id])

    expect(instance.generatedEffect).toEqual(componentRootEffect)
    expect(instanceChild.generatedEffect).toEqual(componentChildEffect)
    expect(instance.overrides).toEqual({})
    expect(instance.pendingInstanceOverrides).toBeUndefined()
  })
})
