import { compile, withDefaults } from '@open-pencil/compiler'

import { controlFoundationGraph } from './controls'

export function shadcnControlsFixture(target: 'react' | 'vue' = 'react', kit = true) {
  const { graph, pageId, delivery } = controlFoundationGraph()
  const parentId = delivery.parentId ?? pageId
  graph.updateNode(parentId, { height: 1400 })
  graph.createNode('SELECT', parentId, {
    name: 'Event delivery',
    width: 400,
    height: 36,
    interactiveProps: { ariaLabel: 'Event delivery', options: ['standard', 'express'] },
    bindings: { value: { kind: 'ref', stateId: 'delivery' } },
    events: {
      onChange: [
        {
          id: 'fixture-action-1',
          kind: 'setState',
          targetStateId: 'signal',
          valueExpr: '"select-change:" + $value'
        }
      ],
      onFocus: [
        {
          id: 'fixture-action-2',
          kind: 'setState',
          targetStateId: 'signal',
          valueExpr: '"select-focus"'
        }
      ],
      onBlur: [
        {
          id: 'fixture-action-3',
          kind: 'setState',
          targetStateId: 'signal',
          valueExpr: '"select-blur"'
        }
      ]
    }
  })
  graph.createNode('CHECKBOX', parentId, {
    name: 'Event checkbox',
    width: 40,
    height: 36,
    interactiveProps: { ariaLabel: 'Event checkbox' },
    events: {
      onChange: [
        {
          id: 'fixture-action-4',
          kind: 'setState',
          targetStateId: 'signal',
          valueExpr: '$event.target.checked ? "checked:" + $value : "unchecked:" + $value'
        }
      ]
    }
  })
  graph.createNode('CHECKBOX', parentId, {
    name: 'Click checkbox',
    width: 40,
    height: 36,
    interactiveProps: { ariaLabel: 'Click checkbox' },
    events: {
      onClick: [
        {
          id: 'fixture-action-5',
          kind: 'setState',
          targetStateId: 'signal',
          valueExpr: '"clicked"'
        }
      ]
    }
  })
  for (const type of ['RADIO', 'CHECKBOX'] as const) {
    graph.createNode(type, parentId, {
      name: 'Event ' + type,
      width: 400,
      height: 60,
      interactiveProps: { ariaLabel: 'Event ' + type, options: ['Alpha', 'Beta'] },
      events: {
        onChange: [
          {
            id: 'fixture-action-6',
            kind: 'setState',
            targetStateId: 'signal',
            valueExpr: '"option:" + $value'
          }
        ]
      }
    })
  }
  graph.createNode('SELECT', parentId, {
    name: 'Empty choice',
    width: 400,
    height: 36,
    interactiveProps: {
      ariaLabel: 'Empty choice',
      options: [
        { label: 'Choose a delivery', value: '' },
        { label: 'Standard', value: 'standard' }
      ]
    }
  })
  graph.createNode('CHECKBOX', parentId, {
    name: 'Disabled choice group',
    width: 400,
    height: 60,
    interactiveProps: {
      ariaLabel: 'Disabled choice group',
      options: ['Accept', 'Decline'],
      disabled: true
    }
  })
  graph.createNode('SELECT', parentId, {
    name: 'Disabled select',
    width: 400,
    height: 36,
    interactiveProps: { ariaLabel: 'Disabled select', options: ['Standard'], disabled: true }
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      ...(kit ? { uiKit: 'shadcn' as const } : {}),
      router: 'none',
      devMode: false
    })
  })
}
