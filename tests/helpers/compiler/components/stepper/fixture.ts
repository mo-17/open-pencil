import { compile, withDefaults } from '@open-pencil/compiler'
import { createStepperModuleFrameOverrides } from '@open-pencil/core/plugins'
import {
  SceneGraph,
  type BindingExpr,
  type ActionDef,
  type SceneNode,
  type StateDef
} from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

export type StepperBindingVariant = 'base' | 'invalid'

const steps = [
  { title: 'Details', description: 'Enter details', status: 'auto', disabled: false },
  { title: 'Review', description: 'Review details', status: 'auto', disabled: false },
  { title: 'Blocked', description: 'Unavailable step', status: 'auto', disabled: true },
  { title: 'Complete', description: 'Complete the flow', status: 'auto', disabled: false }
] as const

/** Uses the same public graph/module contracts as authored Stepper nodes. */
export function stepperBindingGraph(variant: StepperBindingVariant = 'base') {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const states: StateDef[] = [
    { id: 'pageStep', name: 'pageStep', type: 'number', defaultValue: 0 },
    { id: 'otherStep', name: 'otherStep', type: 'number', defaultValue: 3 },
    { id: 'person', name: 'person', type: 'string', defaultValue: 'Ada' },
    { id: 'changes', name: 'changes', type: 'number', defaultValue: 0 },
    { id: 'submitted', name: 'submitted', type: 'number', defaultValue: 0 },
    { id: 'eventValue', name: 'eventValue', type: 'number', defaultValue: -1 },
    { id: 'eventCurrent', name: 'eventCurrent', type: 'number', defaultValue: -1 },
    { id: 'eventPrevious', name: 'eventPrevious', type: 'number', defaultValue: -1 },
    { id: 'eventSource', name: 'eventSource', type: 'string', defaultValue: 'none' }
  ]
  if (variant === 'invalid')
    states.push(
      { id: 'fractionStep', name: 'fractionStep', type: 'number', defaultValue: 0.5 },
      { id: 'negativeStep', name: 'negativeStep', type: 'number', defaultValue: -1 },
      { id: 'outsideStep', name: 'outsideStep', type: 'number', defaultValue: 99 },
      { id: 'disabledStep', name: 'disabledStep', type: 'number', defaultValue: 2 },
      { id: 'stringStep', name: 'stringStep', type: 'string', defaultValue: '1' },
      {
        id: 'computedStep',
        name: 'computedStep',
        type: 'number',
        defaultValue: 0,
        computedExpr: 'pageStep + 1'
      }
    )
  graph.updateNode(page.id, { state: states })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'documentStep', name: 'documentStep', type: 'number', defaultValue: 1 }
    ]
  })

  function changeActions(label: string): ActionDef[] {
    return [
      { id: label + '-value', kind: 'setState', targetStateId: 'eventValue', valueExpr: '$value' },
      {
        id: label + '-current',
        kind: 'setState',
        targetStateId: 'eventCurrent',
        valueExpr: '$event.detail.currentIndex'
      },
      {
        id: 'fixture-action-1',
        kind: 'setState',
        targetStateId: 'eventPrevious',
        valueExpr: '$event.detail.previousIndex'
      },
      {
        id: label + '-source',
        kind: 'setState',
        targetStateId: 'eventSource',
        valueExpr: JSON.stringify(label)
      },
      { id: label + '-count', kind: 'setState', targetStateId: 'changes', valueExpr: 'changes + 1' }
    ]
  }
  function stepper(
    owner: SceneNode,
    label: string,
    binding?: BindingExpr,
    options: {
      currentIndex?: number
      allowStepClick?: boolean
      disabled?: boolean
      readOnly?: boolean
    } = {},
    position: Partial<Vector> = {}
  ) {
    const frame = createStepperModuleFrameOverrides({
      label,
      items: steps.map((step) => ({ ...step })),
      currentIndex: options.currentIndex ?? 3,
      allowStepClick: options.allowStepClick ?? true
    })
    return graph.createNode('FRAME', owner.id, {
      ...frame,
      ...position,
      name: label,
      width: 420,
      height: 124,
      ...(binding ? { bindings: { currentIndex: binding } } : {}),
      interactiveProps: {
        ...frame.interactiveProps,
        lang: 'en',
        ...(options.disabled ? { disabled: true } : {}),
        ...(options.readOnly ? { readOnly: true } : {})
      },
      events: { onChange: changeActions(label) }
    })
  }
  function button(label: string, actions: ActionDef[], x: number, y: number) {
    graph.createNode('BUTTON', page.id, {
      name: label,
      x,
      y,
      width: 260,
      height: 40,
      interactiveProps: { text: label, type: 'button' },
      events: { onClick: actions }
    })
  }
  function output(label: string, expression: string, x: number, y: number) {
    graph.createNode('TEXT', page.id, {
      name: label,
      text: label,
      x,
      y,
      width: 700,
      height: 36,
      bindings: { text: { kind: 'expr', expr: expression } }
    })
  }

  if (variant === 'base') {
    const main = graph.createNode('FORM', page.id, {
      name: 'Main step form',
      x: 20,
      y: 20,
      width: 580,
      height: 560,
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      events: {
        onSubmit: [
          {
            id: 'submit-form',
            kind: 'setState',
            targetStateId: 'submitted',
            valueExpr: 'submitted + 1'
          }
        ]
      }
    })
    stepper(main, 'Shared page A', { kind: 'ref', stateId: 'pageStep' })
    stepper(main, 'Shared page B', { kind: 'ref', stateId: 'pageStep' })
    stepper(main, 'Document flow', { kind: 'docState', docStateName: 'documentStep' })
    graph.createNode('INPUT', main.id, {
      name: 'Person',
      width: 300,
      height: 44,
      interactiveProps: { ariaLabel: 'Person', validation: { required: true } },
      bindings: { value: { kind: 'ref', stateId: 'person' } }
    })
    graph.createNode('BUTTON', main.id, {
      name: 'Submit form',
      width: 200,
      height: 40,
      interactiveProps: { text: 'Submit form', type: 'submit' }
    })
    stepper(page, 'Local flow A', undefined, { currentIndex: 0 }, { x: 660, y: 20 })
    stepper(page, 'Local flow B', undefined, { currentIndex: 0 }, { x: 660, y: 170 })
    button(
      'External page step',
      [{ id: 'external-page', kind: 'setState', targetStateId: 'pageStep', valueExpr: '0' }],
      660,
      320
    )
    button(
      'External document step',
      [
        { id: 'external-document', kind: 'setVariable', targetName: 'documentStep', valueExpr: '3' }
      ],
      660,
      370
    )
    const other = graph.createNode('FORM', page.id, {
      name: 'Other step form',
      x: 660,
      y: 440,
      width: 500,
      height: 160,
      layoutMode: 'VERTICAL'
    })
    stepper(other, 'Other form flow', { kind: 'ref', stateId: 'otherStep' }, { currentIndex: 0 })
  } else {
    const controls: [
      string,
      BindingExpr,
      { allowStepClick?: boolean; disabled?: boolean; readOnly?: boolean }?
    ][] = [
      ['Fractional flow', { kind: 'ref', stateId: 'fractionStep' }],
      ['Negative flow', { kind: 'ref', stateId: 'negativeStep' }],
      ['Out of range flow', { kind: 'ref', stateId: 'outsideStep' }],
      ['Disabled current flow', { kind: 'ref', stateId: 'disabledStep' }],
      ['Missing binding flow', { kind: 'ref', stateId: 'missingStep' }],
      ['Wrong type flow', { kind: 'ref', stateId: 'stringStep' }],
      ['Computed flow', { kind: 'ref', stateId: 'computedStep' }],
      ['Expression flow', { kind: 'expr', expr: 'pageStep' }],
      ['Disabled flow', { kind: 'ref', stateId: 'pageStep' }, { disabled: true }],
      ['Readonly flow', { kind: 'docState', docStateName: 'documentStep' }, { readOnly: true }],
      ['No step clicks', { kind: 'ref', stateId: 'pageStep' }, { allowStepClick: false }]
    ]
    for (const [index, [label, binding, options]] of controls.entries())
      stepper(page, label, binding, options, {
        x: 20 + (index % 3) * 450,
        y: 20 + Math.floor(index / 3) * 150
      })
    button(
      'Repair numeric steps',
      ['fractionStep', 'negativeStep', 'outsideStep', 'disabledStep'].map((id) => ({
        id: 'repair-' + id,
        kind: 'setState' as const,
        targetStateId: id,
        valueExpr: '0'
      })),
      20,
      650
    )
    output(
      'Invalid state',
      '"Invalid:" + fractionStep + "/" + negativeStep + "/" + outsideStep + "/" + disabledStep + "/" + pageStep + "/" + documentStep + "/" + changes',
      20,
      700
    )
  }
  output(
    'Stepper state',
    '"State:" + pageStep + "/" + documentStep + "/" + otherStep + "/" + changes + "/" + submitted',
    20,
    610
  )
  output(
    'Stepper event',
    '"Event:" + eventValue + "/" + eventCurrent + "/" + eventPrevious + "/" + eventSource',
    20,
    750
  )
  return { graph, page }
}

export function stepperBindingFixture(
  target: 'react' | 'vue',
  variant: StepperBindingVariant = 'base'
) {
  const { graph, page } = stepperBindingGraph(variant)
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
}
