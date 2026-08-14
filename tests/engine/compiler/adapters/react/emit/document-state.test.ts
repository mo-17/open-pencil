import { describe, expect, test } from 'bun:test'

import type { CompilerOptions } from '@open-pencil/compiler'
import { reactAdapter } from '@open-pencil/compiler/adapters/react'
import {
  buildLowcodeStateRuntime,
  ZUSTAND_VERSION
} from '@open-pencil/compiler/adapters/react/lowcode/state'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRDocStateDecl } from '@open-pencil/compiler/ir/types'
import { SceneGraph } from '@open-pencil/core'

const BASE_OPTIONS: CompilerOptions = {
  packageName: 'demo',
  target: 'react',
  reactVersion: '19',
  router: 'none',
  typescript: true,
  devMode: false
}

/**
 * Phase 2 §2 step 3 — the React adapter scaffolds `src/_lowcode_state.ts`
 * when (and only when) the document declares at least one Document State,
 * and injects `zustand` into the emitted project's package.json.
 */
describe('buildLowcodeStateRuntime (Phase 2 §2)', () => {
  test('empty declarations → empty string (caller treats as "do not emit")', () => {
    expect(buildLowcodeStateRuntime([])).toBe('')
  })

  test('declarations are sorted alphabetically for byte-stable output', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd2', name: 'zeta', type: 'string', defaultValue: 'z' },
      { id: 'd1', name: 'alpha', type: 'number', defaultValue: 0 }
    ]
    const out = buildLowcodeStateRuntime(decls)
    expect(out.indexOf('alpha:')).toBeLessThan(out.indexOf('zeta:'))
  })

  test('typed DocState shape mirrors StateValueType → TS primitive map', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 's', type: 'string', defaultValue: '' },
      { id: 'd2', name: 'n', type: 'number', defaultValue: 0 },
      { id: 'd3', name: 'b', type: 'boolean', defaultValue: false },
      { id: 'd4', name: 'a', type: 'array', defaultValue: [] },
      { id: 'd5', name: 'o', type: 'object', defaultValue: {} }
    ]
    const out = buildLowcodeStateRuntime(decls)
    expect(out).toContain('a: unknown[]')
    expect(out).toContain('b: boolean')
    expect(out).toContain('n: number')
    expect(out).toContain('o: Record<string, unknown>')
    expect(out).toContain('s: string')
  })

  test('initial values are JSON-stringified (handles all primitive shapes)', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'username', type: 'string', defaultValue: 'guest' },
      { id: 'd2', name: 'cartCount', type: 'number', defaultValue: 0 },
      { id: 'd3', name: 'isLoggedIn', type: 'boolean', defaultValue: false }
    ]
    const out = buildLowcodeStateRuntime(decls)
    expect(out).toContain('cartCount: 0')
    expect(out).toContain('isLoggedIn: false')
    expect(out).toContain('username: "guest"')
  })

  test('all three runtime APIs are exported', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }
    ]
    const out = buildLowcodeStateRuntime(decls)
    expect(out).toContain('export function useDocState')
    expect(out).toContain('export function setDocState')
    expect(out).toContain('export function getDocStateSnapshot')
  })

  test('bridges scalar document state changes and initial values to Motion drivers', () => {
    const out = buildLowcodeStateRuntime([
      { id: 'doc-progress', name: 'progress', type: 'number', defaultValue: 0.25 },
      { id: 'doc-enabled', name: 'enabled', type: 'boolean', defaultValue: false },
      { id: 'doc-label', name: 'label', type: 'string', defaultValue: 'ignored' }
    ])

    expect(out).toContain('setDocumentState(stateId, value)')
    expect(out).toContain('notifyDocumentMotionDriver("doc-progress", state.progress)')
    expect(out).toContain('notifyDocumentMotionDriver("doc-enabled", state.enabled)')
    expect(out).not.toContain('notifyDocumentMotionDriver("doc-label", state.label)')
    expect(out).toContain("window.addEventListener('op-motion-drivers-ready', sync)")
    expect(out).toContain('unsubscribeDocumentMotionDrivers()')
  })

  test('imports zustand only via the public package path (no deep imports beyond /vanilla)', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }
    ]
    const out = buildLowcodeStateRuntime(decls)
    expect(out).toContain("from 'zustand'")
    expect(out).toContain("from 'zustand/vanilla'")
  })

  test('setDocState accepts both a value and a (prev) => value updater', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }
    ]
    const out = buildLowcodeStateRuntime(decls)
    expect(out).toContain('(prev: DocState[K]) => DocState[K]')
  })

  test('unpersisted declarations do not emit localStorage helpers', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }
    ]
    const out = buildLowcodeStateRuntime(decls)
    expect(out).toContain('cartCount: initialDefaults.cartCount')
    expect(out).not.toContain('persistConfig')
    expect(out).not.toContain('readPersisted')
    expect(out).not.toContain('window.localStorage')
    expect(out).not.toContain('subscribePersistedDocState')
  })

  test('persisted declarations read and write localStorage with a package-scoped key', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0, persist: true },
      { id: 'd2', name: 'sessionMessage', type: 'string', defaultValue: 'hi' }
    ]
    const out = buildLowcodeStateRuntime(decls, 'shop-demo')
    expect(out).toContain('cartCount: { key: "openpencil:shop-demo:cartCount", version: null }')
    expect(out).toContain('cartCount: readPersisted("cartCount", initialDefaults.cartCount)')
    expect(out).toContain('sessionMessage: initialDefaults.sessionMessage')
    expect(out).toContain('window.localStorage.getItem(config.key)')
    expect(out).toContain('window.localStorage.setItem(config.key')
    expect(out).toContain('store.subscribe((state, previous) => {')
  })

  test('persisted declarations can override storage key and version', () => {
    const decls: IRDocStateDecl[] = [
      {
        id: 'd1',
        name: 'filters',
        type: 'object',
        defaultValue: {},
        persist: true,
        storageKey: 'custom:filters',
        storageVersion: 'v2'
      }
    ]
    const out = buildLowcodeStateRuntime(decls, 'ignored')
    expect(out).toContain('filters: { key: "custom:filters", version: "v2" }')
    expect(out).toContain('parsed.version !== config.version')
  })

  test('§4.6 — exposes the store on window.__opDocStore + dispatches the ready event', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }
    ]
    const out = buildLowcodeStateRuntime(decls)
    // The preview bridge reads this handle to mirror runtime docState across peers.
    expect(out).toContain('__opDocStore = store')
    expect(out).toContain("new Event('op-docstore-ready')")
    expect(out).toContain("typeof window !== 'undefined'")
  })

  test('microfrontend state stays module-local and does not publish global runtime events', () => {
    const decls: IRDocStateDecl[] = [
      { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }
    ]
    const out = buildLowcodeStateRuntime(decls, 'shop', { microfrontend: true })

    expect(out).not.toContain('__opDocStore')
    expect(out).not.toContain('op-docstore-ready')
    expect(out).not.toContain('__OPENPENCIL_MOTION_DRIVERS__')
    expect(out).not.toContain('op-motion-drivers-ready')
    expect(out).toContain('const store = createStore<DocState>(() => initial)')
  })
})

describe('React adapter — emit lowcode runtime + zustand inject (Phase 2 §2)', () => {
  test('document with no docStates → no _lowcode_state.ts, no zustand in deps', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)
    expect(out.files.has('src/_lowcode_state.ts')).toBe(false)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies.zustand).toBeUndefined()
  })

  test('document with docStates (single-page) → emits _lowcode_state.ts + zustand dep', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0, persist: true }
      ]
    })
    const pageId = graph.getPages()[0].id
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)

    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)
    const runtime = out.files.get('src/_lowcode_state.ts') as string
    expect(runtime).toContain('cartCount: number')
    expect(runtime).toContain('openpencil:demo:cartCount')

    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies.zustand).toBe(ZUSTAND_VERSION)
  })

  test('multi-page document with docStates → runtime is emitted once + zustand + react-router-dom both injected', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    graph.addPage('About')
    const irs = graph.getPages().map((p) => collectTree(graph, p.id))
    const out = reactAdapter.emit(irs, BASE_OPTIONS)

    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies.zustand).toBe(ZUSTAND_VERSION)
    expect(pkg.dependencies['react-router-dom']).toBeDefined()
  })

  test('page that reads a docState gets `const x = useDocState("x")` + scoped import', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    const pageId = graph.getPages()[0].id
    graph.createNode('TEXT', pageId, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'cartCount' } }
    })
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { useDocState } from './_lowcode_state'`)
    expect(app).toContain(`const cartCount = useDocState("cartCount")`)
    expect(app).toContain('{cartCount}')
    // No setDocState writes on this page → the import line stays minimal.
    expect(app).not.toContain('setDocState')
  })

  test('page computed state emits useMemo and can read page state', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      state: [
        { id: 's1', name: 'count', type: 'number', defaultValue: 2 },
        { id: 's2', name: 'tax', type: 'number', defaultValue: 3 },
        {
          id: 's3',
          name: 'total',
          type: 'number',
          defaultValue: 0,
          computedExpr: 'count + tax'
        }
      ]
    })
    graph.createNode('TEXT', pageId, {
      text: '0',
      bindings: { text: { kind: 'ref', stateId: 's3' } }
    })

    const ir = collectTree(graph, pageId)
    const out = reactAdapter.emit([ir], BASE_OPTIONS)
    const app = out.files.get('src/App.tsx') as string

    expect(ir.warnings?.map((w) => w.code) ?? []).not.toContain('computed-state-invalid')
    expect(app).toContain(`import { useState, useMemo } from 'react'`)
    expect(app).toContain('const [count, setCount] = useState(2)')
    expect(app).toContain('const [tax, setTax] = useState(3)')
    expect(app).toContain('const total = useMemo(() => count + tax, [count, tax])')
    expect(app).toContain('{total}')
  })

  test('computed state can read docState and route/query built-ins before state hooks', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    const pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      lowcodeRoutePattern: '/cart/:id',
      state: [
        {
          id: 's1',
          name: 'summary',
          type: 'string',
          defaultValue: '',
          computedExpr: 'cartCount + $params.id + $query.coupon'
        }
      ]
    })
    graph.addPage('Other')
    graph.createNode('TEXT', pageId, {
      text: '',
      bindings: { text: { kind: 'ref', stateId: 's1' } }
    })

    const irs = graph.getPages().map((p) => collectTree(graph, p.id))
    const out = reactAdapter.emit(irs, BASE_OPTIONS)
    const page = [...out.files.values()].find((content) => content.includes('summary')) as
      | string
      | undefined

    expect(page).toBeDefined()
    expect(page).toContain(`import { useMemo } from 'react'`)
    expect(page).toContain(`import { useParams, useSearchParams } from 'react-router-dom'`)
    expect(page).toContain(`const cartCount = useDocState("cartCount")`)
    expect(page).toContain('const $params = useParams()')
    expect(page).toContain('const $query = Object.fromEntries(useSearchParams()[0])')
    expect(page).toContain(
      'const summary = useMemo(() => cartCount + $params.id + $query.coupon, [cartCount, JSON.stringify($params), JSON.stringify($query)])'
    )
    expect((page as string).indexOf('const cartCount')).toBeLessThan(
      (page as string).indexOf('const summary')
    )
    expect((page as string).indexOf('const $params')).toBeLessThan(
      (page as string).indexOf('const summary')
    )
  })

  test('computed state cycles and unknown identifiers degrade to read-only defaults', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      state: [
        { id: 's1', name: 'a', type: 'number', defaultValue: 1, computedExpr: 'b + 1' },
        { id: 's2', name: 'b', type: 'number', defaultValue: 2, computedExpr: 'a + 1' },
        { id: 's3', name: 'missing', type: 'number', defaultValue: 3, computedExpr: 'nope + 1' }
      ]
    })

    const ir = collectTree(graph, pageId)
    const out = reactAdapter.emit([ir], BASE_OPTIONS)
    const app = out.files.get('src/App.tsx') as string

    expect(ir.warnings?.map((w) => w.code)).toContain('computed-state-cycle')
    expect(ir.warnings?.map((w) => w.code)).toContain('computed-state-unknown')
    expect(app).not.toContain('useMemo')
    expect(app).toContain('const a = 1')
    expect(app).toContain('const b = 2')
    expect(app).toContain('const missing = 3')
  })

  test('setState and controlled value bindings cannot write computed state', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      state: [
        { id: 's1', name: 'count', type: 'number', defaultValue: 1 },
        {
          id: 's2',
          name: 'doubleCount',
          type: 'number',
          defaultValue: 0,
          computedExpr: 'count * 2'
        }
      ]
    })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [{ id: 'a1', kind: 'setState', targetStateId: 's2', valueExpr: '4' }]
      }
    })
    graph.createNode('INPUT', pageId, {
      bindings: { value: { kind: 'ref', stateId: 's2' } }
    })

    const ir = collectTree(graph, pageId)
    const out = reactAdapter.emit([ir], BASE_OPTIONS)
    const app = out.files.get('src/App.tsx') as string

    expect(ir.warnings?.map((w) => w.code)).toContain('action-setstate-computed-target')
    expect(ir.warnings?.map((w) => w.code)).toContain('binding-value-computed-state')
    expect(app).not.toContain('setDoubleCount')
    expect(app).not.toContain('value={doubleCount}')
  })

  test('page that writes a docState (setVariable) imports only setDocState — no useDocState hook call', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    const pageId = graph.getPages()[0].id
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          {
            id: 'a1',
            kind: 'setVariable',
            targetName: 'cartCount',
            valueExpr: '$prev + 1'
          }
        ]
      }
    })
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { setDocState } from './_lowcode_state'`)
    expect(app).not.toContain('useDocState')
    expect(app).toContain(`setDocState("cartCount", (prev) => prev + 1)`)
  })

  test('page that both reads and writes → both names imported', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    const pageId = graph.getPages()[0].id
    graph.createNode('TEXT', pageId, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'cartCount' } }
    })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          {
            id: 'a1',
            kind: 'setVariable',
            targetName: 'cartCount',
            valueExpr: '5'
          }
        ]
      }
    })
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { useDocState, setDocState } from './_lowcode_state'`)
    expect(app).toContain('const cartCount = useDocState("cartCount")')
    expect(app).toContain('setDocState("cartCount", 5)')
  })

  test('multi-page: page modules import from `../_lowcode_state` (relative back to src/)', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    const homeId = graph.getPages()[0].id
    graph.createNode('TEXT', homeId, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'cartCount' } }
    })
    graph.addPage('About')
    const irs = graph.getPages().map((p) => collectTree(graph, p.id))
    const out = reactAdapter.emit(irs, BASE_OPTIONS)

    // First page becomes `src/pages/index.tsx`.
    const home = out.files.get('src/pages/index.tsx') as string
    expect(home).toContain(`from '../_lowcode_state'`)
  })

  test('page that neither reads nor writes any docState skips the runtime import', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    const homeId = graph.getPages()[0].id
    // Home reads cartCount; About does not.
    graph.createNode('TEXT', homeId, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'cartCount' } }
    })
    graph.addPage('About')
    const irs = graph.getPages().map((p) => collectTree(graph, p.id))
    const out = reactAdapter.emit(irs, BASE_OPTIONS)

    const about = out.files.get('src/pages/about.tsx') as string
    expect(about).not.toContain('_lowcode_state')
    expect(about).not.toContain('useDocState')
    expect(about).not.toContain('setDocState')
  })
})
