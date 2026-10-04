import { describe, expect, test } from 'bun:test'

import { compile, withDefaults, type CompilerTarget } from '@open-pencil/compiler'
import { resolveCompilerApplicationScope } from '@open-pencil/compiler/ir/application/projection'
import { fillApplicationShellEntry } from '@open-pencil/compiler/ir/application/shell-projection'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRNode } from '@open-pencil/compiler/ir/types'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  applicationShellFixture,
  compileApplicationShellFixture
} from '#tests/helpers/compiler/shell-compiler/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function sources(output: ReturnType<typeof compile>) {
  return new Map(
    [...output.files].filter((item): item is [string, string] => typeof item[1] === 'string')
  )
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected compiler fixture value is unavailable')
  return value
}
function element(
  nodes: readonly IRNode[],
  id: string
): Extract<IRNode, { kind: 'element' }> | undefined {
  for (const node of nodes) {
    if (node.kind === 'element') {
      if (node.sourceId === id) return node
      const found = element(node.children, id)
      if (found) return found
    }
    if (node.kind === 'conditional') {
      const found = element([node.consequent], id)
      if (found) return found
    }
    if (node.kind === 'list') {
      const found = element([node.template], id)
      if (found) return found
    }
  }
}

describe('optional application shell compiler', () => {
  test('builds independent read projections with original IDs and one outer viewport without graph mutations', () => {
    const f = applicationShellFixture()
    const before = JSON.stringify([...f.graph.getAllNodes()])
    f.graph.getAbsolutePosition(f.shell.id) // An existing canvas cache cannot contaminate compiled positions.
    const scope = resolveCompilerApplicationScope(
      f.graph,
      f.graph.getPages().map((page) => page.id)
    )
    expect(scope.blocked).toBe(false)
    expect(scope.getPageGraph).toBeDefined()
    for (const [page, entry] of [
      [f.home, f.homeEntry],
      [f.products, f.productsEntry]
    ]) {
      const view = required(scope.getPageGraph)(page.id)
      expect(view.getChildren(page.id).map((node) => node.id)).toEqual([f.shell.id])
      expect(view.getChildren(f.slot.id).map((node) => node.id)).toEqual([entry.id])
      expect(view.getNode(entry.id)).toMatchObject({
        parentId: f.slot.id,
        x: 0,
        y: 0,
        layoutPositioning: 'AUTO',
        counterAxisSizing: entry.counterAxisSizing
      })
      expect(view.getPageId(f.shellCounter.id)).toBe(page.id)
      expect(view.isDescendant(entry.id, f.shell.id)).toBe(true)
      expect(view.getAbsolutePosition(f.shell.id)).toEqual({ x: 0, y: 0 })
      expect(view.getNode(f.reference.id)?.childIds).not.toContain(f.shell.id)
      expect([...view.getAllNodes()].find((node) => node.id === f.slot.id)?.childIds).toEqual([
        entry.id
      ])
      const tree = required(scope.projectTree)(
        page.id,
        collectTree(
          view,
          page.id,
          undefined,
          false,
          undefined,
          undefined,
          undefined,
          undefined,
          scope.shellNodeIds
        )
      )
      expect(tree.pageViewport).toMatchObject({
        mode: 'responsive',
        designWidth: 960,
        designHeight: 720,
        originX: 0,
        originY: 0
      })
      expect(element(tree.children, entry.id)?.layout).toMatchObject({
        parentType: 'FRAME',
        parentLayoutMode: 'VERTICAL',
        position: 'flow',
        widthSizing: 'FILL'
      })
      expect(element(tree.children, f.shellCounter.id)).toBeDefined()
      expect(tree.docStateReads).toContain('sharedCount')
    }
    expect(scope.fontNodeIds).toContain(f.shell.id)
    expect(JSON.stringify([...f.graph.getAllNodes()])).toBe(before)
  })

  for (const target of ['react', 'vue', 'flutter'] as const) {
    test(`${target} emits shared header/navigation and independent page entries`, () => {
      const output = compileApplicationShellFixture(target)
      expect(output.files.size).toBeGreaterThan(0)
      expect(output.warnings.filter((warning) => warning.code.startsWith('application-'))).toEqual(
        []
      )
      const source = [...sources(output).values()].join('\n')
      for (const value of [
        'Application header',
        'Shared navigation',
        'Home screen',
        'Products screen',
        'Shell count: '
      ])
        expect(source).toContain(value)
      expect(source).not.toContain('REFERENCE ONLY')
      expect(source).not.toContain('OUTSIDE ENTRY')
      if (target !== 'flutter')
        typeCheckCompilerFiles(
          sources(output),
          target,
          target === 'react'
            ? { preserveSymlinks: true, extraDependencies: ['react-router', '@remix-run/router'] }
            : {}
        )
    }, 60000)
  }

  test.each([
    'react',
    'vue',
    'flutter',
    'expo',
    'wechat-miniprogram',
    'taro',
    'uni-app',
    'mpx'
  ] satisfies CompilerTarget[])(
    '%s leaves design-mode output byte-identical when shell metadata is disabled',
    (target) => {
      const { graph } = applicationShellFixture()
      graph.updateNode(graph.rootId, { lowcodeApplication: { version: 1, enabled: false } })
      const options = withDefaults({ target, packageName: 'legacy-shell' })
      const pages = graph.getPages().map((page) => page.id)
      const baseline = compile({ graph, pageIds: pages, options })
      const shell = graph.getAllNodes()
      const frame = required([...shell].find((node) => node.name === 'Application shell'))
      const slot = required(
        [...graph.getAllNodes()].find((node) => node.name === 'Application content slot')
      )
      graph.updateNode(graph.rootId, {
        lowcodeApplication: {
          version: 1,
          enabled: false,
          shell: { frameNodeId: frame.id, slotNodeId: slot.id }
        }
      })
      const disabled = compile({ graph, pageIds: pages, options })
      expect([...disabled.files]).toEqual([...baseline.files])
      expect(disabled.warnings).toEqual(baseline.warnings)
    }
  )

  test('rejects shell bindings that accidentally match route-local state', () => {
    const f = applicationShellFixture()
    f.graph.updateNode(f.home.id, {
      state: [{ id: 'local', name: 'localOnly', type: 'string', defaultValue: 'private' }]
    })
    f.graph.updateNode(f.shellCounter.id, {
      bindings: { text: { kind: 'expr', expr: 'localOnly' } }
    })
    const output = compile({
      graph: f.graph,
      pageIds: f.graph.getPages().map((page) => page.id),
      options: withDefaults({ target: 'react', router: 'react-router-v6' })
    })
    expect(output.files.size).toBe(0)
    expect(
      output.warnings.some(
        (warning) =>
          warning.code === 'application-shell-behavior-invalid' &&
          warning.nodeId === f.shellCounter.id
      )
    ).toBe(true)
  })

  test('fills physical entry widths while preserving every responsive effective height', () => {
    const f = applicationShellFixture()
    f.graph.updateNode(f.homeEntry.id, {
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED',
      responsiveOverrides: {
        sm: { height: 600 },
        md: { layoutMode: 'HORIZONTAL', height: 580 },
        lg: { counterAxisSizing: 'HUG', height: 560 },
        compact: { x: 200, y: 300 }
      }
    })
    const scope = resolveCompilerApplicationScope(
      f.graph,
      f.graph.getPages().map((page) => page.id)
    )
    const original = collectTree(f.graph, f.home.id)
    const collected = collectTree(
      required(scope.getPageGraph)(f.home.id),
      f.home.id,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      scope.shellNodeIds
    )
    const projected = required(scope.projectTree)(f.home.id, collected)
    const before = required(element(original.children, f.homeEntry.id))
    const after = required(element(projected.children, f.homeEntry.id))
    expect(after.layout?.heightSizing).toBe(before.layout?.heightSizing)
    expect(after.layout?.height).toBe(before.layout?.height)
    expect(after.layout?.widthSizing).toBe('FILL')
    expect(after.className.split(/\s+/).filter((token) => /^(?:[^:]+:)*w-/.test(token))).toEqual([
      'w-full'
    ])
    for (const range of required(after.responsiveLayout)) {
      const prior = required(
        required(before.responsiveLayout).find((item) => item.minWidth === range.minWidth)
      )
      expect(range.layout.heightSizing).toBe(prior.layout.heightSizing)
      expect(range.layout.height).toBe(prior.layout.height)
      expect(range.layout.widthSizing).toBe('FILL')
      expect(range.className).toContain('w-full')
      expect(range.layout.position).toBe('flow')
      expect(range.layout.x).toBe(0)
    }
  })

  test('page state remains available inside content entries and is rejected in shared shell nodes', () => {
    const f = applicationShellFixture()
    f.graph.updateNode(f.home.id, {
      state: [{ id: 'local', name: 'localOnly', type: 'string', defaultValue: 'private' }]
    })
    const label = f.graph.createNode('TEXT', f.homeEntry.id, {
      text: 'Private',
      width: 200,
      height: 32,
      bindings: { text: { kind: 'expr', expr: 'localOnly' } }
    })
    const scope = resolveCompilerApplicationScope(
      f.graph,
      f.graph.getPages().map((page) => page.id)
    )
    const tree = collectTree(
      required(scope.getPageGraph)(f.home.id),
      f.home.id,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      scope.shellNodeIds
    )
    expect(
      element(tree.children, label.id)?.children.some((node) => node.kind === 'expression')
    ).toBe(true)
    expect(tree.docStateReads).toContain('sharedCount')
    expect(tree.states.some((state) => state.name === 'localOnly')).toBe(true)
    expect(
      tree.warnings.filter(
        (warning) => warning.nodeId === label.id || warning.nodeId === f.shellCounter.id
      )
    ).toEqual([])
    f.graph.updateNode(f.home.id, {
      state: [{ id: 'collision', name: 'sharedCount', type: 'number', defaultValue: 99 }]
    })
    const blocked = compile({
      graph: f.graph,
      pageIds: f.graph.getPages().map((page) => page.id),
      options: withDefaults({ target: 'react', router: 'react-router-v6' })
    })
    expect(blocked.files.size).toBe(0)
    expect(
      blocked.warnings.some(
        (warning) =>
          warning.code === 'application-shell-behavior-invalid' &&
          warning.nodeId === f.shellCounter.id
      )
    ).toBe(true)
  })

  test('fixed Flutter shells fill their bounded content width with one page scaffold and retain height', () => {
    const f = applicationShellFixture()
    for (const page of [f.home, f.products])
      f.graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'fixed' } })
    const output = compile({
      graph: f.graph,
      pageIds: f.graph.getPages().map((page) => page.id),
      options: withDefaults({
        target: 'flutter',
        router: 'flutter-router',
        packageName: 'fixed_shell'
      })
    })
    expect(output.files.has('lib/openpencil_page_viewport.dart')).toBe(true)
    expect(
      output.warnings.some(
        (warning) => warning.nodeId === f.homeEntry.id && warning.message.includes('w-full')
      )
    ).toBe(false)
    const home = required(
      [...sources(output)].find(
        ([path, source]) => path.startsWith('lib/pages/') && source.includes('Home screen')
      )
    )[1]
    expect(home).toContain("import '../openpencil_page_viewport.dart'")
    expect(home).toContain('OpenPencilFill(width: true, height: false')
    expect(home).toContain('height: 640')
    expect(home.match(/Scaffold\(/g)).toHaveLength(1)
    expect(home.match(/SingleChildScrollView\(/g)).toHaveLength(1)
  })

  test('ordinary fixed Flutter fills use semantic width while fixed pixels and unsupported diagnostics remain', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const fixed = graph.createNode('FRAME', page.id, {
      width: 320,
      height: 240,
      layoutMode: 'VERTICAL'
    })
    const fill = graph.createNode('FRAME', fixed.id, {
      width: 100,
      height: 80,
      layoutMode: 'VERTICAL',
      counterAxisSizing: 'FILL'
    })
    graph.createNode('RECTANGLE', fill.id, {
      width: 20,
      height: 20,
      interactiveProps: { aspectRatio: '3/2' }
    })
    const output = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target: 'flutter', packageName: 'fixed_fill' })
    })
    const source = [...sources(output).values()].join('\n')
    expect(source).toContain('OpenPencilFill(width: true, height: false')
    expect(source).toContain('width: 320, height: 240')
    expect(
      output.warnings.some(
        (warning) => warning.nodeId === fill.id && warning.message.includes('w-full')
      )
    ).toBe(false)
    expect(
      output.warnings.some(
        (warning) =>
          warning.code === 'flutter-style-unsupported' && warning.message.includes('aspect-[3/2]')
      )
    ).toBe(true)
    graph.updateNode(fill.id, { counterAxisSizing: 'FIXED' })
    const pixels = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target: 'flutter', packageName: 'fixed_fill' })
    })
    expect(pixels.files.has('lib/openpencil_page_viewport.dart')).toBe(false)
    expect([...sources(pixels).values()].join('\n')).not.toContain('OpenPencilFill(width:')
  })

  test('fixed horizontal Slots give FILL entries bounded flex constraints and a finite HUG fallback', () => {
    const f = applicationShellFixture()
    for (const page of [f.home, f.products])
      f.graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'fixed' } })
    f.graph.updateNode(f.slot.id, { layoutMode: 'HORIZONTAL' })
    const output = compile({
      graph: f.graph,
      pageIds: f.graph.getPages().map((page) => page.id),
      options: withDefaults({
        target: 'flutter',
        router: 'flutter-router',
        packageName: 'horizontal_fill',
        devMode: false
      })
    })
    const home = required(
      [...sources(output)].find(
        ([path, source]) => path.startsWith('lib/pages/') && source.includes('Home screen')
      )
    )[1]
    expect(home).toContain('OpenPencilFlex(axis: Axis.horizontal')
    expect(home).toContain('OpenPencilFlexItem(flex: 1000, child: LayoutBuilder')
    expect(home).toContain('constraints.hasBoundedWidth ? const BoxConstraints()')
    expect(home).toContain('const BoxConstraints.tightFor(width: 360), child: OpenPencilFill')
  })

  test('fixed root and absolute authored FILL frames constrain their original design width', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      x: 42,
      y: 24,
      width: 320,
      height: 240,
      layoutMode: 'VERTICAL',
      counterAxisSizing: 'FILL'
    })
    graph.createNode('TEXT', frame.id, { text: 'Absolute fill', width: 200, height: 32 })
    const output = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target: 'flutter', packageName: 'absolute_fill', devMode: false })
    })
    const source = [...sources(output).values()].join('\n')
    expect(source).toContain('Positioned(left: 42, top: 24, child: LayoutBuilder')
    expect(source).toContain(
      'const BoxConstraints.tightFor(width: 320), child: OpenPencilFill(width: true, height: false'
    )
    expect(source).toContain('height: 240')
    expect(source.match(/Text\("Absolute fill"/g)).toHaveLength(1)
  })

  test.each(['FORM', 'LIST'] as const)(
    'fails closed for unsupported shell container %s',
    (type) => {
      const f = applicationShellFixture()
      f.graph.createNode(type, f.sidebar.id, { width: 120, height: 80 })
      const output = compile({
        graph: f.graph,
        pageIds: f.graph.getPages().map((page) => page.id),
        options: withDefaults({ target: 'react', router: 'react-router-v6' })
      })
      expect(output.files.size).toBe(0)
      expect(
        output.warnings.some((warning) => warning.code === 'application-shell-behavior-invalid')
      ).toBe(true)
    }
  )

  test('retains reusable component dependencies and rejects invalid behavior in their bodies', () => {
    const f = applicationShellFixture()
    const badge = f.graph.createNode('COMPONENT', f.reference.id, {
      name: 'ShellBadge',
      width: 180,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    const label = f.graph.createNode('TEXT', badge.id, {
      text: 'Shared badge',
      width: 180,
      height: 40,
      bindings: { text: { kind: 'expr', expr: '"Shared badge: " + sharedCount' } }
    })
    f.graph.createNode('INSTANCE', f.sidebar.id, { componentId: badge.id, width: 180, height: 40 })
    const scope = resolveCompilerApplicationScope(
      f.graph,
      f.graph.getPages().map((page) => page.id)
    )
    expect(scope.shellNodeIds?.has(badge.id)).toBe(true)
    expect(scope.shellNodeIds?.has(label.id)).toBe(true)
    expect(scope.shellNodeIds?.has(f.reference.id)).toBe(false)
    for (const target of ['react', 'vue', 'flutter'] as const) {
      const routers = {
        react: 'react-router-v6',
        vue: 'vue-router-v4',
        flutter: 'flutter-router'
      } as const
      const output = compile({
        graph: f.graph,
        pageIds: f.graph.getPages().map((page) => page.id),
        options: withDefaults({ target, router: routers[target], packageName: 'shell_component' })
      })
      expect(output.files.size).toBeGreaterThan(0)
      expect([...sources(output).values()].join('\n')).toContain('Shared badge: ')
      expect([...output.files.keys()].some((path) => path.includes('/components/'))).toBe(true)
    }
    f.graph.updateNode(label.id, { bindings: { text: { kind: 'expr', expr: 'missingPageState' } } })
    const rejected = compile({
      graph: f.graph,
      pageIds: f.graph.getPages().map((page) => page.id),
      options: withDefaults({ target: 'react', router: 'react-router-v6' })
    })
    expect(rejected.files.size).toBe(0)
    expect(
      rejected.warnings.some(
        (warning) =>
          warning.code === 'application-shell-behavior-invalid' && warning.nodeId === label.id
      )
    ).toBe(true)
  })

  test('never permits an image-bearing Slot or ancestor to collapse application entry children', () => {
    for (const location of ['slot', 'column', 'shell'] as const) {
      const f = applicationShellFixture()
      f.graph.updateNode(f[location].id, {
        interactiveProps: { image: { src: 'https://example.com/shell.png' } }
      })
      const output = compile({
        graph: f.graph,
        pageIds: f.graph.getPages().map((page) => page.id),
        options: withDefaults({ target: 'react', router: 'react-router-v6' })
      })
      expect(output.files.size).toBe(0)
      expect(output.warnings.some((warning) => warning.code.startsWith('application-shell-'))).toBe(
        true
      )
    }
    const f = applicationShellFixture()
    const scope = resolveCompilerApplicationScope(
      f.graph,
      f.graph.getPages().map((page) => page.id)
    )
    const tree = collectTree(required(scope.getPageGraph)(f.home.id), f.home.id)
    const collapsed = fillApplicationShellEntry(
      { ...tree, children: [] },
      f.homeEntry.id,
      f.slot.id
    )
    expect(collapsed.warnings).toContainEqual(
      expect.objectContaining({ code: 'application-shell-behavior-invalid', nodeId: f.slot.id })
    )
  })
})
