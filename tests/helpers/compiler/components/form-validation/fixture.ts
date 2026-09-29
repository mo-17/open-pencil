import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type NodeType } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export function formFeedbackFixture(target: 'react' | 'vue', kit = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      ...['quantity', 'choice', 'city', 'ignored', 'blur'].map((name) => ({
        id: name,
        name,
        type: 'string' as const,
        defaultValue: name === 'quantity' ? 'not a number' : ''
      })),
      { id: 'tags', name: 'tags', type: 'array', defaultValue: [] },
      { id: 'submitted', name: 'submitted', type: 'number', defaultValue: 0 }
    ]
  })
  const form = graph.createNode('FORM', pageId, {
    name: 'Feedback form',
    width: 480,
    height: 700,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    paddingTop: 16,
    paddingLeft: 16,
    events: {
      onSubmit: [{ kind: 'setState', targetStateId: 'submitted', valueExpr: 'submitted + 1' }]
    }
  })
  const field = (type: NodeType, name: string, state: string, props: JSONObject = {}) =>
    graph.createNode(type, form.id, {
      name,
      width: 400,
      height: type === 'RADIO' || type === 'CHECKBOX' ? 64 : 40,
      interactiveProps: {
        ariaLabel: name,
        validation: { required: true, messages: { required: name + ' required' } },
        ...props
      },
      bindings: { value: { kind: 'ref', stateId: state } }
    })
  field('INPUT', 'Disabled value', 'ignored', { disabled: true })
  field('INPUT', 'Read only value', 'ignored', { readOnly: true })
  field('INPUT', 'Quantity', 'quantity', {
    validation: {
      required: true,
      min: 1,
      max: 10,
      messages: {
        min: 'Quantity must be a number from 1 to 10',
        max: 'Quantity must be a number from 1 to 10'
      }
    }
  })
  const choice = field('RADIO', 'Choice', 'choice', { options: ['Alpha', 'Beta'] })
  graph.updateNode(choice.id, {
    events: { onBlur: [{ kind: 'setState', targetStateId: 'blur', valueExpr: '"choice"' }] }
  })
  field('CHECKBOX', 'Tags', 'tags', { options: ['One', 'Two'] })
  field('SELECT', 'City', 'city', {
    placeholder: 'Select a city',
    showSearch: true,
    options: [
      { label: 'Xiamen', value: 'xiamen' },
      { label: 'Unavailable', value: 'disabled', disabled: true }
    ]
  })
  graph.createNode('BUTTON', form.id, {
    name: 'Submit feedback',
    width: 180,
    height: 40,
    interactiveProps: { text: 'Submit feedback' }
  })
  graph.createNode('TEXT', form.id, {
    width: 400,
    height: 32,
    text: 'Status',
    bindings: { text: { kind: 'expr', expr: '"Submitted[" + submitted + "] Blur[" + blur + "]"' } }
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      devMode: false,
      ...(kit ? { uiKit: 'shadcn' } : {}),
      packageName: 'form-feedback'
    })
  })
}
