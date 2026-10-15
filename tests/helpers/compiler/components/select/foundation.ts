import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export function selectFoundationFixture(target: 'react' | 'vue', shadcn = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      { id: 'choice', name: 'choice', type: 'string', defaultValue: '' },
      { id: 'dynamic', name: 'dynamic', type: 'string', defaultValue: '' },
      {
        id: 'choices',
        name: 'choices',
        type: 'array',
        defaultValue: [{ id: 'ready', label: 'Ready' }]
      },
      {
        id: 'withEmpty',
        name: 'withEmpty',
        type: 'array',
        defaultValue: [
          { id: '', label: 'All statuses' },
          { id: 'ready', label: 'Ready' }
        ]
      },
      {
        id: 'withoutEmpty',
        name: 'withoutEmpty',
        type: 'array',
        defaultValue: [{ id: 'ready', label: 'Ready' }]
      }
    ]
  })
  const root = graph.createNode('FRAME', pageId, {
    width: 480,
    height: 1040,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    paddingTop: 20,
    paddingLeft: 20,
    paddingRight: 20,
    itemSpacing: 12,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }]
  })
  const options = [
    { label: 'Ready', value: 'ready' },
    { label: 'Paused', value: 'paused' },
    { label: 'Unavailable', value: 'blocked', disabled: true }
  ]
  const add = (name: string, props: JSONObject) =>
    graph.createNode('SELECT', root.id, {
      name,
      width: 400,
      height: 40,
      interactiveProps: { ariaLabel: name, options, ...props }
    })
  add('Placeholder only', {
    placeholder: '请选择状态',
    textColor: '#123456',
    placeholderColor: '#789ABC'
  })
  const clear = add('Clearable status', {
    placeholder: 'Choose or clear status',
    allowClear: true,
    value: 'paused',
    textColor: '#123456',
    placeholderColor: '#789ABC',
    validation: { required: true, messages: { required: 'Choose a status' } }
  })
  graph.updateNode(clear.id, { bindings: { value: { kind: 'ref', stateId: 'choice' } } })
  add('Clearable fallback', { allowClear: true })
  add('Legacy default', { value: 'paused' })
  add('Legacy unmatched empty', { value: '' })
  add('Legacy unmatched literal', { value: 'missing' })
  add('Legacy empty default', {
    value: '',
    options: [
      { label: 'Ready', value: 'ready' },
      { label: 'All statuses', value: '' }
    ]
  })
  add('Legacy disabled default', { value: 'blocked' })
  add('Legacy first available', {
    options: [
      { label: 'Unavailable', value: 'blocked', disabled: true },
      { label: 'Ready', value: 'ready' }
    ]
  })
  add('Disabled status', { placeholder: 'Disabled status', value: 'paused', disabled: true })
  add('Authored empty status', {
    placeholder: 'Must not replace business label',
    allowClear: true,
    value: '',
    options: [
      { label: 'Ready', value: 'ready' },
      { label: 'All statuses', value: '', disabled: true }
    ]
  })
  const dynamic = add('Dynamic status', {
    placeholder: 'Choose dynamic status',
    allowClear: true,
    optionsSource: {
      kind: 'ref',
      stateId: 'choices',
      itemName: 'choiceOption',
      valueExpr: 'choiceOption.id',
      labelExpr: 'choiceOption.label'
    }
  })
  graph.updateNode(dynamic.id, { bindings: { value: { kind: 'ref', stateId: 'dynamic' } } })
  add('Colored kit status', { value: 'ready', textColor: '#123456' })
  for (const [name, valueExpr] of [
    ['Add business empty', 'withEmpty'],
    ['Remove business empty', 'withoutEmpty']
  ]) {
    graph.createNode('BUTTON', root.id, {
      name,
      width: 400,
      height: 36,
      interactiveProps: { text: name },
      events: {
        onClick: [{ id: 'fixture-action-1', kind: 'setState', targetStateId: 'choices', valueExpr }]
      }
    })
  }
  graph.createNode('TEXT', root.id, {
    width: 400,
    height: 32,
    text: 'State feedback',
    bindings: {
      text: { kind: 'expr', expr: '"Selected[" + choice + "] Dynamic[" + dynamic + "]"' }
    }
  })
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      ...(shadcn ? { uiKit: 'shadcn' } : {}),
      devMode: false,
      router: 'none'
    })
  })
  const unexpected = output.warnings.filter(({ code }) => code !== 'ui-kit-native-control-fallback')
  if (unexpected.length) throw new Error(JSON.stringify(unexpected))
  return { files: [...output.files], warnings: output.warnings }
}
