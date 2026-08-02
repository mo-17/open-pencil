import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import type { NavigationAuditResult } from '@open-pencil/core/lowcode-validation'
import { SceneGraph } from '@open-pencil/scene-graph'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

describe('page route tools', () => {
  test('sets, reads, and clears a compiler-effective page route', () => {
    const { figma, graph } = setupToolTest()
    const page = graph.addPage('Product Detail')
    const update = getTool('update_page_route')

    const setResult = update.execute(figma, {
      page_id: page.id,
      route_pattern: '/product/:id'
    }) as Result<Record<string, unknown>>
    expect(setResult.ok).toBe(true)
    expect(graph.getNode(page.id)?.lowcodeRoutePattern).toBe('/product/:id')

    const readResult = getTool('read_page_route').execute(figma, {
      page_id: page.id
    }) as Result<{
      route: string
      routeSource: string
      parameters: Array<{ name: string; optional: boolean }>
    }>
    expect(readResult.ok).toBe(true)
    if (!readResult.ok) return
    expect(readResult.data.route).toBe('/product/:id')
    expect(readResult.data.routeSource).toBe('explicit')
    expect(readResult.data.parameters).toEqual([{ name: 'id', optional: false }])

    const clearResult = update.execute(figma, {
      page_id: page.id,
      clear: true
    }) as Result<Record<string, unknown>>
    expect(clearResult.ok).toBe(true)
    expect(graph.getNode(page.id)?.lowcodeRoutePattern).toBeUndefined()
    const cleared = getTool('read_page_route').execute(figma, {
      page_id: page.id
    }) as Result<{ route: string; routeSource: string }>
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.data.route).toBe('/product-detail')
    expect(cleared.data.routeSource).toBe('derived')
  })

  test('rejects invalid or ambiguous update arguments', () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const update = getTool('update_page_route')
    const invalid = update.execute(figma, {
      page_id: page.id,
      route_pattern: 'about'
    }) as Result<Record<string, unknown>>
    expect(invalid.ok).toBe(false)
    const both = update.execute(figma, {
      page_id: page.id,
      route_pattern: '/about',
      clear: true
    }) as Result<Record<string, unknown>>
    expect(both.ok).toBe(false)
  })

  test('records one editor undo entry and restores the prior route', () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const page = graph.addPage('Product')
    const result = getTool('update_page_route').execute(
      figma,
      { page_id: page.id, route_pattern: '/product/:id' },
      { editor }
    ) as Result<Record<string, unknown>>
    expect(result.ok).toBe(true)
    expect(editor.undo.undoLabel).toBe('AI: update page route')
    expect(graph.getNode(page.id)?.lowcodeRoutePattern).toBe('/product/:id')
    editor.undo.undo()
    expect(graph.getNode(page.id)?.lowcodeRoutePattern).toBeUndefined()
  })
})

describe('audit_navigation', () => {
  test('reports edges, dynamic-param problems, workflow expansion, and eventless buttons', () => {
    const { figma, graph } = setupToolTest()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, { name: 'Home' })
    graph.addPage('About')
    const product = graph.addPage('Product')
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.createNode('BUTTON', home.id, {
      name: 'About link',
      events: { onClick: [{ id: 'nav-about', kind: 'navigate', to: '/about' }] }
    })
    graph.createNode('BUTTON', home.id, {
      name: 'Missing link',
      events: { onClick: [{ id: 'nav-missing', kind: 'navigate', to: '/gone' }] }
    })
    graph.createNode('BUTTON', home.id, {
      name: 'Product link',
      events: {
        onClick: [{ id: 'nav-product', kind: 'navigate', to: '/product/:id' }]
      }
    })
    graph.createNode('BUTTON', home.id, { name: 'No action' })
    graph.updateNode(graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'go-about',
          name: 'Go about',
          actions: [{ id: 'workflow-nav', kind: 'navigate', to: '/about' }]
        }
      ]
    })
    graph.createNode('BUTTON', home.id, {
      name: 'Workflow link',
      events: {
        onClick: [{ id: 'call-about', kind: 'callWorkflow', workflowId: 'go-about' }]
      }
    })

    const result = getTool('audit_navigation').execute(figma, {}) as Result<NavigationAuditResult>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.summary).toMatchObject({
      pages: 3,
      edges: 4,
      okEdges: 2,
      missingEdges: 1,
      invalidEdges: 1,
      noEventButtons: 1
    })
    expect(
      result.data.edges.find((edge) => edge.actionId === 'workflow-nav')?.actionPath
    ).toContain('workflow(go-about)')
    expect(
      result.data.edges.find((edge) => edge.actionId === 'nav-product')?.missingParams
    ).toEqual(['id'])
    expect(result.data.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'navigate-target-missing',
        'navigate-param-missing',
        'button-no-events'
      ])
    )
  })

  test('reports route-shape collisions and ambiguous navigation', () => {
    const { figma, graph } = setupToolTest()
    const home = graph.getPages()[0]
    const first = graph.addPage('First product')
    const second = graph.addPage('Second product')
    graph.updateNode(first.id, { lowcodeRoutePattern: '/product/:id' })
    graph.updateNode(second.id, { lowcodeRoutePattern: '/product/:slug' })
    graph.createNode('BUTTON', home.id, {
      name: 'Product',
      events: { onClick: [{ id: 'nav-product', kind: 'navigate', to: '/product/42' }] }
    })

    const result = getTool('audit_navigation').execute(figma, {}) as Result<NavigationAuditResult>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.collisions).toHaveLength(1)
    expect(result.data.collisions[0].kind).toBe('dynamic-shape')
    expect(result.data.edges[0].status).toBe('ambiguous')
    expect(result.data.edges[0].targetPageIds).toEqual([first.id, second.id])
  })

  test('excludes implicit form submits but reports ordinary eventless buttons', () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const form = graph.createNode('FORM', page.id, { name: 'Form' })
    const formBody = graph.createNode('FRAME', form.id, { name: 'Form body' })
    graph.createNode('BUTTON', formBody.id, { name: 'Implicit submit' })
    graph.createNode('BUTTON', page.id, {
      name: 'Prototype button',
      prototype: {
        version: 1,
        connections: [
          {
            id: 'prototype-action',
            trigger: { kind: 'click' },
            action: { kind: 'back' },
            transition: { kind: 'instant' },
            interruption: 'replace',
            playback: 'forward'
          }
        ]
      }
    })
    graph.createNode('BUTTON', page.id, { name: 'Ordinary eventless' })

    const result = getTool('audit_navigation').execute(figma, {}) as Result<NavigationAuditResult>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.noEventButtons.map((button) => button.name)).toEqual(['Ordinary eventless'])
    expect(result.data.summary.noEventButtons).toBe(1)
    expect(result.data.issues.filter((issue) => issue.code === 'button-no-events')).toHaveLength(1)
  })

  test('supports current-page scope while retaining the full route manifest', () => {
    const { figma, graph } = setupToolTest()
    const home = graph.getPages()[0]
    const about = graph.addPage('About')
    graph.createNode('BUTTON', home.id, { name: 'Home eventless' })
    graph.createNode('BUTTON', about.id, { name: 'About eventless' })
    figma.currentPage = figma.wrapNode(about.id)

    const result = getTool('audit_navigation').execute(figma, {
      scope: 'current_page'
    }) as Result<NavigationAuditResult>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.routes).toHaveLength(2)
    expect(result.data.noEventButtons.map((button) => button.name)).toEqual(['About eventless'])
  })

  test('matches compiler trimming, optional params, and expression parsing', () => {
    const { figma, graph } = setupToolTest()
    const home = graph.getPages()[0]
    const about = graph.addPage('About')
    graph.updateNode(about.id, { lowcodeRoutePattern: '/about' })
    const optional = graph.addPage('Optional product')
    graph.updateNode(optional.id, { lowcodeRoutePattern: '/product/:id?/edit' })
    graph.createNode('BUTTON', home.id, {
      name: 'Trimmed route',
      events: { onClick: [{ id: 'trimmed', kind: 'navigate', to: ' /about ' }] }
    })
    graph.createNode('BUTTON', home.id, {
      name: 'Optional route',
      events: {
        onClick: [
          {
            id: 'optional',
            kind: 'navigate',
            to: '/product/:id?/edit',
            params: { id: 'productId' }
          }
        ]
      }
    })
    graph.createNode('BUTTON', home.id, {
      name: 'Broken expression',
      events: {
        onClick: [
          {
            id: 'broken-expression',
            kind: 'navigate',
            to: '/product/:id?/edit',
            params: { id: '(' }
          }
        ]
      }
    })

    const result = getTool('audit_navigation').execute(figma, {}) as Result<NavigationAuditResult>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.edges.find((edge) => edge.actionId === 'trimmed')).toMatchObject({
      to: '/about',
      status: 'ok',
      targetPageIds: [about.id]
    })
    expect(result.data.edges.find((edge) => edge.actionId === 'optional')).toMatchObject({
      status: 'ok',
      targetPageIds: [optional.id]
    })
    expect(result.data.edges.find((edge) => edge.actionId === 'broken-expression')).toMatchObject({
      status: 'invalid',
      invalidParams: ['id']
    })
  })
})
