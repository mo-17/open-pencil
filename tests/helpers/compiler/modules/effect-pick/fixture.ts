import { compile, withDefaults } from '@open-pencil/compiler'
import {
  EFFECT_PICK_CATALOG,
  createEffectPickModuleFrameOverrides,
  type EffectPickConfigV1
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

function config(id: string): EffectPickConfigV1 {
  const entry = EFFECT_PICK_CATALOG.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`Missing effect ${id}`)
  return { ...entry.defaultConfig }
}

export function effectPickExportFixture(target: 'react' | 'vue') {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'effect-click-count', name: 'effectClicks', type: 'number', defaultValue: 0 }
    ]
  })
  graph.createNode('FRAME', page.id, {
    ...createEffectPickModuleFrameOverrides({
      ...config('diagonal-fill'),
      text: 'Count effect clicks'
    }),
    x: 20,
    y: 20,
    width: 320,
    height: 180,
    events: {
      onClick: [
        {
          id: 'effect-clicked',
          kind: 'setVariable',
          targetName: 'effectClicks',
          valueExpr: '$prev + 1'
        }
      ]
    }
  })
  graph.createNode('FRAME', page.id, {
    ...createEffectPickModuleFrameOverrides(config('diagonal-fill')),
    x: 380,
    y: 20,
    width: 224,
    height: 101
  })
  graph.createNode('FRAME', page.id, {
    ...createEffectPickModuleFrameOverrides({ ...config('water-text'), text: 'Other instance' }),
    x: 20,
    y: 220,
    width: 320,
    height: 180
  })
  graph.createNode('TEXT', page.id, {
    name: 'Effect click result',
    x: 20,
    y: 450,
    width: 320,
    height: 30,
    text: 'Effect clicks: 0',
    bindings: { text: { kind: 'expr', expr: '"Effect clicks: " + effectClicks' } }
  })
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, packageName: 'effect-pick-export-browser', devMode: false })
  })
}
