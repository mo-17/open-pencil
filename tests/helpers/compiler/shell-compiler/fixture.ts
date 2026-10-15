import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneNode } from '@open-pencil/scene-graph'

import { applicationModeFixture } from '../application-mode/fixture'

export function applicationShellFixture() {
  const fixture = applicationModeFixture(true)
  const { graph, reference } = fixture
  const shell = graph.createNode('FRAME', reference.id, {
    name: 'Application shell',
    x: 2100,
    y: 700,
    width: 960,
    height: 720,
    layoutMode: 'HORIZONTAL',
    responsiveOverrides: {
      compact: { layoutMode: 'VERTICAL', width: 360, height: 720, x: 100, y: 200 }
    }
  })
  const sidebar = graph.createNode('FRAME', shell.id, {
    name: 'Shared sidebar',
    width: 200,
    height: 720,
    layoutMode: 'VERTICAL',
    responsiveOverrides: { compact: { visible: false } }
  })
  graph.createNode('TEXT', sidebar.id, { text: 'Shared navigation', width: 180, height: 32 })
  function nav(owner: SceneNode, text: string, to: string) {
    return graph.createNode('BUTTON', owner.id, {
      name: text,
      width: 180,
      height: 48,
      interactiveProps: { text },
      events: { onClick: [{ id: 'fixture-action-1', kind: 'navigate', to }] }
    })
  }
  const toHome = nav(sidebar, 'Shell Home', '/home')
  const toProducts = nav(sidebar, 'Shell Products', '/products')
  const column = graph.createNode('FRAME', shell.id, {
    name: 'Application column',
    width: 760,
    height: 720,
    layoutMode: 'VERTICAL',
    responsiveOverrides: { compact: { width: 360 } }
  })
  const header = graph.createNode('FRAME', column.id, {
    name: 'Shared header',
    width: 760,
    height: 80,
    layoutMode: 'VERTICAL',
    responsiveOverrides: { compact: { width: 360 } }
  })
  const shellTitle = graph.createNode('TEXT', header.id, {
    name: 'Shared title',
    text: 'Application header',
    width: 320,
    height: 32,
    fontFamily: 'ApplicationShellFont'
  })
  const shellCounter = graph.createNode('TEXT', header.id, {
    name: 'Shell count',
    text: 'Shell count: 0',
    width: 320,
    height: 32,
    bindings: { text: { kind: 'expr', expr: '"Shell count: " + sharedCount' } }
  })
  const slot = graph.createNode('FRAME', column.id, {
    name: 'Application content slot',
    width: 760,
    height: 640,
    layoutMode: 'VERTICAL',
    responsiveOverrides: { compact: { width: 360 } }
  })
  const root = graph.getNode(graph.rootId)
  if (!root?.lowcodeApplication) throw new Error('Fixture application policy is unavailable')
  graph.updateNode(root.id, {
    lowcodeApplication: {
      ...root.lowcodeApplication,
      shell: { frameNodeId: shell.id, slotNodeId: slot.id }
    }
  })
  for (const page of [fixture.home, fixture.products])
    graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'responsive' } })
  return {
    ...fixture,
    shell,
    sidebar,
    column,
    header,
    slot,
    shellTitle,
    shellCounter,
    shellToHome: toHome,
    shellToProducts: toProducts
  }
}

export function compileApplicationShellFixture(target: 'react' | 'vue' | 'flutter') {
  const { graph } = applicationShellFixture()
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
      devMode: false,
      packageName: 'openpencil_application_shell'
    })
  })
}
