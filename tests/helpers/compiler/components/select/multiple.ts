import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

export function selectMultipleGraph() {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      { id: 'replacement', name: 'replacement', type: 'array', defaultValue: ['b', ''] },
      { id: 'choices', name: 'choices', type: 'array', defaultValue: ['a'] },
      {
        id: 'dynamicOptions',
        name: 'dynamicOptions',
        type: 'array',
        defaultValue: [
          { id: 'a', label: 'Dynamic Alpha' },
          { id: 'b', label: 'Dynamic Beta' }
        ]
      },
      {
        id: 'fewerOptions',
        name: 'fewerOptions',
        type: 'array',
        defaultValue: [{ id: 'b', label: 'Dynamic Beta' }]
      },
      {
        id: 'allOptions',
        name: 'allOptions',
        type: 'array',
        defaultValue: [
          { id: 'a', label: 'Dynamic Alpha' },
          { id: 'b', label: 'Dynamic Beta' }
        ]
      },
      { id: 'blurs', name: 'blurs', type: 'number', defaultValue: 0 },
      { id: 'changes', name: 'changes', type: 'number', defaultValue: 0 }
    ]
  })
  const form = graph.createNode('FORM', pageId, {
    name: 'Multiple selection form',
    width: 430,
    height: 800,
    layoutMode: 'VERTICAL',
    itemSpacing: 18,
    paddingTop: 20,
    paddingLeft: 20
  })
  const select = graph.createNode('SELECT', form.id, {
    name: 'Topics',
    width: 340,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Topics',
      multiple: true,
      showSearch: true,
      virtual: true,
      allowClear: true,
      placeholder: 'Choose topics',
      options: [
        { value: '', label: 'Empty business value' },
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: '北京 Beijing' },
        { value: 'c', label: 'Disabled topic', disabled: true }
      ],
      validation: {
        required: true,
        minLength: 2,
        messages: { required: 'Choose topics', minLength: 'Choose at least two topics' }
      }
    },
    bindings: { value: { kind: 'ref', stateId: 'choices' } },
    events: {
      onChange: [
        {
          id: 'fixture-action-1',
          kind: 'setState',
          targetStateId: 'changes',
          valueExpr: '$prev + 1'
        }
      ],
      onBlur: [
        { id: 'fixture-action-2', kind: 'setState', targetStateId: 'blurs', valueExpr: '$prev + 1' }
      ]
    }
  })
  graph.createNode('SELECT', form.id, {
    name: 'Uncontrolled topics',
    width: 340,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Uncontrolled topics',
      multiple: true,
      value: ['b'],
      allowClear: true,
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' }
      ]
    }
  })
  graph.createNode('SELECT', form.id, {
    name: 'Disabled topics',
    width: 340,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Disabled topics',
      multiple: true,
      value: ['a'],
      disabled: true,
      options: [{ value: 'a', label: 'Alpha' }]
    }
  })
  graph.createNode('BUTTON', form.id, {
    name: 'External selection',
    width: 340,
    height: 44,
    interactiveProps: { text: 'External selection' },
    events: {
      onClick: [
        {
          id: 'fixture-action-3',
          kind: 'setState',
          targetStateId: 'choices',
          valueExpr: 'replacement'
        }
      ]
    }
  })
  graph.createNode('BUTTON', form.id, {
    name: 'Outside',
    width: 340,
    height: 44,
    interactiveProps: { text: 'Outside' },
    events: {
      onClick: [
        { id: 'fixture-action-4', kind: 'setState', targetStateId: 'changes', valueExpr: '$prev' }
      ]
    }
  })
  graph.createNode('TEXT', form.id, {
    name: 'Changes',
    text: 'Changes',
    width: 340,
    height: 30,
    bindings: { text: { kind: 'expr', expr: '"Changes[" + changes + "]"' } }
  })
  graph.createNode('TEXT', form.id, {
    name: 'Blur count',
    text: 'Blur count',
    width: 340,
    height: 30,
    bindings: { text: { kind: 'expr', expr: '"Blurs[" + blurs + "]"' } }
  })
  graph.createNode('SELECT', form.id, {
    name: 'Dynamic topics',
    width: 340,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Dynamic topics',
      multiple: true,
      value: ['a'],
      optionsSource: {
        kind: 'ref',
        stateId: 'dynamicOptions',
        itemName: 'option',
        valueExpr: 'option.id',
        labelExpr: 'option.label'
      }
    }
  })
  for (const [text, valueExpr] of [
    ['Remove dynamic Alpha', 'fewerOptions'],
    ['Restore dynamic Alpha', 'allOptions']
  ])
    graph.createNode('BUTTON', form.id, {
      name: text,
      width: 340,
      height: 40,
      interactiveProps: { text },
      events: {
        onClick: [
          { id: 'fixture-action-5', kind: 'setState', targetStateId: 'dynamicOptions', valueExpr }
        ]
      }
    })
  return { graph, pageId, form, select }
}
export function selectMultipleFixture(target: 'react' | 'vue', shadcn = false) {
  const { graph, pageId } = selectMultipleGraph()
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, devMode: false, ...(shadcn ? { uiKit: 'shadcn' } : {}) })
  })
  return { files: [...output.files], warnings: output.warnings }
}
