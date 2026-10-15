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
            kind: 'condition',
            condExpr: 'true',
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

  test('sync resolves nested forward Motion references once the whole instance is assembled', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id)
    const instance = expectDefined(graph.createInstance(component.id, page.id), 'instance')
    const controls = graph.createNode('FRAME', component.id, { name: 'Controls' })
    const targets = graph.createNode('FRAME', component.id, { name: 'Targets' })
    const target = graph.createNode('RECTANGLE', targets.id, {
      name: 'Animated target',
      motion: createMotionPreset('slide-up')
    })
    const opaqueData = [{ pluginId: 'foreign-plugin', key: 'opaque', value: target.id }]
    const button = graph.createNode('BUTTON', controls.id, {
      name: 'Controller',
      pluginData: opaqueData,
      events: {
        onClick: [
          {
            id: 'condition',
            kind: 'condition',
            condExpr: 'true',
            consequent: [{ id: 'play', kind: 'playMotion', targetNodeId: target.id }],
            alternate: []
          }
        ]
      },
      lowcodeWorkflows: [
        {
          id: 'stop',
          name: 'Stop',
          actions: [
            { id: 'stop-target', kind: 'stopMotion', targetNodeId: target.id },
            { id: 'stop-root', kind: 'stopMotion', targetNodeId: component.id }
          ]
        }
      ]
    })
    graph.syncInstance(instance.id)
    const generatedControls = expectDefined(
      graph.getChildren(instance.id).find((n) => n.componentId === controls.id),
      'generated controls'
    )
    const generatedTargets = expectDefined(
      graph.getChildren(instance.id).find((n) => n.componentId === targets.id),
      'generated targets'
    )
    const generatedButton = expectDefined(
      graph.getChildren(generatedControls.id).find((n) => n.componentId === button.id),
      'generated button'
    )
    const generatedTarget = expectDefined(
      graph.getChildren(generatedTargets.id).find((n) => n.componentId === target.id),
      'generated target'
    )
    expect(generatedButton.events?.onClick?.[0]).toMatchObject({
      consequent: [{ id: 'play', kind: 'playMotion', targetNodeId: generatedTarget.id }]
    })
    expect(generatedButton.lowcodeWorkflows?.[0].actions).toEqual([
      { id: 'stop-target', kind: 'stopMotion', targetNodeId: generatedTarget.id },
      { id: 'stop-root', kind: 'stopMotion', targetNodeId: instance.id }
    ])
    expect(generatedButton.pluginData).toEqual(opaqueData)
    expect(generatedButton.pluginData).not.toBe(button.pluginData)
    expect(button.events?.onClick?.[0]).toMatchObject({
      consequent: [{ targetNodeId: target.id }]
    })
  })
})
