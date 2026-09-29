import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export function timeInputFixture(target: 'react' | 'vue') {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'appointment', name: 'appointment', type: 'string', defaultValue: '09:30:15' },
      { id: 'submits', name: 'submits', type: 'number', defaultValue: 0 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'remembered', name: 'rememberedTime', type: 'string', defaultValue: '21:00' }
    ]
  })
  const form = graph.createNode('FORM', page.id, {
    width: 340,
    height: 650,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    paddingLeft: 12,
    paddingTop: 12,
    events: { onSubmit: [{ kind: 'setState', targetStateId: 'submits', valueExpr: 'submits + 1' }] }
  })
  const field = (label: string, props: JSONObject) =>
    graph.createNode('INPUT', form.id, {
      name: label,
      width: 300,
      height: 44,
      paddingLeft: 12,
      paddingRight: 12,
      fontSize: 16,
      interactiveProps: { inputType: 'time', ariaLabel: label, ...props }
    })
  const appointment = field('预约时间', {
    min: '08:00',
    max: '18:00',
    step: 15,
    validation: { required: true, messages: { required: '请选择预约时间' } }
  })
  graph.updateNode(appointment.id, { bindings: { value: { kind: 'ref', stateId: 'appointment' } } })
  const documentTime = field('Document time', {})
  graph.updateNode(documentTime.id, {
    bindings: { value: { kind: 'docState', docStateName: 'rememberedTime' } }
  })
  field('Night shift', { value: '23:00', min: '22:00', max: '02:00' })
  field('Read only time', { value: '10:00', readOnly: true })
  field('Disabled time', { value: '11:00', disabled: true })
  field('Uncontrolled time', { value: '12:00' })
  graph.createNode('BUTTON', form.id, {
    width: 300,
    height: 44,
    interactiveProps: { text: 'Clear time' },
    events: { onClick: [{ kind: 'setState', targetStateId: 'appointment', valueExpr: '""' }] }
  })
  graph.createNode('BUTTON', form.id, {
    width: 300,
    height: 44,
    interactiveProps: { text: 'Submit time' }
  })
  graph.createNode('TEXT', form.id, {
    width: 300,
    height: 70,
    text: 'Time state',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Time[" + appointment + "] Doc[" + rememberedTime + "] Submitted[" + submits + "]"'
      }
    }
  })
  const output = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, devMode: false, router: 'none' })
  })
  if (output.warnings.length) throw new Error(JSON.stringify(output.warnings))
  return { files: [...output.files] }
}
