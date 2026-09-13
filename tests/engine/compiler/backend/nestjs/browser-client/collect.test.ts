import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { browserApplication, browserGraph, compileBrowser, setSubmit } from './helpers'

describe('Backend browser frontend compilation', () => {
  test.each(['react', 'vue'] as const)(
    'emits %s login, guarded notes, list and validated CRUD from the real graph',
    (target) => {
      const output = compileBrowser(target)
      const pageSources = [...output.files]
        .filter(([path]) => /src\/(pages\/|App\.)/.test(path))
        .map(([, source]) => source)
        .join('\n')
      expect(
        output.warnings.filter((warning) =>
          /backend|supabase|auth-guard|unsupported/.test(warning.code)
        )
      ).toEqual([])
      expect(pageSources).toContain('__opBackend.signIn("/notes")')
      expect(pageSources).toContain('__opBackend.signOut()')
      expect(pageSources).toContain('__opBackend.watchBackendResource')
      expect(pageSources).toContain('resourceId: "notes-api"')
      expect(pageSources).toContain('operation: "delete"')
      expect(pageSources).toContain('__validateFields')
      expect(pageSources).toContain('.ready')
      expect([...output.files.keys()].some((path) => path.includes('supabase'))).toBe(false)
      expect(String(output.files.get('src/main.' + (target === 'vue' ? 'ts' : 'tsx')))).toContain(
        "initializeBackendClient().then(() => import('./lowcode-backend-mount'))"
      )
      expect(String(output.files.get('BACKEND-CLIENT.md'))).toContain('"loginPath": "/login"')
      expect(JSON.parse(String(output.files.get('openpencil-local-app.json')))).toEqual({
        version: 1,
        loginPath: '/login'
      })
      expect(String(output.files.get('BACKEND-CLIENT.md'))).toContain('does not automatically load')
      expect(String(output.files.get('vite.config.ts'))).toContain(
        "target: 'http://127.0.0.1:3000'"
      )
      expect(
        JSON.parse(String(output.files.get('package.json'))).dependencies['openid-client']
      ).toBe('6.8.8')
    }
  )
  test.each(['resource', 'field', 'scope', 'missing-client'] as const)(
    'fails closed for invalid %s instead of dropping an action',
    (fault) => {
      const fixture = browserGraph()
      const application = browserApplication()
      if (fault === 'missing-client' && application.httpApi)
        delete application.httpApi.browserClient
      setSubmit(fixture, {
        id: 'bad',
        kind: 'backendRequest',
        resourceId: fault === 'resource' ? 'missing' : 'notes-api',
        operation: 'create',
        payloadEntries: [
          {
            key: fault === 'field' ? 'owner_id' : 'title',
            valueExpr: fault === 'scope' ? 'unknownValue' : 'title'
          }
        ]
      })
      expect(() => compileBrowser('react', fixture, application)).toThrow()
    }
  )
  test.each(['persist', 'computed'] as const)(
    'rejects %s request and LIST output state after IR projection',
    (fault) => {
      for (const target of ['result', 'cursor']) {
        const fixture = browserGraph()
        const root = fixture.graph.getNode(fixture.graph.rootId)
        if (!root) throw new Error('Missing fixture root')
        fixture.graph.updateNode(root.id, {
          lowcodeDocumentState: root.lowcodeDocumentState?.map((state) =>
            state.name === target
              ? {
                  ...state,
                  ...(fault === 'persist' ? { persist: true } : { computedExpr: '"derived"' })
                }
              : state
          )
        })
        expect(() => compileBrowser('react', fixture)).toThrow()
      }
    }
  )
  test.each(['react', 'vue'] as const)(
    'keeps %s pagination state reads and all CRUD result branches',
    (target) => {
      const fixture = browserGraph()
      fixture.graph.updateNode(fixture.notes.id, {
        state: [{ id: 'after', name: 'after', type: 'string', defaultValue: '' }]
      })
      fixture.graph.updateNode(fixture.list.id, {
        interactiveProps: {
          ...fixture.list.interactiveProps,
          dataSourceRef: {
            kind: 'backendResource',
            resourceId: 'notes-api',
            afterExpr: 'after',
            nextCursorTarget: 'cursor'
          }
        }
      })
      fixture.graph.createNode('BUTTON', fixture.notes.id, {
        name: 'Next page',
        events: {
          onClick: [{ id: 'next', kind: 'setState', targetStateId: 'after', valueExpr: 'cursor' }]
        }
      })
      setSubmit(fixture, {
        id: 'update',
        kind: 'backendRequest',
        resourceId: 'notes-api',
        operation: 'update',
        idExpr: 'result.id',
        payloadEntries: [{ key: 'title', valueExpr: 'title' }],
        resultTarget: 'result',
        onSuccess: [
          {
            id: 'read',
            kind: 'backendRequest',
            resourceId: 'notes-api',
            operation: 'read',
            idExpr: 'data.id',
            resultTarget: 'result',
            onSuccess: [
              { id: 'copy', kind: 'setVariable', targetName: 'title', valueExpr: 'data.title' }
            ]
          }
        ]
      })
      const output = compileBrowser(target, fixture)
      expect(
        output.warnings.filter((warning) => /action|backend|binding/.test(warning.code))
      ).toEqual([])
      const sources = [...output.files]
        .filter(([path]) => /src\/pages\//.test(path))
        .map(([, content]) => String(content))
        .join('\n')
      expect(sources).toContain('operation: "update"')
      expect(sources).toContain('operation: "read"')
      expect(sources).toContain('data.id')
      expect(sources).toContain('data.title')
      if (target === 'react') {
        expect(sources).toContain('setAfter(cursor)')
        expect(sources).toContain('), [after])')
      } else {
        expect(sources).toMatch(/__opState_after_\w+\.value = __opDoc_cursor_\w+\.value/u)
        expect(sources).toMatch(/String\(__opState_after_\w+\.value\)/u)
      }
    }
  )
  test('startup guide uses the authored login route after a template route collision', () => {
    const fixture = browserGraph()
    fixture.graph.updateNode(fixture.graph.rootId, { lowcodeAuthRedirect: '/login-2' })
    fixture.graph.updateNode(fixture.login.id, { lowcodeRoutePattern: '/login-2' })
    const output = compileBrowser('react', fixture)
    expect(String(output.files.get('BACKEND-CLIENT.md'))).toContain('"loginPath": "/login-2"')
    expect(JSON.parse(String(output.files.get('openpencil-local-app.json'))).loginPath).toBe(
      '/login-2'
    )
  })
  test.each(['//external.example/login', '/missing', '/notes'])(
    'rejects unsafe or unavailable failure recovery route %s',
    (path) => {
      const fixture = browserGraph()
      fixture.graph.updateNode(fixture.graph.rootId, { lowcodeAuthRedirect: path })
      expect(() => compileBrowser('react', fixture)).toThrow(
        'Backend login requires an exported, unprotected application route.'
      )
    }
  )
  test('rejects backend actions without an explicit authoritative application', () => {
    const { graph, notes } = browserGraph()
    expect(() =>
      compile({ graph, pageIds: [notes.id], options: withDefaults({ devMode: false }) })
    ).toThrow('backend-client-binding-invalid')
  })
  test('keeps old Supabase bindings incompatible with Nest browser authentication', () => {
    const fixture = browserGraph()
    fixture.graph.updateNode(fixture.graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'sb_publishable_example'
      }
    })
    expect(() => compileBrowser('vue', fixture)).toThrow('backend-provider-client-runtime-conflict')
  })
})
