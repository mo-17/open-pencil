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
        { kind: 'setState', targetStateId: 'signal', valueExpr: '"select-change:" + $value' }
      ],
      onFocus: [{ kind: 'setState', targetStateId: 'signal', valueExpr: '"select-focus"' }],
      onBlur: [{ kind: 'setState', targetStateId: 'signal', valueExpr: '"select-blur"' }]
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
    events: { onClick: [{ kind: 'setState', targetStateId: 'signal', valueExpr: '"clicked"' }] }
  })
  for (const type of ['RADIO', 'CHECKBOX'] as const) {
    graph.createNode(type, parentId, {
      name: 'Event ' + type,
      width: 400,
      height: 60,
      interactiveProps: { ariaLabel: 'Event ' + type, options: ['Alpha', 'Beta'] },
      events: {
        onChange: [{ kind: 'setState', targetStateId: 'signal', valueExpr: '"option:" + $value' }]
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
