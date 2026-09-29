import { compile, withDefaults } from '@open-pencil/compiler'
import { createRatingModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function remoteModuleResetFixture() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'score', name: 'score', type: 'number', defaultValue: 2 },
      { id: 'submitted', name: 'submitted', type: 'number', defaultValue: 0 }
    ]
  })
  const form = graph.createNode('FORM', page.id, {
    width: 320,
    height: 200,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    events: {
      onSubmit: [{ kind: 'setState', targetStateId: 'submitted', valueExpr: 'submitted + 1' }]
    }
  })
  const rating = createRatingModuleFrameOverrides({ label: 'Remote score' })
  graph.createNode('FRAME', form.id, {
    ...rating,
    bindings: { value: { kind: 'ref', stateId: 'score' } },
    interactiveProps: {
      ...rating.interactiveProps,
      lang: 'en',
      validation: {
        required: true,
        async: {
          url: 'https://validation.example.test/module-reset',
          method: 'POST',
          message: 'Remote rejection'
        }
      }
    }
  })
  graph.createNode('BUTTON', form.id, {
    width: 320,
    height: 44,
    interactiveProps: { text: 'Submit' }
  })
  graph.createNode('TEXT', form.id, {
    width: 320,
    height: 30,
    text: 'State',
    bindings: { text: { kind: 'expr', expr: '"Score:" + score + "; Submitted:" + submitted' } }
  })
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target: 'react', router: 'none', devMode: false })
  })
}
