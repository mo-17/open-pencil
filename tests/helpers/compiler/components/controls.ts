import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type NodeType } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export function controlFoundationGraph() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      { id: 'amount', name: 'amount', type: 'string', defaultValue: '' },
      { id: 'delivery', name: 'delivery', type: 'string', defaultValue: 'standard' },
      { id: 'contact', name: 'contact', type: 'string', defaultValue: '' },
      { id: 'signal', name: 'signal', type: 'string', defaultValue: '' }
    ]
  })
  const root = graph.createNode('FRAME', pageId, {
    name: 'Controls',
    width: 480,
    height: 800,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 14,
    paddingTop: 16,
    paddingLeft: 16,
    paddingRight: 16
  })
  const add = (type: NodeType, name: string, interactiveProps: JSONObject) =>
    graph.createNode(type, root.id, {
      name,
      width: 400,
      height: type === 'RADIO' ? 72 : 36,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      interactiveProps
    })
  const amount = add('INPUT', 'Amount', {
    inputType: 'number',
    ariaLabel: 'Amount',
    inputMode: 'decimal',
    autoComplete: 'off',
    min: 0,
    max: 10,
    step: 0.5
  })
  graph.updateNode(amount.id, { bindings: { value: { kind: 'ref', stateId: 'amount' } } })
  const delivery = add('SELECT', 'Delivery', {
    ariaLabel: 'Delivery',
    options: [
      { label: 'Standard delivery', value: 'standard' },
      { label: 'Express delivery', value: 'express' },
      { label: 'Unavailable delivery', value: 'unavailable', disabled: true }
    ]
  })
  graph.updateNode(delivery.id, { bindings: { value: { kind: 'ref', stateId: 'delivery' } } })
  add('SELECT', 'Default delivery', {
    ariaLabel: 'Default delivery',
    options: ['Legacy', { label: 'Saved delivery', value: 'saved' }],
    value: 'saved'
  })
  add('TEXTAREA', 'Read only notes', {
    ariaLabel: 'Read only notes',
    value: 'Keep this draft',
    readOnly: true,
    maxLength: 120
  })
  add('DATEPICKER', 'Read only date', {
    ariaLabel: 'Read only date',
    value: '2026-09-22',
    min: '2026-01-01',
    readOnly: true
  })
  add('CHECKBOX', 'Disabled checkbox', {
    ariaLabel: 'Disabled checkbox',
    checked: true,
    disabled: true
  })
  add('SWITCH', 'Disabled switch', { ariaLabel: 'Disabled switch', disabled: true })
  add('RADIO', 'Disabled delivery group', {
    ariaLabel: 'Disabled delivery group',
    options: ['First', 'Second'],
    disabled: true,
    groupName: 'radio-demo'
  })
  const action = add('BUTTON', 'Disabled action', {
    ariaLabel: 'Disabled action',
    text: 'Disabled action',
    disabled: true
  })
  graph.updateNode(action.id, {
    events: {
      onClick: [{ kind: 'setState', targetStateId: 'amount', valueExpr: '"unexpected-write"' }]
    }
  })
  const output = graph.createNode('TEXT', root.id, {
    name: 'State output',
    width: 440,
    height: 32,
    text: 'State output',
    bindings: {
      text: { kind: 'expr', expr: '"Amount[" + amount + "] Delivery[" + delivery + "]"' }
    }
  })
  const contact = add('INPUT', 'Contact name', {
    ariaLabel: 'Contact name',
    validation: { required: true, messages: { required: 'Enter a contact name' } }
  })
  graph.updateNode(contact.id, {
    bindings: { value: { kind: 'ref', stateId: 'contact' } },
    events: {
      onFocus: [{ kind: 'setState', targetStateId: 'signal', valueExpr: '"focus"' }],
      onChange: [{ kind: 'setState', targetStateId: 'signal', valueExpr: '"change"' }],
      onBlur: [{ kind: 'setState', targetStateId: 'signal', valueExpr: '"blur"' }]
    }
  })
  graph.createNode('TEXT', root.id, {
    name: 'Event output',
    width: 440,
    height: 32,
    text: 'Event output',
    bindings: { text: { kind: 'expr', expr: '"Contact[" + contact + "] Event[" + signal + "]"' } }
  })
  return { graph, pageId, amount, delivery, output }
}

export function controlFoundationFixture(target: 'react' | 'vue') {
  const { graph, pageId } = controlFoundationGraph()
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (output.warnings.length) throw new Error(JSON.stringify(output.warnings))
  return { files: [...output.files] }
}
