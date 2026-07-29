import { describe, expect, test } from 'bun:test'

import { SceneGraph, createMotionPreset } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

describe('SceneGraph Motion action reference cloning', () => {
  test('cloneTree remaps nested event and workflow targets within the cloned subtree', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Motion group' })
    const target = graph.createNode('RECTANGLE', frame.id, {
      name: 'Animated target',
      motion: createMotionPreset('fade-in')
    })
    const button = graph.createNode('BUTTON', frame.id, {
      name: 'Controller',
      events: {
        onClick: [
          {
            id: 'condition',
            kind: 'conditional',
            condition: 'true',
            consequent: [{ id: 'play', kind: 'playMotion', targetNodeId: target.id }],
            alternate: []
          }
        ]
      },
      lowcodeWorkflows: [
        {
          id: 'stop-workflow',
          name: 'Stop target',
          actions: [{ id: 'stop', kind: 'stopMotion', targetNodeId: target.id }]
        }
      ]
    })

    const clone = expectDefined(graph.cloneTree(frame.id, page.id), 'cloned frame')
    const clonedTarget = expectDefined(
      graph.getChildren(clone.id).find((node) => node.name === target.name),
      'cloned target'
    )
    const clonedButton = expectDefined(
      graph.getChildren(clone.id).find((node) => node.name === button.name),
      'cloned button'
    )

    expect(clonedButton.events).not.toBe(button.events)
    expect(clonedButton.lowcodeWorkflows).not.toBe(button.lowcodeWorkflows)
    expect(clonedButton.events?.onClick?.[0]).toMatchObject({
      consequent: [{ kind: 'playMotion', targetNodeId: clonedTarget.id }]
    })
    expect(clonedButton.lowcodeWorkflows?.[0].actions[0]).toMatchObject({
      kind: 'stopMotion',
      targetNodeId: clonedTarget.id
    })
  })

  test('component instance descendants target generated siblings and the instance root', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'Motion component',
      motion: createMotionPreset('fade-in')
    })
    const target = graph.createNode('RECTANGLE', component.id, {
      name: 'Animated child',
      motion: createMotionPreset('slide-up')
    })
    const button = graph.createNode('BUTTON', component.id, {
      name: 'Controller',
      events: {
        onClick: [
          { id: 'play-child', kind: 'playMotion', targetNodeId: target.id },
          { id: 'stop-root', kind: 'stopMotion', targetNodeId: component.id }
        ]
      }
    })

    const instance = expectDefined(graph.createInstance(component.id, page.id), 'instance')
    const generatedTarget = expectDefined(
      graph.getChildren(instance.id).find((node) => node.componentId === target.id),
      'generated target'
    )
    const generatedButton = expectDefined(
      graph.getChildren(instance.id).find((node) => node.componentId === button.id),
      'generated button'
    )

    expect(generatedButton.events).not.toBe(button.events)
    expect(generatedButton.events?.onClick).toEqual([
      { id: 'play-child', kind: 'playMotion', targetNodeId: generatedTarget.id },
      { id: 'stop-root', kind: 'stopMotion', targetNodeId: instance.id }
    ])
  })
})
