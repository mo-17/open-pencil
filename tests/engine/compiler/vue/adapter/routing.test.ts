import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { vueAdapter } from '#compiler/adapters/vue'
import type { IRElement, IRTree } from '#compiler/ir/types'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function vueOptions(router: 'vue-router-v4' | 'none' = 'none') {
  return withDefaults({
    packageName: 'vue-routing',
    target: 'vue',
    router,
    devMode: false
  })
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function minimalIr(overrides: Partial<IRTree> = {}): IRTree {
  return {
    pageId: 'page',
    pageName: 'Page',
    usesRouteParams: false,
    children: [],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: [],
    ...overrides
  }
}

function element(overrides: Partial<IRElement> = {}): IRElement {
  return {
    kind: 'element',
    sourceId: 'element',
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    ...overrides
  }
}

function expectValidSfc(source: string): void {
  expect(source).toStartWith('<script setup lang="ts">')
  expect(source).toContain('</script>\n\n<template>')
  expect(source).toEndWith('</template>\n')
}

function maybeWriteVerificationProject(files: ReadonlyMap<string, string | Uint8Array>): void {
  const directory = process.env.OPENPENCIL_VUE_ROUTE_VERIFY_DIR
  if (!directory) return
  for (const [path, value] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
}

describe('Vue compiler routing', () => {
  test('binds reusable component route and query reads to vue-router context', () => {
    const graph = makeSceneGraph()
    const homeId = firstPageId(graph)
    const detail = graph.addPage('Detail')
    graph.updateNode(detail.id, { lowcodeRoutePattern: '/detail/:id?' })
    graph.createNode('BUTTON', homeId, {
      interactiveProps: { text: 'Detail' },
      events: {
        onClick: [{ id: 'navigate-detail', kind: 'navigate', to: '/detail/:id?' }]
      }
    })
    const master = graph.createNode('COMPONENT', detail.id, {
      name: 'Route Card',
      width: 180,
      height: 80
    })
    graph.createNode('TEXT', master.id, {
      text: 'fallback id',
      bindings: { text: { kind: 'expr', expr: '$params.id' } }
    })
    graph.createNode('TEXT', master.id, {
      text: 'fallback tab',
      bindings: { text: { kind: 'expr', expr: '$query.tab' } }
    })
    if (!graph.createInstance(master.id, detail.id)) throw new Error('instance not created')

    const output = compile({
      graph,
      pageIds: [homeId, detail.id],
      options: vueOptions('vue-router-v4')
    })
    const component = textFile(output.files, 'src/components/RouteCard.vue')

    expect(component).toContain(
      "import { useRoute as __useRoute, useRouter as __useRouter } from 'vue-router'"
    )
    expect(component).toContain('const __opRoute = __useRoute()')
    expect(component).toContain('const $params = __opRoute.params')
    expect(component).toContain('const $query = __opRoute.query')
    expect(component).toContain('$params.id')
    expect(component).toContain('$query.tab')
    expect(component).not.toContain('__useDocState<unknown>("$params")')
    expect(component).not.toContain('__useDocState<unknown>("$query")')
    expect(
      output.warnings.some((warning) => warning.code === 'vue-route-context-unavailable')
    ).toBe(false)
    expectValidSfc(component)
    maybeWriteVerificationProject(output.files)
  })

  test('fails closed with empty component route context in single-page output', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Route Fallback',
      width: 180,
      height: 80
    })
    graph.createNode('TEXT', master.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: '$params.id + $query.tab' } }
    })
    if (!graph.createInstance(master.id, pageId)) throw new Error('instance not created')

    const output = compile({ graph, pageIds: [pageId], options: vueOptions() })
    const component = textFile(output.files, 'src/components/RouteFallback.vue')

    expect(component).toContain('const $params: Record<string, string> = {}')
    expect(component).toContain('const $query: Record<string, string> = {}')
    expect(component).not.toContain("from 'vue-router'")
    expect(component).not.toContain('__useDocState<unknown>("$params")')
    expect(output.warnings).toContainEqual(
      expect.objectContaining({
        code: 'vue-route-context-unavailable',
        nodeId: master.id
      })
    )
    expectValidSfc(component)
  })

  test('parses optional, repeated, splat, query, and hash navigation targets', () => {
    const navigationPage = minimalIr({
      pageId: 'navigation',
      pageName: 'Navigation',
      children: [
        element({
          sourceId: 'safe-navigation',
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'navigate',
                to: '/:locale?/product/:id/:id2/:id?tab=:ignored#section-:hash',
                params: [
                  { name: 'id', ast: { kind: 'string', value: 'one' }, references: [] },
                  { name: 'id2', ast: { kind: 'string', value: 'two' }, references: [] }
                ]
              }
            ]
          }
        }),
        element({
          sourceId: 'splat-navigation',
          tag: 'button',
          events: { onClick: [{ kind: 'navigate', to: '/files/*?sort=:order#top' }] }
        }),
        element({
          sourceId: 'missing-navigation',
          tag: 'button',
          events: { onClick: [{ kind: 'navigate', to: '/missing/:id' }] }
        }),
        element({
          sourceId: 'malformed-navigation',
          tag: 'button',
          events: { onClick: [{ kind: 'navigate', to: '/bad/:?tab=x' }] }
        }),
        element({
          sourceId: 'unsafe-navigation',
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'navigate',
                to: ['java', 'script:globalThis.__NAV_PWN=1'].join('')
              }
            ]
          }
        })
      ]
    })
    const output = vueAdapter.emit(
      [navigationPage, minimalIr({ pageId: 'second', pageName: 'Second' })],
      vueOptions('vue-router-v4')
    )
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(page).toContain('"id": encodeURIComponent(String("one"))')
    expect(page).toContain('"id2": encodeURIComponent(String("two"))')
    expect(page).toContain('"/:locale?/product/:id/:id2/:id".split')
    expect(page).toContain('return __opMatch[2] ? [] : [__opSegment]')
    expect(page).toContain('__opPath + "?tab=:ignored#section-:hash"')
    expect(page).toContain('await __opRouter.push("/files/*?sort=:order#top")')
    expect(page).not.toContain('await __opRouter.push("/bad/:?tab=x")')
    expect(page).not.toContain(['java', 'script:globalThis'].join(''))
    expect(output.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'vue-navigate-param-missing',
        'vue-navigate-route-invalid',
        'vue-navigate-target-unsafe'
      ])
    )
    expectValidSfc(page)
  })

  test('collector-to-Vue removes an omitted optional navigate parameter', () => {
    const graph = makeSceneGraph()
    const homeId = firstPageId(graph)
    const product = graph.addPage('Product')
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id?' })
    graph.createNode('BUTTON', homeId, {
      interactiveProps: { text: 'Product' },
      events: {
        onClick: [{ id: 'navigate-product', kind: 'navigate', to: '/product/:id?' }]
      }
    })

    const output = compile({
      graph,
      pageIds: [homeId, product.id],
      options: vueOptions('vue-router-v4')
    })
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(page).toContain('const __opRouteValues: Record<string, string> = {  }')
    expect(page).toContain('"/product/:id?".split')
    expect(page).toContain('return __opMatch[2] ? [] : [__opSegment]')
    expect(output.warnings.map((warning) => warning.code)).not.toContain(
      'vue-navigate-param-missing'
    )
    expectValidSfc(page)
  })
})
