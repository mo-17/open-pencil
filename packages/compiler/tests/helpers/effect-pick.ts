import { EFFECT_PICK_CATALOG, type EffectPickCatalogEntry } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function effectEntry(id: string): EffectPickCatalogEntry {
  const entry = EFFECT_PICK_CATALOG.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`Missing effect ${id}`)
  return entry
}

export function effectPickFixture() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'effect-click-count', name: 'effectClicks', type: 'number', defaultValue: 0 }
    ]
  })
  const selected = [effectEntry('diagonal-fill'), effectEntry('water-text')]
  for (const [index, effect] of selected.entries()) {
    graph.createNode('FRAME', page.id, {
      name: effect.title,
      x: 20,
      y: 20 + index * 200,
      width: 320,
      height: 180,
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'open-pencil.effect-pick',
          moduleType: 'effect-pick',
          configVersion: 1,
          config: {
            ...effect.defaultConfig,
            text: index === 0 ? 'Count effect clicks' : '__EP_INSTANCE__ < & 汉字'
          }
        }
      },
      ...(index === 0
        ? {
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
          }
        : {})
    })
  }
  graph.createNode('TEXT', page.id, {
    name: 'Effect click result',
    x: 20,
    y: 450,
    width: 320,
    height: 30,
    text: 'Effect clicks: 0',
    bindings: { text: { kind: 'expr', expr: '"Effect clicks: " + effectClicks' } }
  })
  return { graph, pageId: page.id, selected }
}
