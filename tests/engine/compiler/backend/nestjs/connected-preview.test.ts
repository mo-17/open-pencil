import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  nestJSPreviewApplicationDigest,
  validateNestJSConnectedPreview,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'

import { browserApplication, browserGraph } from './browser-client/helpers'

function fixture(target: 'react' | 'vue' = 'react') {
  const graph = browserGraph()
  const application = browserApplication()
  const selection: BackendProviderSelection = {
    descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: `sha256:${'A'.repeat(43)}`,
    enabled: true
  }
  const options = withDefaults({
    target,
    devMode: true,
    router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
    backendProvider: { selection, application },
    backendPreview: {
      kind: 'nestjs-local',
      applicationDigest: nestJSPreviewApplicationDigest(application)
    }
  })
  const api = application.httpApi
  const preview = options.backendPreview
  if (!api || !preview) throw new Error('Incomplete fixture')
  return { ...graph, application, selection, options, api, preview }
}

function build(input: ReturnType<typeof fixture>) {
  return compile({
    graph: input.graph,
    pageIds: [input.login.id, input.notes.id],
    options: input.options
  })
}

describe('explicit desktop NestJS frontend preview', () => {
  test.each(['react', 'vue'] as const)(
    'emits %s live client without server artifacts or document mirroring',
    (target) => {
      const output = build(fixture(target))
      expect(output.files.has('src/lowcode-backend-auth.ts')).toBe(true)
      expect(output.files.has('src/lowcode-backend.ts')).toBe(true)
      expect([...output.files.keys()].filter((path) => path.startsWith('backend/'))).toEqual([])
      expect(output.files.has('BACKEND-CLIENT.md')).toBe(false)
      expect(output.files.has('openpencil-local-app.json')).toBe(false)
      expect(output.artifactOwnership).toBeUndefined()
      expect(output.warnings.filter((warning) => warning.code.includes('backend'))).toEqual([
        expect.objectContaining({ code: 'backend-preview-external-service' })
      ])
      const bridge = String(output.files.get('src/__preview-bridge.ts'))
      expect(bridge).toContain('const MIRROR_DOCUMENT_STATE = false')
      expect(bridge).toContain('if (!MIRROR_DOCUMENT_STATE) return')
      expect(bridge).toContain("type: 'select'")
      expect(String(output.files.get('vite.config.ts'))).not.toContain('proxy:')
    }
  )

  test('visual edits keep the authentication module stable for HMR', () => {
    const input = fixture()
    const before = build(input)
    const title = [...input.graph.getAllNodes()].find((node) => node.type === 'TEXT')
    if (!title) throw new Error('Expected title')
    input.graph.updateNode(title.id, { text: 'Updated note heading', fontSize: 22 })
    const after = build(input)
    expect(after.files.get('src/lowcode-backend-auth.ts')).toBe(
      before.files.get('src/lowcode-backend-auth.ts')
    )
    expect(after.files.get('src/lowcode-backend.ts')).toBe(
      before.files.get('src/lowcode-backend.ts')
    )
    expect(after.files.get('src/__preview-bridge.ts')).toBe(
      before.files.get('src/__preview-bridge.ts')
    )
    expect(
      [...after.files].some(
        ([path, source]) => path.endsWith('.tsx') && source !== before.files.get(path)
      )
    ).toBe(true)
  })

  test.each([
    'missing',
    'production',
    'production-mode',
    'prototype',
    'microfrontend',
    'missing-provider',
    'digest',
    'extra',
    'accessor'
  ] as const)('rejects %s preview authority', (fault) => {
    const input = fixture()
    if (fault === 'missing') delete input.options.backendPreview
    if (fault === 'production') input.options.devMode = false
    if (fault === 'production-mode') input.options.backendCompilationMode = 'production'
    if (fault === 'prototype') input.options.backendCompilationMode = 'source-only-prototype'
    if (fault === 'microfrontend')
      input.options.packaging = {
        kind: 'microfrontend',
        appId: 'test-preview'
      }
    if (fault === 'missing-provider') delete input.options.backendProvider
    if (fault === 'digest')
      input.options.backendPreview = { kind: 'nestjs-local', applicationDigest: 'invalid' }
    if (fault === 'extra') Object.assign(input.preview, { target: 'http://evil.invalid' })
    if (fault === 'accessor')
      Object.defineProperty(input.preview, 'applicationDigest', {
        get: () => 'wrong',
        enumerable: true
      })
    expect(() => build(input)).toThrow()
  })

  test('model changes invalidate the previously connected service', () => {
    const input = fixture()
    input.api.resources[0].maxPageSize = 99
    expect(() => build(input)).toThrow('backend-preview-application-changed')
  })

  test('ordinary preview Provider planning remains fail-closed', () => {
    const input = fixture()
    const result = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection: input.selection,
      application: input.application,
      target: 'react',
      mode: 'preview'
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(
        result.diagnostics.some(
          (entry) => entry.code === 'backend-preview-server-capability-unavailable'
        )
      ).toBe(true)
  })

  test.each(['/_openpencil', '/_openpencil/preview-contract', '/_OPENPENCIL/auth'])(
    'reserves %s only for connected preview',
    (path) => {
      const input = fixture()
      input.api.resources[0].path = path
      const result = validateNestJSConnectedPreview({
        selection: input.selection,
        application: input.application,
        target: 'react',
        applicationDigest: nestJSPreviewApplicationDigest(input.application)
      })
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'backend-preview-resource-path-reserved' })]
      })
      expect(
        createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
          selection: input.selection,
          application: input.application,
          target: 'react',
          mode: 'production'
        }).ok
      ).toBe(true)
    }
  )

  test('does not reserve an unrelated resource name sharing the namespace prefix', () => {
    const input = fixture()
    input.api.resources[0].path = '/_openpencil_notes'
    expect(
      validateNestJSConnectedPreview({
        selection: input.selection,
        application: input.application,
        target: 'react',
        applicationDigest: nestJSPreviewApplicationDigest(input.application)
      }).ok
    ).toBe(true)
  })

  test.each(['disabled', 'foreign', 'missing-client', 'roles', 'capability'] as const)(
    'pure validation rejects %s',
    (fault) => {
      const input = fixture()
      if (fault === 'disabled') Object.assign(input.selection, { enabled: false })
      if (fault === 'foreign')
        Object.assign(input.selection, { descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR })
      if (fault === 'missing-client') delete input.api.browserClient
      if (fault === 'roles') input.application.auth.roles.push({ id: 'admin', name: 'Admin' })
      if (fault === 'capability')
        input.application.capabilities.push({ capability: 'server.functions', required: false })
      const result = validateNestJSConnectedPreview({
        selection: input.selection,
        application: input.application,
        target: 'react',
        applicationDigest: input.preview.applicationDigest
      })
      expect(result.ok).toBe(false)
    }
  )
})
