import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

export const INPUT_SUGGESTIONS = [
  '北京 Beijing',
  '北海 Beihai',
  '厦门 Xiamen',
  'Shanghai',
  '示例 <script>alert(1)</script>'
]

export function autocompleteGraph() {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      { id: 'city', name: 'city', type: 'string', defaultValue: '' },
      { id: 'changes', name: 'changes', type: 'number', defaultValue: 0 },
      { id: 'submitted', name: 'submitted', type: 'number', defaultValue: 0 }
    ]
  })
  const form = graph.createNode('FORM', pageId, {
    name: 'City form',
    width: 340,
    height: 720,
    layoutMode: 'VERTICAL',
    itemSpacing: 16,
    paddingTop: 16,
    paddingLeft: 16,
    paddingRight: 16,
    events: {
      onSubmit: [
        {
          id: 'fixture-action-1',
          kind: 'setState',
          targetStateId: 'submitted',
          valueExpr: '$prev + 1'
        }
      ]
    }
  })
  const input = graph.createNode('INPUT', form.id, {
    name: 'City',
    width: 300,
    height: 44,
    bindings: { value: { kind: 'ref', stateId: 'city' } },
    interactiveProps: {
      inputType: 'text',
      ariaLabel: '城市',
      suggestions: INPUT_SUGGESTIONS,
      validation: { required: true, messages: { required: '请输入城市' } }
    },
    events: {
      onChange: [
        {
          id: 'fixture-action-2',
          kind: 'setState',
          targetStateId: 'changes',
          valueExpr: '$prev + 1'
        }
      ]
    }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Independent',
    width: 300,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Independent city',
      value: '自由初值',
      suggestions: INPUT_SUGGESTIONS
    }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Readonly',
    width: 300,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Readonly city',
      readOnly: true,
      value: '北京 Beijing',
      suggestions: INPUT_SUGGESTIONS
    }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Disabled',
    width: 300,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Disabled city',
      disabled: true,
      value: '厦门 Xiamen',
      suggestions: INPUT_SUGGESTIONS
    }
  })
  graph.createNode('BUTTON', form.id, {
    name: 'Outside',
    width: 300,
    height: 40,
    interactiveProps: { text: 'Outside' }
  })
  graph.createNode('TEXT', form.id, {
    name: 'Feedback',
    width: 300,
    height: 60,
    text: 'Feedback',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"City[" + city + "] Changes[" + changes + "] Submitted[" + submitted + "]"'
      }
    }
  })
  return { graph, pageId, input, form }
}
export function autocompleteFixture(target: 'react' | 'vue') {
  const { graph, pageId } = autocompleteGraph()
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: 'zh-CN' })
  })
  return { files: [...result.files], warnings: result.warnings }
}
