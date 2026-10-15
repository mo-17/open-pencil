import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export function colorInputGraph() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'color', name: 'color', type: 'string', defaultValue: '#2563eb' },
      { id: 'submits', name: 'submits', type: 'number', defaultValue: 0 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'docColor', name: 'docColor', type: 'string', defaultValue: '#ea580c' }
    ]
  })
  const form = graph.createNode('FORM', page.id, {
    name: 'Color form',
    width: 340,
    height: 650,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    paddingLeft: 12,
    paddingTop: 12,
    events: {
      onSubmit: [
        {
          id: 'fixture-action-1',
          kind: 'setState',
          targetStateId: 'submits',
          valueExpr: 'submits + 1'
        }
      ]
    }
  })
  const field = (label: string, props: JSONObject) =>
    graph.createNode('INPUT', form.id, {
      name: label,
      width: 300,
      height: 44,
      paddingLeft: 12,
      paddingRight: 12,
      fontSize: 16,
      interactiveProps: { inputType: 'color', ariaLabel: label, ...props }
    })
  const color = field('Primary color', {
    validation: {
      required: true,
      messages: { required: 'Choose a color', pattern: 'Use six hex digits' }
    }
  })
  graph.updateNode(color.id, { bindings: { value: { kind: 'ref', stateId: 'color' } } })
  const doc = field('Document color', {})
  graph.updateNode(doc.id, { bindings: { value: { kind: 'docState', docStateName: 'docColor' } } })
  field('Read only color', { value: '#112233', readOnly: true })
  field('Disabled color', { value: '#998877', disabled: true })
  field('Uncontrolled color', { value: '#abcdef' })
  const button = (text: string, valueExpr?: string) =>
    graph.createNode('BUTTON', form.id, {
      width: 300,
      height: 36,
      interactiveProps: { text },
      ...(valueExpr
        ? {
            events: {
              onClick: [{ id: text, kind: 'setState' as const, targetStateId: 'color', valueExpr }]
            }
          }
        : {})
    })
  button('Empty color', '""')
  button('Invalid color', '"not-a-color"')
  button('Submit colors')
  graph.createNode('TEXT', form.id, {
    width: 300,
    height: 50,
    text: 'Colors',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Color[" + color + "] Doc[" + docColor + "] Submitted[" + submits + "]"'
      }
    }
  })
  return { graph, page, color, doc, form }
}
export function colorInputFixture(target: 'react' | 'vue') {
  const { graph, page } = colorInputGraph()
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, devMode: false, router: 'none', sourceLocale: 'en' })
  })
  if (result.warnings.length) throw new Error(JSON.stringify(result.warnings))
  return { files: [...result.files] }
}
