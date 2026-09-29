import { compile, withDefaults } from '@open-pencil/compiler'
import { createOrgChartModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function orgChartGraph() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const main = graph.createNode('FRAME', page.id, {
    ...createOrgChartModuleFrameOverrides({ label: 'Organization' }),
    name: 'Organization',
    width: 640,
    height: 400
  })
  return { graph, page, main }
}
export function orgChartFixture(target: 'react' | 'vue') {
  const { graph, page } = orgChartGraph()
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: 'en' })
  })
}
