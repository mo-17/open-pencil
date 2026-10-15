import { describe, expect, test } from 'bun:test'

import {
  resolveLowcodeApplicationPages,
  validateLowcodeApplicationEnterGuard,
  validateLowcodeApplicationGuardExpression,
  validateLowcodeApplicationGuardFallback,
  validateLowcodeApplicationGuardMessage,
  validateLowcodeApplicationGuardRoutes,
  validateLowcodeApplicationLeaveConfirm,
  validateLowcodeApplicationPage
} from '#lowcode/application-mode'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

function fixture() {
  const graph = new SceneGraph()
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('Missing root')
  const page = graph.getPages()[0]
  const home = graph.addPage('Home')
  for (const [node, route] of [
    [page, '/products/:id'],
    [home, '/home']
  ] as const) {
    const entry = graph.createNode('FRAME', node.id, { width: 390, height: 844 })
    node.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
    node.lowcodeRoutePattern = route
  }
  root.lowcodeApplication = { version: 1, enabled: true, startPageId: home.id }
  return { graph, root, page, home }
}

function pagePolicy(page: SceneNode) {
  if (!page.lowcodeApplicationPage) throw new Error('Missing page policy')
  return page.lowcodeApplicationPage
}

describe('application guard contract', () => {
  test('optional policy reads preserve old shape; authored guards are detached and projected', () => {
    const { graph, page, home } = fixture()
    expect(resolveLowcodeApplicationPages(graph).pages).toEqual([
      { pageId: home.id, entryNodeId: home.childIds[0] },
      { pageId: page.id, entryNodeId: page.childIds[0] }
    ])
    const policy = {
      ...pagePolicy(page),
      enterGuard: { conditionExpr: 'isSignedIn === true', fallback: '/home?from=detail#notice' },
      leaveConfirm: { dirtyExpr: 'draft !== saved', message: 'Leave without saving?' }
    }
    const validated = validateLowcodeApplicationPage(policy)
    expect(validated).toEqual({ ok: true, value: policy })
    if (!validated.ok) throw new Error('Expected valid policy')
    expect(validated.value.enterGuard).not.toBe(policy.enterGuard)
    expect(validated.value.leaveConfirm).not.toBe(policy.leaveConfirm)
    page.lowcodeApplicationPage = validated.value
    expect(resolveLowcodeApplicationPages(graph).pages[1]).toEqual({
      pageId: page.id,
      entryNodeId: page.childIds[0],
      enterGuard: policy.enterGuard,
      leaveConfirm: policy.leaveConfirm
    })
  })

  test('bounded parser expressions reject scripts, calls and prototype paths', () => {
    for (const value of ['true', '$params.id !== ""', 'draft !== saved', 'hasAccess && !blocked'])
      expect(validateLowcodeApplicationGuardExpression(value)).toBe(true)
    for (const value of [
      '',
      ' ',
      'save()',
      'x; window.alert(1)',
      'x[0]',
      'user.__proto__.admin',
      'user.constructor',
      'prototype',
      'x'.repeat(2049),
      undefined,
      null
    ])
      expect(validateLowcodeApplicationGuardExpression(value)).toBe(false)
    expect(validateLowcodeApplicationGuardExpression('x'.repeat(2048))).toBe(true)
    expect(validateLowcodeApplicationGuardMessage('字'.repeat(1024))).toBe(true)
    for (const message of ['', ' ', 'x'.repeat(1025), undefined])
      expect(validateLowcodeApplicationGuardMessage(message)).toBe(false)
  })

  test('fallbacks are bounded concrete internal routes with optional query and hash', () => {
    expect(validateLowcodeApplicationGuardFallback('/home?next=/products/1#top')).toBe(true)
    expect(validateLowcodeApplicationGuardFallback('/' + 'x'.repeat(2047))).toBe(true)
    for (const value of [
      '',
      '//example.com',
      'https://example.com',
      '/products/:id',
      '/*',
      '/home\\next',
      '/home\n',
      '/home ',
      '/' + 'x'.repeat(2048)
    ])
      expect(validateLowcodeApplicationGuardFallback(value)).toBe(false)
  })

  test('nested unknown, undefined, accessors and non-data shapes fail closed without reads', () => {
    let reads = 0
    const guard = {
      get conditionExpr() {
        reads++
        return 'true'
      },
      fallback: '/home'
    }
    expect(validateLowcodeApplicationEnterGuard(guard).ok).toBe(false)
    expect(
      validateLowcodeApplicationPage({ version: 1, role: 'application', enterGuard: guard }).ok
    ).toBe(false)
    const confirm = {
      dirtyExpr: 'dirty',
      get message() {
        reads++
        return 'Leave?'
      }
    }
    expect(validateLowcodeApplicationLeaveConfirm(confirm).ok).toBe(false)
    expect(
      validateLowcodeApplicationPage({ version: 1, role: 'application', leaveConfirm: confirm }).ok
    ).toBe(false)
    expect(reads).toBe(0)
    for (const value of [
      null,
      undefined,
      false,
      [],
      { conditionExpr: 'true' },
      { conditionExpr: 'true', fallback: '/home', future: true },
      Object.assign(Object.create({ inherited: true }), {
        conditionExpr: 'true',
        fallback: '/home'
      })
    ])
      expect(
        validateLowcodeApplicationPage({ version: 1, role: 'application', enterGuard: value }).ok
      ).toBe(false)
    const symbol = { conditionExpr: 'true', fallback: '/home', [Symbol('extra')]: true }
    expect(validateLowcodeApplicationEnterGuard(symbol).ok).toBe(false)
    const hidden = Object.defineProperty({ conditionExpr: 'true' }, 'fallback', { value: '/home' })
    expect(validateLowcodeApplicationEnterGuard(hidden).ok).toBe(false)
  })

  test('unknown destination, same page and static cycles invalidate the complete application scope', () => {
    for (const fallback of ['/unknown', '/products/1', '/home']) {
      const { graph, page, home } = fixture()
      page.lowcodeApplicationPage = {
        ...pagePolicy(page),
        enterGuard: { conditionExpr: 'true', fallback }
      }
      if (fallback === '/home')
        home.lowcodeApplicationPage = {
          ...pagePolicy(home),
          enterGuard: { conditionExpr: 'true', fallback: '/products/1' }
        }
      const result = resolveLowcodeApplicationPages(graph)
      expect(result.mode).toBe('invalid')
      expect(result.pages).toEqual([])
      expect(result.warnings.some((warning) => warning.code === 'application-guard-invalid')).toBe(
        true
      )
    }
    expect(
      validateLowcodeApplicationGuardRoutes([
        { pageId: 'a', route: '/a', enterGuard: { conditionExpr: 'true', fallback: '/b' } },
        { pageId: 'b', route: '/b', enterGuard: { conditionExpr: 'true', fallback: '/c' } },
        { pageId: 'c', route: '/c' }
      ])
    ).toEqual({ ok: true })
  })

  test('disabled application mode and reference roles keep dormant policies', () => {
    const { graph, root, page } = fixture()
    page.lowcodeApplicationPage = {
      ...pagePolicy(page),
      enterGuard: { conditionExpr: 'true', fallback: '/unknown' },
      leaveConfirm: { dirtyExpr: 'dirty', message: 'Leave?' }
    }
    root.lowcodeApplication = { version: 1, enabled: false }
    expect(resolveLowcodeApplicationPages(graph).mode).toBe('legacy')
    expect(resolveLowcodeApplicationPages(graph).warnings).toEqual([])
    root.lowcodeApplication.enabled = true
    page.lowcodeApplicationPage.role = 'reference'
    expect(resolveLowcodeApplicationPages(graph).mode).toBe('application')
    expect(page.lowcodeApplicationPage.leaveConfirm?.message).toBe('Leave?')
  })

  test('cloning remaps only entry identity and detaches both guard objects', () => {
    const { graph, page } = fixture()
    page.lowcodeApplicationPage = {
      ...pagePolicy(page),
      enterGuard: { conditionExpr: 'isSignedIn', fallback: '/home' },
      leaveConfirm: { dirtyExpr: 'dirty', message: 'Leave?' }
    }
    const copied = graph.cloneTree(page.id, graph.rootId)
    expect(copied?.lowcodeApplicationPage?.entryNodeId).toBe(copied?.childIds[0])
    expect(copied?.lowcodeApplicationPage?.enterGuard).toEqual(
      page.lowcodeApplicationPage.enterGuard
    )
    if (!copied?.lowcodeApplicationPage?.leaveConfirm)
      throw new Error('Missing copied confirmation')
    copied.lowcodeApplicationPage.leaveConfirm.message = 'Changed'
    expect(page.lowcodeApplicationPage.leaveConfirm?.message).toBe('Leave?')
  })
})
