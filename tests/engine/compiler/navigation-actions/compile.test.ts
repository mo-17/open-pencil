import { describe, expect, test } from 'bun:test'

import {
  compile,
  withDefaults,
  type CompilerTarget,
  type CompilerRouter
} from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { auditLowcodeNavigation, validateLowcodeBackFallback } from '@open-pencil/lowcode'
import { SceneGraph, type ActionDef } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function fixture(actions: ActionDef[]) {
  const graph = new SceneGraph()
  const home = graph.getPages()[0]
  const details = graph.addPage('Details')
  graph.updateNode(home.id, {
    name: 'Home',
    lowcodeRoutePattern: '/home',
    state: [{ id: 'item', name: 'itemId', type: 'string', defaultValue: '42' }]
  })
  graph.updateNode(details.id, { lowcodeRoutePattern: '/details/:id' })
  const entry = graph.createNode('FRAME', home.id, {
    width: 360,
    height: 640,
    layoutMode: 'VERTICAL'
  })
  const button = graph.createNode('BUTTON', entry.id, {
    interactiveProps: { text: 'Navigation' },
    events: { onClick: actions },
    width: 240,
    height: 48
  })
  const detailEntry = graph.createNode('FRAME', details.id, {
    width: 360,
    height: 640,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', detailEntry.id, { text: 'Details content' })
  return { graph, home, details, entry, button }
}

function generate(target: CompilerTarget, actions: ActionDef[]) {
  const f = fixture(actions)
  const routers: Partial<Record<CompilerTarget, CompilerRouter>> = {
    react: 'react-router-v6',
    vue: 'vue-router-v4',
    flutter: 'flutter-router',
    expo: 'expo-router'
  }
  const router = routers[target] ?? 'none'
  const result = compile({
    graph: f.graph,
    pageIds: [f.home.id, f.details.id],
    options: withDefaults({ target, router, devMode: false })
  })
  return { ...f, result }
}

const replace: ActionDef = {
  id: 'replace',
  kind: 'navigate',
  to: '/details/:id?mode=edit#form',
  params: { id: 'itemId' },
  history: 'replace'
}
const back: ActionDef = { id: 'back', kind: 'back', fallback: '/home?category=active#list' }

describe('Authored navigation history actions', () => {
  test('IR preserves replacement metadata and parameter bindings without graph mutation', () => {
    const { graph, home, button } = fixture([replace, back])
    const before = structuredClone(button.events)
    const tree = collectTree(graph, home.id)
    const walk = JSON.stringify(tree.children)
    expect(walk).toContain('"history":"replace"')
    expect(walk).toContain('"kind":"back","fallback":"/home?category=active#list"')
    expect(walk).toContain('"name":"itemId"')
    expect(button.events).toEqual(before)
    expect(tree.warnings).toEqual([])
  })

  test.each(['react', 'vue'] as const)(
    '%s emits Back hooks and replacement for parameterized targets; generated source typechecks',
    (target) => {
      const { result } = generate(target, [replace, back])
      expect(result.warnings).toEqual([])
      const page = [...result.files.entries()].find(
        ([name]) => name === `src/pages/index.${target === 'react' ? 'tsx' : 'vue'}`
      )?.[1]
      expect(typeof page).toBe('string')
      expect(page).toContain('__opBack("/home?category=active#list")')
      expect(page).toContain(target === 'react' ? ', { replace: true }' : '__opRouter.replace(')
      expect(page).toContain('?mode=edit#form')
      expect(result.files.has('src/_application_navigation.ts')).toBe(true)
      const files = new Map<string, string>()
      for (const [name, value] of result.files)
        if (typeof value === 'string') files.set(name, value)
      expect(() =>
        typeCheckCompilerFiles(
          files,
          target,
          target === 'react'
            ? { preserveSymlinks: true, extraDependencies: ['react-router', '@remix-run/router'] }
            : {}
        )
      ).not.toThrow()
    },
    35_000
  )

  test('recursive FORM branch actions use the same collection and prevent native submission', () => {
    const f = fixture([])
    const form = f.graph.createNode('FORM', f.entry.id, {
      width: 300,
      height: 120,
      events: {
        onSubmit: [
          {
            id: 'condition',
            kind: 'condition',
            condExpr: 'itemId === "42"',
            consequent: [replace],
            alternate: [back]
          }
        ]
      }
    })
    f.graph.createNode('BUTTON', form.id, {
      width: 240,
      height: 48,
      interactiveProps: { text: 'Submit' }
    })
    const result = compile({
      graph: f.graph,
      pageIds: [f.home.id, f.details.id],
      options: withDefaults({ router: 'react-router-v6' })
    })
    const page = String(result.files.get('src/pages/index.tsx'))
    expect(page).toContain('e.preventDefault()')
    expect(page).toContain('__opBack(')
    expect(page).toContain(', { replace: true }')
  })

  test.each(['react', 'vue'] as const)(
    '%s old push actions do not opt into the Back runtime',
    (target) => {
      const { result } = generate(target, [
        { id: 'push', kind: 'navigate', to: '/home?view=list#top' }
      ])
      expect(result.warnings).toEqual([])
      expect(result.files.has('src/_application_navigation.ts')).toBe(false)
      const page = String(result.files.get(`src/pages/index.${target === 'react' ? 'tsx' : 'vue'}`))
      expect(page).not.toContain('replace: true')
      expect(page).toContain('/home?view=list#top')
    }
  )

  test('Flutter replacement and fallback use Navigator semantics; Expo/mini-program Back is explicitly unsupported', () => {
    const flutter = generate('flutter', [replace, back]).result
    expect(flutter.warnings).toEqual([])
    const dart = [...flutter.files.values()]
      .filter((v): v is string => typeof v === 'string')
      .join('\n')
    expect(dart).toContain('pushReplacementNamed(')
    expect(dart).toContain('canPop()')
    expect(dart).toContain('/home?category=active#list')
    for (const target of ['expo', 'wechat-miniprogram', 'taro', 'uni-app', 'mpx'] as const) {
      const result = generate(target, [back]).result
      expect(
        result.warnings.some((w) => w.code.includes('unsupported') && w.message.includes('back'))
      ).toBe(true)
    }
  })

  test('Expo and WeChat/Taro replacement must not silently become push', () => {
    for (const target of ['expo', 'wechat-miniprogram', 'taro'] as const) {
      const result = generate(target, [
        { id: 'replace', kind: 'navigate', to: '/home', history: 'replace' }
      ]).result
      const source = [...result.files.values()]
        .filter((v): v is string => typeof v === 'string')
        .join('\n')
      const expected = {
        expo: 'router.replace(',
        taro: 'Taro.redirectTo(',
        'wechat-miniprogram': 'wx.redirectTo('
      }
      expect(source).toContain(expected[target])
    }
  })

  test('unsafe or parameterized fallback fails closed in collector and recursive navigation audit', () => {
    for (const target of [
      '',
      'https://example.test',
      '//example.test',
      '/:id',
      '/wild/*',
      '/\\escape',
      '/\n'
    ]) {
      expect(validateLowcodeBackFallback(target).ok).toBe(false)
      const f = fixture([
        {
          id: 'condition',
          kind: 'condition',
          condExpr: 'itemId === "42"',
          consequent: [{ id: 'back', kind: 'back', fallback: target }]
        }
      ])
      const tree = collectTree(f.graph, f.home.id)
      expect(tree.warnings.some((w) => w.code === 'action-back-invalid-fallback')).toBe(true)
      expect(auditLowcodeNavigation(f.graph).summary.invalidEdges).toBe(1)
    }
  })

  test('missing fallback target is audited and unknown navigation history is omitted', () => {
    const f = fixture([{ id: 'back', kind: 'back', fallback: '/missing' }])
    expect(auditLowcodeNavigation(f.graph).summary.missingEdges).toBe(1)
    f.graph.updateNode(f.button.id, {
      events: {
        onClick: [
          JSON.parse(
            '{"id":"unrecognized","kind":"navigate","to":"/home","history":"unrecognized"}'
          )
        ]
      }
    })
    const tree = collectTree(f.graph, f.home.id)
    expect(tree.warnings.some((w) => w.code === 'action-navigate-invalid-history')).toBe(true)
  })

  test('named workflow substitution preserves replacement history and literal Back fallback', () => {
    const f = fixture([
      { id: 'workflow', kind: 'callWorkflow', workflowId: 'nav-flow', args: { item: 'itemId' } }
    ])
    f.graph.updateNode(f.graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'nav-flow',
          name: 'Navigate with history',
          params: ['item'],
          actions: [{ ...replace, params: { id: 'item' } }, back]
        }
      ]
    })
    const result = compile({
      graph: f.graph,
      pageIds: [f.home.id, f.details.id],
      options: withDefaults({ router: 'react-router-v6', devMode: false })
    })
    expect(result.warnings).toEqual([])
    const source = String(result.files.get('src/pages/index.tsx'))
    expect(source).toContain('id: itemId')
    expect(source).toContain(', { replace: true }')
    expect(source).toContain('__opBack("/home?category=active#list")')
  })

  test.each(['react', 'vue'] as const)(
    '%s Back inside a reusable component receives a router hook',
    (target) => {
      const f = fixture([])
      f.graph.deleteNode(f.button.id)
      const component = f.graph.createNode('COMPONENT', f.home.id, {
        name: 'Back Control',
        width: 240,
        height: 48,
        layoutMode: 'VERTICAL'
      })
      f.graph.createNode('BUTTON', component.id, {
        width: 240,
        height: 48,
        interactiveProps: { text: 'Back' },
        events: { onClick: [back] }
      })
      f.graph.createInstance(component.id, f.entry.id)
      const result = compile({
        graph: f.graph,
        pageIds: [f.home.id, f.details.id],
        options: withDefaults({
          target,
          router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
          devMode: false
        })
      })
      expect(result.warnings).toEqual([])
      const source = [...result.files.entries()]
        .filter(
          ([name]) =>
            name.startsWith('src/components/') &&
            name.endsWith(target === 'react' ? '.tsx' : '.vue')
        )
        .map(([, value]) => String(value))
        .join('\n')
      expect(source).toContain('__opBack(')
      expect(source).toContain(target === 'react' ? 'useApplicationBack' : 'createApplicationBack')
      const files = new Map<string, string>()
      for (const [name, value] of result.files)
        if (typeof value === 'string') files.set(name, value)
      expect(() =>
        typeCheckCompilerFiles(
          files,
          target,
          target === 'react'
            ? { preserveSymlinks: true, extraDependencies: ['react-router', '@remix-run/router'] }
            : {}
        )
      ).not.toThrow()
    },
    35_000
  )

  test('React single-page export removes Back instead of leaving an undefined hook', () => {
    const f = fixture([back])
    const result = compile({
      graph: f.graph,
      pageIds: [f.home.id],
      options: withDefaults({ router: 'none' })
    })
    expect(result.warnings.some((w) => w.code === 'action-back-no-router')).toBe(true)
    expect(String(result.files.get('src/App.tsx'))).not.toContain('__opBack')
  })
})
