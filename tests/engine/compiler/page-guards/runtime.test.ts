import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

import { applicationGuardsRuntimeSource } from '#compiler/adapters/application-guards/runtime'
import { applicationSessionRuntimeSource } from '#compiler/adapters/application-session/runtime'
import { buildPreviewBridge } from '#compiler/adapters/preview-bridge'
import { projectApplicationGuards } from '#compiler/ir/application/guards'
import { collectTree } from '#compiler/ir/collect/tree'

import { parseExpression, type ExprAst } from '@open-pencil/lowcode'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { applicationGuardsFixture } from '#tests/helpers/compiler/application-guards/fixture'

type Scope = Record<string, unknown>
type Policy = {
  pageId: string
  route: string
  enter?: { ast: ExprAst; fallback: string }
  leave?: { ast: ExprAst; message: string }
  auth?: { fallback: string; ready: boolean }
}
interface Runtime {
  policies: Policy[]
  evaluateGuard(ast: ExprAst, scope: Scope): unknown
  guardBoolean(ast: ExprAst, scope: Scope): boolean | undefined
  routeScope(href: string, params?: Scope): Scope
  entryOutcome(
    policy: Policy,
    scope: Scope
  ): { allowed: boolean; waiting?: boolean; fallback?: string }
  registerLeave(
    pageId: string,
    owner: string,
    scope: () => Scope,
    active: () => boolean
  ): () => void
  leaveRequirement(from: string, to: string): { message: string } | undefined
  allowLeave(from: string, to: string, signal?: AbortSignal): Promise<boolean>
  notifyGuardInputs(): void
}
function expression(value: string): ExprAst {
  const parsed = parseExpression(value)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.ast
}
async function withRuntime(run: (runtime: Runtime, product: Policy) => void | Promise<void>) {
  const { graph, products } = applicationGuardsFixture()
  const projection = projectApplicationGuards(
    graph,
    graph.getPages().map((page) => collectTree(graph, page.id))
  )
  expect(projection.warnings).toEqual([])
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-page-guards-'))
  try {
    const file = join(directory, 'runtime.ts')
    await writeFile(file, applicationGuardsRuntimeSource(projection.trees))
    const runtime = (await import(pathToFileURL(file).href)) as Runtime
    const policy = runtime.policies.find((page) => page.pageId === products.id)
    if (!policy) throw new Error('Missing product policy')
    await run(runtime, policy)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('strict boolean entry uses target params/query/document inputs and fails closed', async () => {
  await withRuntime((runtime, policy) => {
    const scope = {
      hasAccess: true,
      ...runtime.routeScope('/products/42?mode=edit#section', { productId: '42' })
    }
    expect(runtime.entryOutcome(policy, scope)).toEqual({ allowed: true })
    expect(runtime.entryOutcome(policy, { ...scope, hasAccess: false })).toEqual({
      allowed: false,
      fallback: '/home'
    })
    expect(
      runtime.entryOutcome(
        { ...policy, enter: { ast: expression('hasAccess'), fallback: '/home' } },
        { ...scope, hasAccess: 1 }
      )
    ).toEqual({ allowed: false, fallback: '/home' })
    expect(
      runtime.entryOutcome(policy, {
        hasAccess: true,
        ...runtime.routeScope('/products/blocked', { productId: 'blocked' })
      }).allowed
    ).toBe(false)
    expect(
      runtime.entryOutcome(policy, {
        hasAccess: true,
        ...runtime.routeScope('/products/42?mode=blocked', { productId: '42' })
      }).allowed
    ).toBe(false)
    expect(runtime.guardBoolean(expression('missing'), {})).toBeUndefined()
    expect(runtime.guardBoolean(expression('1'), {})).toBeUndefined()
    expect(runtime.guardBoolean(expression('draft.length > 0'), { draft: '' })).toBe(false)
    expect(runtime.guardBoolean(expression('draft.length > 0'), { draft: 'unsaved' })).toBe(true)
  })
})
test('auth readiness and authorization precede business condition evaluation', async () => {
  await withRuntime((runtime, product) => {
    const policy = { ...product, auth: { fallback: '/login', ready: true } }
    let reads = 0
    const scope = Object.defineProperty(
      { $currentUser: { ready: false, signedIn: true } },
      'hasAccess',
      {
        get() {
          reads++
          return true
        }
      }
    )
    expect(runtime.entryOutcome(policy, scope)).toEqual({ allowed: false, waiting: true })
    expect(
      runtime.entryOutcome(policy, { $currentUser: { ready: true, signedIn: false } })
    ).toEqual({ allowed: false, fallback: '/login' })
    expect(reads).toBe(0)
  })
})
test('guard evaluator never invokes accessor or object coercion and bounds expression work', async () => {
  await withRuntime((runtime) => {
    let calls = 0
    const accessor = Object.defineProperty({}, 'allowed', {
      get() {
        calls++
        return true
      }
    })
    expect(runtime.guardBoolean(expression('user.allowed'), { user: accessor })).toBeUndefined()
    expect(runtime.guardBoolean(expression('user.constructor'), { user: {} })).toBeUndefined()
    expect(
      runtime.guardBoolean(expression('user + 1 === 2'), {
        user: {
          valueOf() {
            calls++
            return 1
          }
        }
      })
    ).toBeUndefined()
    let ast: ExprAst = { kind: 'ident', name: 'true' }
    for (let i = 0; i < 600; i++) ast = { kind: 'unary', op: '!', arg: ast }
    expect(runtime.guardBoolean(ast, {})).toBeUndefined()
    expect(calls).toBe(0)
  })
})
test('current leave scope isolates concrete owner, reads params/query, and ignores hash-only navigation', async () => {
  await withRuntime((runtime, policy) => {
    policy.leave = {
      ast: expression('$params.productId === "42" && $query.mode === "edit"'),
      message: 'Unsaved changes'
    }
    const remove = runtime.registerLeave(
      policy.pageId,
      '/products/42?mode=edit',
      () => runtime.routeScope('/products/42?mode=edit', { productId: '42' }),
      () => true
    )
    expect(runtime.leaveRequirement('/products/42?mode=edit', '/home')?.message).toBe(
      'Unsaved changes'
    )
    expect(
      runtime.leaveRequirement('/products/42?mode=edit', '/products/42?mode=edit#next')
    ).toBeUndefined()
    expect(runtime.leaveRequirement('/products/43?mode=edit', '/home')).toBeUndefined()
    remove()
    expect(runtime.leaveRequirement('/products/42?mode=edit', '/home')).toBeUndefined()
  })
})
test('leave is explicit false only, retires old ownership, and skips unavailable SSR dialogs safely', async () => {
  await withRuntime(async (runtime, policy) => {
    let dirty: unknown = true
    policy.leave = { ast: expression('dirty'), message: 'Unsaved changes' }
    const remove = runtime.registerLeave(
      policy.pageId,
      '/products/42',
      () => ({ dirty }),
      () => true
    )
    for (const value of [undefined, 'false', 0, {}, true]) {
      dirty = value
      expect(runtime.leaveRequirement('/products/42', '/home')).toBeDefined()
    }
    dirty = false
    expect(runtime.leaveRequirement('/products/42', '/home')).toBeUndefined()
    dirty = true
    const pending = runtime.allowLeave('/products/42', '/home')
    dirty = false
    runtime.notifyGuardInputs()
    expect(await pending).toBe(true)
    dirty = true
    const retired = runtime.allowLeave('/products/42', '/home')
    remove()
    expect(await retired).toBe(false)
    const aborted = new AbortController()
    aborted.abort()
    expect(await runtime.allowLeave('/products/42', '/home', aborted.signal)).toBe(false)
  })
})

test('generated bridge latest current-route request cancels pending older navigation and late-registration queues safely', async () => {
  const source = buildPreviewBridge({ applicationGuards: true })
  const queue = source.slice(
    source.indexOf('  let pendingGuardedRoute:'),
    source.indexOf('  // Client router writes')
  )
  const inbound = source.slice(
    source.indexOf("    if (data.type === 'navigate')"),
    source.indexOf("    if (data.type === 'docState')")
  )
  const events = new Map<string, () => void>(),
    routes: string[] = [],
    sent: string[] = []
  let resolvePrevious: ((value: boolean) => void) | undefined,
    cancellations = 0
  const window: {
    __opApplicationNavigationGuard?: {
      cancelPending(): void
      requestRoute(route: string): Promise<boolean>
    }
    addEventListener(name: string, handler: () => void): void
  } = {
    addEventListener(name, handler) {
      events.set(name, handler)
    }
  }
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    queue +
      '\nfunction inbound(data: { type: string; route: string; replace?: boolean }) {\n' +
      inbound +
      '\n}\nglobalThis.inbound = inbound'
  )
  const handle = runInNewContext(javascript, {
    window,
    currentPreviewRoute: () => '/products/42',
    postOutboundNavigate: (route: string) => sent.push(route)
  }) as (value: { type: string; route: string }) => void
  handle({ type: 'navigate', route: '/home' })
  expect(routes).toEqual([])
  window.__opApplicationNavigationGuard = {
    cancelPending() {
      cancellations++
      resolvePrevious?.(false)
    },
    async requestRoute(route) {
      routes.push(route)
      if (route === '/home')
        return new Promise((resolve) => {
          resolvePrevious = resolve
        })
      return true
    }
  }
  events.get('op-application-guards-ready')?.()
  expect(routes).toEqual(['/home'])
  handle({ type: 'navigate', route: '/products/42' })
  for (let i = 0; i < 8; i++) await Promise.resolve()
  expect(cancellations).toBe(1)
  expect(routes).toEqual(['/home', '/products/42'])
  expect(sent).toEqual(['/products/42'])
})

test('generated Backend preview bridge bypasses boot replay waiting while mirrored preview waits', () => {
  for (const documentState of [false, true]) {
    const source = buildPreviewBridge({ applicationGuards: true, documentState })
    const declaration = source.match(/^const MIRROR_DOCUMENT_STATE = (?:true|false)$/m)?.[0]
    const assignment = source.match(
      /^  window\.__opApplicationGuardBootPending = MIRROR_DOCUMENT_STATE$/m
    )?.[0]
    if (!declaration || !assignment) throw new Error('Missing guarded preview boot contract')
    const window: { __opApplicationGuardBootPending?: boolean } = {}
    runInNewContext(declaration + '\n' + assignment, { window })
    expect(window.__opApplicationGuardBootPending).toBe(documentState)
  }
  expect(buildPreviewBridge({ documentState: false })).not.toContain(
    '__opApplicationGuardBootPending'
  )
})

test('guard session initial RAF restoration preserves newer scroll intent and flushes the final preserve position', () => {
  const { graph, home } = applicationGuardsFixture()
  const ir = { ...collectTree(graph, home.id), applicationStateRetention: 'preserve' as const }
  function runtime(protect: boolean) {
    let sequence = 0
    const frames = new Map<number, () => void>()
    const listeners = new Map<string, () => void>()
    const window = {
      scrollX: 0,
      scrollY: 0,
      history: { scrollRestoration: 'auto' },
      requestAnimationFrame(callback: () => void) {
        frames.set(++sequence, callback)
        return sequence
      },
      cancelAnimationFrame(id: number) {
        frames.delete(id)
      },
      addEventListener(name: string, listener: () => void) {
        listeners.set(name, listener)
      },
      removeEventListener(name: string) {
        listeners.delete(name)
      },
      scrollTo(options: { left: number; top: number }) {
        this.scrollX = options.left
        this.scrollY = options.top
      }
    }
    const source = new Bun.Transpiler({ loader: 'ts' })
      .transformSync(applicationSessionRuntimeSource([ir], false, protect))
      .replace(/^export /gm, '')
    const value = runInNewContext(
      source +
        '\n({mountApplicationScroll:(key,retention)=>mountApplicationScroll(JSON.parse(JSON.stringify(key)),retention),getSnapshot})',
      {
        window,
        TextEncoder,
        structuredClone,
        queueMicrotask
      }
    ) as {
      mountApplicationScroll(
        key: { pageId: string; pathname: string; search: string },
        retention: string
      ): () => void
      getSnapshot(): { entries: Array<{ scroll: Vector }> }
    }
    function frame() {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    }
    return { window, value, frame }
  }
  const key = { pageId: home.id, pathname: '/home', search: '' }
  const legacy = runtime(false)
  const oldRemove = legacy.value.mountApplicationScroll(key, 'preserve')
  legacy.window.scrollY = 450
  legacy.frame()
  legacy.frame()
  expect(legacy.window.scrollY).toBe(0) // Actual historical race: a late initial restore overwrites newer position.
  oldRemove()
  const guarded = runtime(true)
  const remove = guarded.value.mountApplicationScroll(key, 'preserve')
  guarded.window.scrollY = 450
  guarded.frame()
  guarded.frame()
  expect(guarded.window.scrollY).toBe(450)
  expect(guarded.value.getSnapshot().entries[0].scroll.y).toBe(450)
  guarded.window.scrollY = 750 // No scroll event has fired before synchronous navigation/unmount.
  remove()
  expect(guarded.value.getSnapshot().entries[0].scroll.y).toBe(750)
})
