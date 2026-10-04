import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

/** The same document exercises design mode, editor setup and generated runtimes. */
export function applicationModeFixture(enabled = false) {
  const graph = new SceneGraph()
  const reference = graph.getPages()[0]
  graph.updateNode(reference.id, {
    name: 'Reference',
    lowcodeApplicationPage: { version: 1, role: 'reference' }
  })
  graph.createNode('TEXT', reference.id, {
    name: 'Reference only',
    text: 'REFERENCE ONLY',
    width: 280,
    height: 48
  })
  const home = graph.addPage('Home')
  const products = graph.addPage('Products')
  graph.updateNode(graph.rootId, {
    lowcodeApplication: { version: 1, enabled, startPageId: home.id },
    lowcodeDocumentState: [
      { id: 'shared-count', name: 'sharedCount', type: 'number', defaultValue: 0 }
    ]
  })
  function entry(page: SceneNode, route: string) {
    const frame = graph.createNode('FRAME', page.id, {
      name: `${page.name} entry`,
      x: 1200,
      y: 600,
      width: 360,
      height: 640,
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      paddingTop: 24,
      paddingLeft: 24,
      paddingRight: 24,
      paddingBottom: 24
    })
    graph.updateNode(page.id, {
      lowcodeRoutePattern: route,
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: frame.id }
    })
    graph.createNode('TEXT', frame.id, {
      name: `${page.name} title`,
      text: `${page.name} screen`,
      width: 312,
      height: 40,
      fontSize: 24
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Shared counter',
      text: 'Shared count: 0',
      width: 312,
      height: 32,
      fontSize: 18,
      bindings: { text: { kind: 'expr', expr: '"Shared count: " + sharedCount' } }
    })
    return frame
  }
  const homeEntry = entry(home, '/home')
  const productsEntry = entry(products, '/products')
  const outside = graph.createNode('FRAME', home.id, {
    name: 'Design notes',
    x: -600,
    y: -300,
    width: 480,
    height: 200
  })
  graph.createNode('TEXT', outside.id, {
    name: 'Outside entry',
    text: 'OUTSIDE ENTRY',
    width: 400,
    height: 48
  })
  const increment = graph.createNode('BUTTON', homeEntry.id, {
    name: 'Increment shared count',
    width: 312,
    height: 48,
    interactiveProps: { text: 'Increment shared count' },
    events: {
      onClick: [{ kind: 'setVariable', targetName: 'sharedCount', valueExpr: '$prev + 1' }]
    }
  })
  function navigate(owner: SceneNode, text: string, to: string) {
    return graph.createNode('BUTTON', owner.id, {
      name: text,
      width: 312,
      height: 48,
      interactiveProps: { text },
      events: { onClick: [{ kind: 'navigate', to }] }
    })
  }
  const toProducts = navigate(homeEntry, 'Open products', '/products')
  const toHome = navigate(productsEntry, 'Return home', '/home')
  return {
    graph,
    reference,
    home,
    products,
    homeEntry,
    productsEntry,
    outside,
    increment,
    toProducts,
    toHome
  }
}

export function compileApplicationModeFixture(target: 'react' | 'vue' | 'flutter') {
  const { graph } = applicationModeFixture(true)
  const routers = {
    react: 'react-router-v6',
    vue: 'vue-router-v4',
    flutter: 'flutter-router'
  } as const
  return compile({
    graph,
    pageIds: graph.getPages().map((page) => page.id),
    options: withDefaults({
      target,
      router: routers[target],
      devMode: true,
      packageName: 'openpencil_application_acceptance',
      productName: 'Application mode acceptance'
    })
  })
}
