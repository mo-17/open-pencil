import { describe, expect, test } from 'bun:test'

import { createMotionPreset, SceneGraph } from '@open-pencil/scene-graph'

import { computeActionErrors } from '@/app/lowcode/action/errors'
import { collectMotionActionOptions } from '@/app/lowcode/motion-action-options'

import { expectDefined } from '#tests/helpers/assert'

describe('lowcode motion action options', () => {
  test('only exposes nodes with a valid MotionSpec and labels tracks by id', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const animated = graph.createNode('RECTANGLE', page.id, { name: 'Animated card' })
    const staticNode = graph.createNode('RECTANGLE', page.id, { name: 'Static card' })
    graph.updateNode(animated.id, { motion: createMotionPreset('hover-lift') })

    const options = collectMotionActionOptions(graph.getAllNodes())

    expect(options.nodeIds.has(staticNode.id)).toBe(true)
    expect(options.targets).toEqual([
      {
        id: animated.id,
        label: `Animated card (${animated.id})`,
        tracks: [{ id: 'hover-lift', label: 'hover-lift' }]
      }
    ])
  })

  test('excludes generated instance descendants and reports why stale actions are invalid', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'Animated component',
      motion: createMotionPreset('fade-in')
    })
    const componentChild = graph.createNode('RECTANGLE', component.id, {
      name: 'Generated child source',
      motion: createMotionPreset('slide-up')
    })
    const instance = expectDefined(graph.createInstance(component.id, page.id), 'instance')
    const instanceChild = expectDefined(
      graph.getNode(expectDefined(instance.childIds[0], 'instance child id')),
      'instance child'
    )
    expect(instanceChild.componentId).toBe(componentChild.id)

    const options = collectMotionActionOptions(graph.getAllNodes())

    expect(options.targets.map((target) => target.id)).toContain(instance.id)
    expect(options.targets.map((target) => target.id)).not.toContain(instanceChild.id)
    expect(options.unsupportedTargetIds.has(instanceChild.id)).toBe(true)
    expect(
      computeActionErrors(
        {
          id: 'play-generated-child',
          kind: 'playMotion',
          targetNodeId: instanceChild.id
        },
        {
          validStateIds: new Set(),
          validDocStateNames: new Set(),
          workflows: [],
          validNodeIds: options.nodeIds,
          motionTargets: options.targets,
          unsupportedMotionTargetIds: options.unsupportedTargetIds
        }
      )
    ).toEqual({ target: 'instance child motion targets cannot be saved to .fig' })
  })

  test('filters targets to the current page while preserving out-of-scope identity', () => {
    const graph = new SceneGraph()
    const currentPage = graph.getPages()[0]
    const otherPage = graph.addPage('Other')
    const currentTarget = graph.createNode('RECTANGLE', currentPage.id, {
      name: 'Current motion',
      motion: createMotionPreset('fade-in')
    })
    const otherTarget = graph.createNode('RECTANGLE', otherPage.id, {
      name: 'Other motion',
      motion: createMotionPreset('hover-lift')
    })

    const options = collectMotionActionOptions(graph.getAllNodes(), { pageId: currentPage.id })

    expect(options.targets.map((target) => target.id)).toEqual([currentTarget.id])
    expect(options.nodeIds.has(otherTarget.id)).toBe(true)
    expect(options.outOfScopeTargetIds.has(otherTarget.id)).toBe(true)
    expect(
      computeActionErrors(
        { id: 'play-other-page', kind: 'playMotion', targetNodeId: otherTarget.id },
        {
          validStateIds: new Set(),
          validDocStateNames: new Set(),
          workflows: [],
          validNodeIds: options.nodeIds,
          motionTargets: options.targets,
          unsupportedMotionTargetIds: options.unsupportedTargetIds,
          outOfScopeMotionTargetIds: options.outOfScopeTargetIds
        }
      )
    ).toEqual({ target: 'motion target is not available on the current page' })
  })
})
