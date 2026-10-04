import { compile, withDefaults } from '@open-pencil/compiler'
import { type SceneNode } from '@open-pencil/scene-graph'

import { applicationModeFixture } from '../application-mode/fixture'

const HEADER_SIZE = {
  mobile: { title: 160, count: 130, gap: 12, padding: 16 },
  desktop: { title: 350, count: 170, gap: 24, padding: 20 }
}

/** Editable desktop and phone layout examples share exactly the same optional shell policy. */
export function applicationShellFixture(
  device: 'desktop' | 'mobile' = 'desktop',
  configured = true
) {
  const fixture = applicationModeFixture(true)
  const { graph, reference } = fixture
  for (const page of [fixture.home, fixture.products])
    graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'responsive' } })
  const mobile = device === 'mobile'
  const columnWidth = mobile ? 390 : 980
  const headerSize = HEADER_SIZE[device]
  const shell = graph.createNode('FRAME', reference.id, {
    name: mobile ? 'Phone shared layout' : 'Desktop shared layout',
    x: 800,
    y: 500,
    width: mobile ? 390 : 1200,
    height: mobile ? 844 : 900,
    layoutMode: mobile ? 'VERTICAL' : 'HORIZONTAL',
    fills: [
      { type: 'SOLID', color: { r: 0.95, g: 0.96, b: 0.98, a: 1 }, opacity: 1, visible: true }
    ]
  })
  function label(owner: SceneNode, text: string, width: number, height = 32) {
    return graph.createNode('TEXT', owner.id, {
      name: text,
      text,
      width,
      height,
      fontSize: 20,
      fills: [
        { type: 'SOLID', color: { r: 0.12, g: 0.16, b: 0.25, a: 1 }, opacity: 1, visible: true }
      ]
    })
  }
  function nav(owner: SceneNode, text: string, to: string) {
    return graph.createNode('BUTTON', owner.id, {
      name: text,
      width: mobile ? 170 : 180,
      height: 48,
      interactiveProps: { text },
      events: { onClick: [{ id: `shell-nav-${owner.id}-${to}`, kind: 'navigate', to }] },
      cornerRadius: 12,
      fills: [
        { type: 'SOLID', color: { r: 0.2, g: 0.36, b: 0.9, a: 1 }, opacity: 1, visible: true }
      ]
    })
  }
  const column = mobile
    ? shell
    : graph.createNode('FRAME', shell.id, {
        name: 'Page column',
        width: 980,
        height: 900,
        layoutMode: 'VERTICAL',
        counterAxisSizing: 'FILL',
        primaryAxisSizing: 'FILL'
      })
  const header = graph.createNode('FRAME', column.id, {
    name: 'Shared header',
    width: columnWidth,
    height: 80,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FILL',
    itemSpacing: headerSize.gap,
    paddingLeft: headerSize.padding,
    paddingRight: headerSize.padding,
    paddingTop: 20
  })
  label(header, mobile ? 'Mobile workspace' : 'OpenPencil workspace', headerSize.title)
  const count = label(header, 'Workspace: 0', headerSize.count)
  graph.updateNode(count.id, {
    bindings: { text: { kind: 'expr', expr: '"Workspace: " + sharedCount' } }
  })
  const slot = graph.createNode('FRAME', column.id, {
    name: 'Page content',
    width: columnWidth,
    height: mobile ? 684 : 820,
    layoutMode: 'VERTICAL',
    counterAxisSizing: 'FILL',
    primaryAxisSizing: 'FILL'
  })
  const navigation = graph.createNode('FRAME', shell.id, {
    name: mobile ? 'Bottom navigation' : 'Desktop sidebar',
    width: mobile ? 390 : 220,
    height: mobile ? 80 : 900,
    layoutMode: mobile ? 'HORIZONTAL' : 'VERTICAL',
    itemSpacing: 12,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.92, b: 0.98, a: 1 }, opacity: 1, visible: true }]
  })
  if (!mobile) {
    label(navigation, 'Workspace', 180)
    graph.reorderChild(navigation.id, shell.id, 0)
  }
  nav(navigation, 'Home', '/home')
  nav(navigation, 'Products', '/products')
  if (configured) {
    const root = graph.getNode(graph.rootId)
    if (!root?.lowcodeApplication) throw new Error('Fixture application policy missing')
    graph.updateNode(root.id, {
      lowcodeApplication: {
        ...root.lowcodeApplication,
        shell: { frameNodeId: shell.id, slotNodeId: slot.id }
      }
    })
  }
  return { ...fixture, shell, slot, header, navigation, count }
}

export function compileApplicationShellFixture(
  target: 'react' | 'vue' | 'flutter',
  device: 'desktop' | 'mobile'
) {
  const { graph } = applicationShellFixture(device)
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
      packageName: 'openpencil_shared_layout',
      productName: 'Shared layout examples'
    })
  })
}
