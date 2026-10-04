import { describe, expect, test } from 'bun:test'

import {
  compile,
  withDefaults,
  type CompilerOptions,
  type CompilerOutput,
  type CompilerTarget
} from '@open-pencil/compiler'
import { resolveCompilerApplicationScope } from '@open-pencil/compiler/ir/application/projection'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  LOWCODE_APPLICATION_PLUGIN_KEY,
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY
} from '@open-pencil/lowcode'
import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

const MOTION: MotionSpec = {
  version: 1,
  reducedMotion: 'allow',
  tracks: [
    {
      id: 'enter',
      trigger: 'mount',
      keyframes: [
        { offset: 0, opacity: 0 },
        { offset: 1, opacity: 1 }
      ],
      timing: { durationMs: 100 }
    }
  ]
}

function fixture() {
  const graph = new SceneGraph()
  const reference = expectDefined(graph.getPages()[0], 'reference page')
  graph.updateNode(reference.id, {
    name: 'Reference',
    lowcodeApplicationPage: { version: 1, role: 'reference' }
  })
  graph.createNode('TEXT', reference.id, {
    text: 'Reference-only annotation',
    fontFamily: 'ReferenceFont'
  })
  const components = graph.addPage('Components')
  graph.updateNode(components.id, { lowcodeApplicationPage: { version: 1, role: 'components' } })
  const master = graph.createNode('COMPONENT', components.id, {
    name: 'Shared Badge',
    width: 80,
    height: 24,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', master.id, { text: 'Shared component label' })
  const home = graph.addPage('Home')
  const entry = graph.createNode('FRAME', home.id, {
    name: 'App entry',
    x: -620,
    y: 390,
    width: 360,
    height: 640,
    responsiveOverrides: { compact: { x: 700, y: -200 } }
  })
  graph.createNode('TEXT', entry.id, { text: 'Home application content', width: 240, height: 24 })
  const instance = expectDefined(graph.createInstance(master.id, entry.id), 'shared instance')
  const outside = graph.createNode('FRAME', home.id, {
    name: 'Design alternative',
    x: 5000,
    width: 600,
    height: 800,
    motion: MOTION
  })
  graph.createNode('TEXT', outside.id, {
    text: 'Outside-entry annotation',
    fontFamily: 'OutsideFont'
  })
  graph.updateNode(home.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: entry.id },
    state: [{ id: 'count', name: 'count', type: 'number', defaultValue: 4 }]
  })
  const details = graph.addPage('Details')
  const detailsEntry = graph.createNode('FRAME', details.id, {
    x: 1900,
    y: 300,
    width: 360,
    height: 640
  })
  graph.createNode('TEXT', detailsEntry.id, { text: 'Details application content' })
  graph.updateNode(details.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: detailsEntry.id }
  })
  graph.updateNode(graph.rootId, {
    lowcodeApplication: { version: 1, enabled: true },
    lowcodeDocumentState: [
      { id: 'shared', name: 'shared', type: 'string', defaultValue: 'document value' }
    ]
  })
  return {
    graph,
    reference,
    components,
    master,
    home,
    entry,
    instance,
    outside,
    details,
    detailsEntry
  }
}

function project(
  graph: SceneGraph,
  target: CompilerTarget = 'react',
  pageIds = graph.getPages().map((page) => page.id),
  extra: Partial<CompilerOptions> = {}
): CompilerOutput {
  return compile({
    graph,
    pageIds,
    options: withDefaults({
      packageName: 'application-fixture',
      target,
      router: target === 'flutter' ? 'flutter-router' : 'react-router-v6',
      devMode: false,
      ...extra
    })
  })
}

function textFiles(output: CompilerOutput): Map<string, string> {
  return new Map(
    [...output.files].flatMap(([path, value]) => (typeof value === 'string' ? [[path, value]] : []))
  )
}

function expectBlocked(output: CompilerOutput, code: string): void {
  expect(output.files.size).toBe(0)
  expect(output.warnings.some((warning) => warning.code === code)).toBe(true)
}

describe('explicit application compiler scope', () => {
  test('absent and disabled policies preserve complete source bytes and warnings for every target', () => {
    const { graph } = fixture()
    graph.restoreNodeProperties(graph.rootId, {}, ['lowcodeApplication'])
    const targets: CompilerTarget[] = [
      'react',
      'vue',
      'flutter',
      'expo',
      'wechat-miniprogram',
      'taro',
      'uni-app',
      'mpx'
    ]
    const baseline = targets.map((target) => project(graph, target))
    graph.updateNode(graph.rootId, {
      lowcodeApplication: { version: 1, enabled: false, startPageId: 'unused' }
    })
    targets.forEach((target, index) => {
      const disabled = project(graph, target)
      expect([...disabled.files]).toEqual([...baseline[index].files])
      expect(disabled.warnings).toEqual(baseline[index].warnings)
    })
  })

  test('projects only application entries without changing graph nodes, state or component lookup', () => {
    const { graph, home, entry, reference, master } = fixture()
    const original = JSON.stringify([...graph.getAllNodes()])
    const scope = resolveCompilerApplicationScope(
      graph,
      graph.getPages().map((page) => page.id)
    )
    expect(scope.blocked).toBe(false)
    expect(scope.pageIds).toHaveLength(2)
    expect(scope.graph.getNode(reference.id)).toBe(graph.getNode(reference.id))
    expect(scope.graph.getNode(master.id)).toBe(graph.getNode(master.id))
    expect(scope.graph.getChildren(home.id).map((node) => node.id)).toEqual([entry.id])
    const projected = expectDefined(scope.graph.getNode(entry.id), 'projected entry')
    expect([projected.x, projected.y]).toEqual([0, 0])
    expect(projected.responsiveOverrides?.compact).toMatchObject({ x: 0, y: 0 })
    expect(scope.graph.getNode(home.id)?.childIds).toEqual([entry.id])
    expect(scope.graph.getPageId(entry.id)).toBe(home.id)
    const ir = collectTree(scope.graph, home.id)
    expect(ir.states.map((state) => state.name)).toContain('count')
    expect(ir.docStates.map((state) => state.name)).toContain('shared')
    expect(JSON.stringify([...graph.getAllNodes()])).toBe(original)
  })

  for (const target of ['react', 'vue', 'flutter'] as const) {
    test(`${target} emits entry-only pages with reusable components from a components page`, () => {
      const { graph } = fixture()
      const output = project(graph, target)
      expect(output.files.size).toBeGreaterThan(0)
      expect(output.warnings.filter((warning) => warning.code.startsWith('application-'))).toEqual(
        []
      )
      const source = [...textFiles(output).values()].join('\n')
      expect(source).toContain('Home application content')
      expect(source).toContain('Details application content')
      expect(source).toContain('Shared component label')
      expect(source).not.toContain('Reference-only annotation')
      expect(source).not.toContain('Outside-entry annotation')
      expect(
        [...output.files.keys()].some(
          (path) => path.includes('components/') && path.toLowerCase().includes('shared')
        )
      ).toBe(true)
      if (target !== 'flutter')
        typeCheckCompilerFiles(
          textFiles(output),
          target,
          target === 'react'
            ? { preserveSymlinks: true, extraDependencies: ['react-router', '@remix-run/router'] }
            : {}
        )
    }, 60000)
  }

  test('selected start page is first and explicit web routes redirect root to that start', () => {
    const { graph, home, details } = fixture()
    graph.updateNode(home.id, { lowcodeRoutePattern: '/home' })
    graph.updateNode(details.id, { lowcodeRoutePattern: '/details' })
    graph.updateNode(graph.rootId, {
      lowcodeApplication: { version: 1, enabled: true, startPageId: details.id }
    })
    const scope = resolveCompilerApplicationScope(graph, [home.id, details.id])
    expect(scope.pageIds).toEqual([details.id, home.id])
    const react = project(graph)
    expect(react.files.get('src/App.tsx')).toContain('<Navigate to="/details" replace />')
    const vue = project(graph, 'vue')
    expect(vue.files.get('src/router.ts')).toContain('{ path: \'/\', redirect: "/details" }')
    const flutter = project(graph, 'flutter')
    expect(flutter.files.get('lib/main.dart')).toContain('initialRoute: "/details"')
    expect(flutter.files.get('lib/main.dart')).toContain('onGenerateInitialRoutes:')
    typeCheckCompilerFiles(textFiles(react), 'react', {
      preserveSymlinks: true,
      extraDependencies: ['react-router', '@remix-run/router']
    })
    typeCheckCompilerFiles(textFiles(vue), 'vue')
  }, 60000)

  test('one application page with a custom landing route still has a functional web router', () => {
    const { graph, home } = fixture()
    graph.updateNode(home.id, { lowcodeRoutePattern: '/home' })
    for (const target of ['react', 'vue'] as const) {
      const output = project(graph, target, [home.id])
      expect(output.files.size).toBeGreaterThan(0)
      const manifest = JSON.parse(
        expectDefined(textFiles(output).get('package.json'), 'package manifest')
      )
      expect(
        manifest.dependencies[target === 'react' ? 'react-router-dom' : 'vue-router']
      ).toBeDefined()
      typeCheckCompilerFiles(
        textFiles(output),
        target,
        target === 'react'
          ? { preserveSymlinks: true, extraDependencies: ['react-router', '@remix-run/router'] }
          : {}
      )
    }
  }, 60000)

  test('requested subsets remain restricted and an excluded explicit start fails closed', () => {
    const { graph, home, details } = fixture()
    const output = project(graph, 'react', [details.id])
    expect([...textFiles(output).values()].join('\n')).not.toContain('Home application content')
    graph.updateNode(graph.rootId, {
      lowcodeApplication: { version: 1, enabled: true, startPageId: home.id }
    })
    expectBlocked(project(graph, 'react', [details.id]), 'application-start-invalid')
  })

  test('missing, hidden, locked and non-direct entries never fall back to a whole page', () => {
    for (const change of [{ visible: false }, { locked: true }, { type: 'GROUP' as const }]) {
      const { graph, entry } = fixture()
      graph.updateNode(entry.id, change)
      expectBlocked(project(graph), 'application-entry-invalid')
    }
    const { graph, home, detailsEntry } = fixture()
    graph.updateNode(home.id, {
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: detailsEntry.id }
    })
    expectBlocked(project(graph), 'application-entry-invalid')
  })

  test('non-finite positions and empty entry geometry fail closed', () => {
    for (const change of [
      { x: Number.NaN },
      { y: Number.POSITIVE_INFINITY },
      { width: 0 },
      { height: -1 },
      { width: Number.NaN }
    ]) {
      const { graph, entry } = fixture()
      graph.updateNode(entry.id, change)
      expectBlocked(project(graph), 'application-entry-geometry-invalid')
    }
  })

  test('reserved inert policy keys fail closed even beside valid structural fields', () => {
    const { graph, home } = fixture()
    graph.updateNode(home.id, {
      pluginData: [
        {
          pluginId: 'open-pencil',
          key: LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
          value: '{"version":2}'
        }
      ]
    })
    expectBlocked(project(graph), 'application-page-inert')
    graph.updateNode(graph.rootId, {
      pluginData: [
        { pluginId: 'open-pencil', key: LOWCODE_APPLICATION_PLUGIN_KEY, value: '{"version":2}' }
      ]
    })
    expectBlocked(project(graph), 'application-inert')
  })

  test('prototype destinations and Motion action targets outside entries fail closed', () => {
    const { graph, entry, outside } = fixture()
    const button = graph.createNode('BUTTON', entry.id, {
      interactiveProps: { text: 'Outside target' },
      prototype: {
        version: 1,
        connections: [
          {
            id: 'outside',
            trigger: { kind: 'click' },
            action: { kind: 'navigate', targetNodeId: outside.id },
            transition: { kind: 'instant' }
          }
        ]
      }
    })
    expectBlocked(project(graph), 'application-reference-outside-entry')
    graph.restoreNodeProperties(button.id, {}, ['prototype'])
    graph.updateNode(button.id, {
      events: {
        onClick: [{ id: 'play', kind: 'playMotion', targetNodeId: outside.id, trackId: 'enter' }]
      }
    })
    expectBlocked(project(graph), 'application-reference-outside-entry')
  })

  test('page-owned Motion scenes cannot retain cues outside the selected entry', () => {
    const { graph, home, outside } = fixture()
    graph.updateNode(home.id, {
      motionScene: {
        version: 1,
        id: 'scene',
        sequences: [
          {
            id: 'enter',
            trigger: 'pageEnter',
            cues: [{ id: 'cue', targetNodeId: outside.id, trackId: 'enter', startMs: 0 }]
          }
        ]
      }
    })
    expectBlocked(project(graph), 'application-reference-outside-entry')
  })

  test('Motion references to non-emitted hidden targets fail closed but responsive re-show remains available', () => {
    const { graph, entry } = fixture()
    const target = graph.createNode('RECTANGLE', entry.id, { visible: false, motion: MOTION })
    graph.createNode('BUTTON', entry.id, {
      events: { onClick: [{ id: 'play', kind: 'playMotion', targetNodeId: target.id }] }
    })
    expectBlocked(project(graph), 'application-reference-outside-entry')
    graph.updateNode(target.id, { responsiveOverrides: { compact: { visible: true } } })
    const repaired = project(graph)
    expect(repaired.files.size).toBeGreaterThan(0)
    expect(
      repaired.warnings.some((warning) => warning.code === 'application-reference-outside-entry')
    ).toBe(false)
  })

  test('reachable workflows cannot navigate to an excluded reference-page route', () => {
    const { graph, entry } = fixture()
    graph.updateNode(graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'leave',
          name: 'Leave',
          actions: [{ id: 'navigate', kind: 'navigate', to: '/reference' }]
        }
      ]
    })
    graph.createNode('BUTTON', entry.id, {
      events: { onClick: [{ id: 'leave', kind: 'callWorkflow', workflowId: 'leave' }] }
    })
    expectBlocked(project(graph), 'application-navigate-target-unavailable')
  })

  test('invalid route patterns, parameterized landing and root-route conflicts fail closed', () => {
    const { graph, home, details } = fixture()
    graph.updateNode(home.id, { lowcodeRoutePattern: 'invalid' })
    expectBlocked(project(graph), 'application-route-invalid')
    graph.updateNode(home.id, { lowcodeRoutePattern: '/product/:id' })
    expectBlocked(project(graph), 'application-start-route-invalid')
    graph.updateNode(home.id, { lowcodeRoutePattern: '/app/*' })
    expectBlocked(project(graph), 'application-start-route-invalid')
    graph.updateNode(home.id, { lowcodeRoutePattern: '/home' })
    graph.updateNode(details.id, { lowcodeRoutePattern: '/' })
    expectBlocked(project(graph), 'application-start-route-conflict')
  })
})
