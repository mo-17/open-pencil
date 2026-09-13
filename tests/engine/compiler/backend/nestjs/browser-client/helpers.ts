import { compile, withDefaults } from '@open-pencil/compiler'
import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from '@open-pencil/compiler/backend'
import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { SceneGraph, type ActionDef } from '@open-pencil/scene-graph'

import { nestJSApplication } from '../helpers'

export function browserApplication() {
  const application = structuredClone(nestJSApplication())
  if (!application.httpApi) throw new Error('HTTP declaration required.')
  application.httpApi.browserClient = {
    version: 1,
    apiBasePath: '/api',
    authentication: {
      kind: 'oidc-pkce',
      issuer: 'http://127.0.0.1:4010',
      clientId: 'notes-public-client',
      scopes: ['openid', 'email'],
      callbackPath: '/_openpencil/auth/callback'
    }
  }
  const resource = application.httpApi.resources[0]
  resource.operations = ['list', 'read', 'create', 'update', 'delete']
  resource.createFields = ['title']
  resource.updateFields = ['title']
  application.auth.rowAccess[0].operations = ['select', 'insert', 'update', 'delete']
  application.capabilities.push({ capability: 'data.write', required: true })
  const parsed = parseBackendApplicationSpecV1(application)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
  return parsed.value
}
export function browserGraph() {
  const graph = new SceneGraph()
  const login = graph.getPages()[0]
  graph.updateNode(login.id, { name: 'Login', lowcodeRoutePattern: '/login' })
  const notes = graph.createNode('CANVAS', graph.rootId, {
    name: 'Notes',
    lowcodeRoutePattern: '/notes',
    lowcodeRequiresAuth: true
  })
  graph.updateNode(graph.rootId, {
    lowcodeAuthRedirect: '/login',
    lowcodeDocumentState: [
      { id: 'title', name: 'title', type: 'string', defaultValue: '' },
      { id: 'cursor', name: 'cursor', type: 'string', defaultValue: '' },
      { id: 'result', name: 'result', type: 'object', defaultValue: {} },
      { id: 'error', name: 'error', type: 'string', defaultValue: '' }
    ]
  })
  graph.createNode('BUTTON', login.id, {
    name: 'Login',
    events: {
      onClick: [
        {
          id: 'login',
          kind: 'backendAuth',
          operation: 'signIn',
          returnPath: '/notes',
          errorTarget: 'error'
        }
      ]
    }
  })
  graph.createNode('BUTTON', notes.id, {
    name: 'Logout',
    events: { onClick: [{ id: 'logout', kind: 'backendAuth', operation: 'signOut' }] }
  })
  const list = graph.createNode('LIST', notes.id, {
    name: 'Notes',
    interactiveProps: {
      dataSourceRef: {
        kind: 'backendResource',
        resourceId: 'notes-api',
        limit: 10,
        nextCursorTarget: 'cursor',
        errorTarget: 'error'
      },
      itemName: 'note'
    }
  })
  const row = graph.createNode('FRAME', list.id, { name: 'Note' })
  graph.createNode('TEXT', row.id, {
    name: 'Title',
    text: 'Note',
    bindings: { text: { kind: 'expr', expr: 'note.title' } }
  })
  graph.createNode('BUTTON', row.id, {
    name: 'Delete',
    events: {
      onClick: [
        {
          id: 'delete',
          kind: 'backendRequest',
          resourceId: 'notes-api',
          operation: 'delete',
          idExpr: 'note.id',
          errorTarget: 'error'
        }
      ]
    }
  })
  const form = graph.createNode('FORM', notes.id, {
    name: 'Create',
    events: {
      onSubmit: [
        {
          id: 'create',
          kind: 'backendRequest',
          resourceId: 'notes-api',
          operation: 'create',
          payloadEntries: [{ key: 'title', valueExpr: 'title' }],
          resultTarget: 'result',
          errorTarget: 'error',
          onSuccess: [{ id: 'clear', kind: 'setVariable', targetName: 'title', valueExpr: '""' }]
        }
      ]
    }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Title',
    bindings: { value: { kind: 'docState', docStateName: 'title' } },
    interactiveProps: { validation: { required: true } }
  })
  graph.createNode('BUTTON', form.id, { name: 'Save' })
  return { graph, login, notes, list, form }
}
export function compileBrowser(
  target: 'react' | 'vue',
  fixture = browserGraph(),
  application = browserApplication()
) {
  return compile({
    graph: fixture.graph,
    pageIds: [fixture.login.id, fixture.notes.id],
    options: withDefaults({
      target,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      devMode: false,
      backendProvider: {
        selection: {
          descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
          packageDigest: `sha256:${'A'.repeat(43)}`,
          enabled: true
        },
        application
      }
    })
  })
}
export function setSubmit(fixture: ReturnType<typeof browserGraph>, action: ActionDef): void {
  fixture.graph.updateNode(fixture.form.id, { events: { onSubmit: [action] } })
}
