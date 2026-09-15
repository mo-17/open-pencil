import { describe, expect, test } from 'bun:test'

import { shallowRef } from 'vue'

import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'
import { SceneGraph } from '@open-pencil/scene-graph'

import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import {
  createEmptyBackendApplication,
  readBackendProviderDocumentRequest
} from '@/app/lowcode/backend/document'
import type { BackendLibraryTemplateId } from '@/app/lowcode/backend/library/catalog'
import { isBusinessTemplate } from '@/app/lowcode/backend/library/catalog'
import { backendLibraryCopy } from '@/app/lowcode/backend/library/copy'
import {
  createBackendLibraryInstaller,
  hasBackendAuthenticationFlow,
  isEmptyBackendLibraryDraft,
  type BackendLibraryInstallResult
} from '@/app/lowcode/backend/library/install'
import { backendProviderDescriptorKey } from '@/app/lowcode/backend/library/provider-identity'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  AppBackendProviderBuildError,
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

function authentication(): BackendHttpAPIOIDCAuthenticationIRV1 {
  return {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'public-browser',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  }
}

async function fixture() {
  const store = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter((entry) =>
      [
        'open-pencil.nestjs-backend',
        'open-pencil.supabase-backend',
        'open-pencil.vr-tour',
        'open-pencil.video'
      ].includes(entry.manifest.plugin.id)
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  await store.install('open-pencil.vr-tour')
  await store.setEnabled('open-pencil.vr-tour', true)
  await store.install('open-pencil.video')
  await store.setEnabled('open-pencil.video', true)
  const descriptor = listAppBackendProviderDescriptors(store).find(
    (entry) => entry.providerId === 'nestjs'
  )
  if (!descriptor) throw new Error('Missing NestJS provider')
  const editor = createEditor()
  const draft = shallowRef(createEmptyBackendApplication('user-selected-application'))
  const busy = shallowRef(false),
    readError = shallowRef('')
  const selectedKey = shallowRef('unrelated-provider-selection')
  const created: BackendLibraryInstallResult[] = [],
    failures: unknown[] = []
  let active = true
  const installer = createBackendLibraryInstaller({
    editor,
    store: {
      installedBackendProviders: () => (active ? store.installedBackendProviders() : []),
      installedModules: () => store.installedModules()
    },
    draft,
    busy,
    readError,
    locale: () => 'en',
    started: () => undefined,
    created: (result) => {
      const request = readBackendProviderDocumentRequest(editor.graph)
      if (!request) throw new Error('Missing committed request')
      draft.value = structuredClone(request.application)
      selectedKey.value = backendProviderDescriptorKey(request.selection)
      created.push(result)
    },
    failed: (error) => {
      failures.push(error)
    }
  })
  return {
    store,
    editor,
    draft,
    busy,
    readError,
    selectedKey,
    created,
    failures,
    installer,
    providerKey: backendProviderDescriptorKey(descriptor),
    deactivate: () => {
      active = false
    }
  }
}

const templatePageCounts = {
  'personal-notes': 2,
  'single-sku-shop': 4,
  'single-merchant-shop': 5,
  'multi-merchant-marketplace': 7,
  'single-merchant-commerce': 12,
  'multi-merchant-commerce': 12,
  'customer-crm': 3,
  'service-desk': 4,
  'content-knowledge-base': 6,
  'booking-registration': 5,
  'project-tasks': 4,
  'rental-viewing': 6,
  'video-live': 7,
  'food-ordering': 8,
  'hospital-registration': 11,
  'personal-blog': 7,
  'automotive-news': 12,
  'procurement-inventory': 9,
  'enterprise-approvals': 8,
  'survey-forms': 7,
  'online-courses': 9,
  'community-forum': 11,
  'asset-management': 7,
  'quote-contracts': 7,
  'recruitment-hr': 7
} as const satisfies Record<BackendLibraryTemplateId, number>

function templateEntryPath(template: BackendLibraryTemplateId): string {
  if (!isBusinessTemplate(template)) return template === 'personal-notes' ? '/notes' : '/shop'
  const definition = businessTemplateDefinition(template)
  const page = definition.pages.find((entry) => entry.id === definition.entryPage)
  if (!page) throw new Error('Missing template entry page')
  return page.path
}

describe('backend library installation controller', () => {
  test('requires an enabled Video plugin before creating video pages or backend state', async () => {
    const value = await fixture()
    await value.store.setEnabled('open-pencil.video', false)
    const before = value.editor.snapshotDocument()
    expect(await value.installer.create('video-live', authentication(), value.providerKey)).toBe(
      false
    )
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
    expect(value.editor.undo.canUndo).toBe(false)
    expect(value.failures).toHaveLength(1)
    expect(String(value.failures[0])).toContain('Install and enable Video')
  })

  test('requires the enabled VR plugin before mutating a rental document', async () => {
    const value = await fixture()
    await value.store.setEnabled('open-pencil.vr-tour', false)
    const before = value.editor.snapshotDocument()
    expect(
      await value.installer.create('rental-viewing', authentication(), value.providerKey)
    ).toBe(false)
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
    expect(value.editor.undo.canUndo).toBe(false)
    expect(value.failures).toHaveLength(1)
    expect(value.failures[0]).toBeInstanceOf(AppBackendProviderBuildError)
    expect(String(value.failures[0])).toContain('Install and enable OpenPencil VR Tour')
  })

  test.each(Object.keys(templatePageCounts) as BackendLibraryTemplateId[])(
    'creates %s with the selected public OIDC and one undo',
    async (template) => {
      const value = await fixture()
      const originalPages = value.editor.graph.getPages().map((page) => page.id)
      value.editor.graph.updateNode(value.editor.graph.rootId, {
        pluginData: [{ pluginId: 'keep', key: 'keep', value: 'untouched' }],
        lowcodeDocumentState: [
          { id: 'keep', name: 'existingValue', type: 'string', defaultValue: 'untouched' }
        ]
      })
      const snapshot = value.editor.snapshotDocument()
      expect(value.installer.blockReason()).toBe('')
      const installed = await value.installer.create(template, authentication(), value.providerKey)
      expect(value.failures).toEqual([])
      expect(installed).toBe(true)
      expect(value.failures).toEqual([])
      expect(value.created).toHaveLength(1)
      expect(value.selectedKey.value).toBe(value.providerKey)
      const request = readBackendProviderDocumentRequest(value.editor.graph)
      expect(request?.application.applicationId).toBe('user-selected-application')
      expect(request?.application.httpApi?.browserClient?.authentication).toEqual(authentication())
      expect(value.editor.state.currentPageId).toBe(value.created[0].pageId)
      expect(value.editor.graph.getNode(value.created[0].pageId)?.lowcodeRoutePattern).toBe(
        templateEntryPath(template)
      )
      if (
        template === 'single-merchant-shop' ||
        template === 'multi-merchant-marketplace' ||
        isBusinessTemplate(template)
      ) {
        expect(
          value.editor.graph
            .getPages()
            .filter((page) => !originalPages.includes(page.id))
            .map((page) => page.name)
            .sort()
        ).toEqual([...backendLibraryCopy('en').templates[template].pages].sort())
      }
      expect(value.installer.blockReason()).toBe('document')
      expect(await value.installer.create(template, authentication(), value.providerKey)).toBe(
        false
      )
      value.editor.undo.undo()
      expect(value.editor.graph.getPages().map((page) => page.id)).toEqual(originalPages)
      expect(value.editor.documentSnapshotChanged(snapshot)).toBe(false)
      value.editor.undo.redo()
      expect(value.editor.graph.getPages()).toHaveLength(
        originalPages.length + templatePageCounts[template]
      )
    }
  )

  test('reviews operations commission explicitly without applying it to legacy templates', async () => {
    const value = await fixture()
    const before = value.editor.snapshotDocument()
    for (const commission of [-1, 0.5, 10001, Number.NaN]) {
      expect(
        await value.installer.create(
          'single-merchant-commerce',
          authentication(),
          value.providerKey,
          commission
        )
      ).toBe(false)
      expect(value.editor.documentSnapshotChanged(before)).toBe(false)
    }
    expect(
      await value.installer.create('single-merchant-shop', authentication(), value.providerKey, 100)
    ).toBe(false)
    expect(value.editor.documentSnapshotChanged(before)).toBe(false)
    expect(
      await value.installer.create(
        'multi-merchant-commerce',
        authentication(),
        value.providerKey,
        175
      )
    ).toBe(true)
    expect(
      readBackendProviderDocumentRequest(value.editor.graph)?.application.commerce
    ).toMatchObject({ commissionBasisPoints: 175, mode: 'multi-merchant' })
  })

  test('rejects unknown template IDs without falling back to a commerce model', async () => {
    const value = await fixture()
    const snapshot = value.editor.snapshotDocument()
    expect(await value.installer.create('merchant-shop', authentication(), value.providerKey)).toBe(
      false
    )
    expect(value.created).toEqual([])
    expect(value.failures).toHaveLength(1)
    expect(value.editor.documentSnapshotChanged(snapshot)).toBe(false)
  })

  test.each([
    ['commands', { version: 1, commands: [] }],
    ['httpApi', {}],
    ['storage', { version: 1, buckets: [] }],
    ['capabilities', [{ capability: 'server.functions', required: false }]],
    ['secrets', [{ kind: 'environment', name: 'CUSTOM', exposure: 'server', required: true }]],
    ['workflows', { version: 1, workflows: [{}] }],
    ['unknownDraftConfiguration', undefined]
  ] as const)('preserves customized or invalid %s drafts', async (key, data) => {
    const value = await fixture()
    Reflect.set(value.draft.value, key, structuredClone(data))
    const snapshot = value.editor.snapshotDocument()
    const originalDraft = structuredClone(value.draft.value)
    expect(value.installer.blockReason()).toBe('draft')
    expect(
      await value.installer.create('personal-notes', authentication(), value.providerKey)
    ).toBe(false)
    expect(value.draft.value).toEqual(originalDraft)
    expect(value.selectedKey.value).toBe('unrelated-provider-selection')
    expect(value.editor.documentSnapshotChanged(snapshot)).toBe(false)
  })

  test('empty draft detection preserves invalid nested values and never invokes authored getters', () => {
    const draft = createEmptyBackendApplication('application')
    expect(isEmptyBackendLibraryDraft(draft)).toBe(true)
    Reflect.set(draft.auth, 'unfinished', undefined)
    expect(isEmptyBackendLibraryDraft(draft)).toBe(false)
    Reflect.deleteProperty(draft.auth, 'unfinished')
    let reads = 0
    Object.defineProperty(draft, 'custom', {
      enumerable: true,
      get: () => {
        reads++
        return 'value'
      }
    })
    expect(isEmptyBackendLibraryDraft(draft)).toBe(false)
    expect(reads).toBe(0)
  })

  test.each([
    'redirect',
    'protected-page',
    'legacy-auth',
    'malformed-backend',
    'read-error'
  ] as const)('blocks an existing %s flow before mutation', async (mode) => {
    const value = await fixture()
    const root = value.editor.graph.rootId
    if (mode === 'redirect') value.editor.graph.updateNode(root, { lowcodeAuthRedirect: '' })
    if (mode === 'protected-page')
      value.editor.graph.updateNode(value.editor.graph.getPages()[0].id, {
        lowcodeRequiresAuth: true
      })
    if (mode === 'legacy-auth')
      value.editor.graph.updateNode(root, {
        lowcodeSupabaseConfig: { url: 'https://example.supabase.co', anonKey: 'public' }
      })
    if (mode === 'malformed-backend')
      value.editor.graph.updateNode(root, {
        pluginData: [
          { pluginId: 'open-pencil', key: 'lowcode/backendProvider.v1', value: '{invalid' }
        ]
      })
    if (mode === 'read-error') value.readError.value = 'Invalid declaration'
    const snapshot = value.editor.snapshotDocument()
    expect(value.installer.blockReason()).toBe(
      mode === 'malformed-backend' || mode === 'read-error' ? 'read-error' : 'document'
    )
    expect(
      await value.installer.create('single-sku-shop', authentication(), value.providerKey)
    ).toBe(false)
    expect(value.editor.documentSnapshotChanged(snapshot)).toBe(false)
    expect(value.selectedKey.value).toBe('unrelated-provider-selection')
    if (['redirect', 'protected-page', 'legacy-auth'].includes(mode))
      expect(hasBackendAuthenticationFlow(value.editor.graph)).toBe(true)
  })

  test.each(['provider', 'draft', 'auth', 'graph'] as const)(
    'rechecks a raced %s before committing',
    async (mode) => {
      const value = await fixture()
      const pending = value.installer.create('personal-notes', authentication(), value.providerKey)
      if (mode === 'provider') value.deactivate()
      if (mode === 'draft') value.draft.value.applicationId = 'changed-after-click'
      if (mode === 'auth')
        value.editor.graph.updateNode(value.editor.graph.rootId, {
          lowcodeAuthRedirect: '/existing'
        })
      if (mode === 'graph') value.editor.replaceGraph(new SceneGraph())
      const snapshot = value.editor.snapshotDocument()
      expect(await pending).toBe(false)
      expect(value.created).toEqual([])
      expect(value.selectedKey.value).toBe('unrelated-provider-selection')
      expect(value.editor.documentSnapshotChanged(snapshot)).toBe(false)
      expect(value.busy.value).toBe(false)
    }
  )

  test('rejects unavailable, stale and non-NestJS provider keys without selecting them', async () => {
    const value = await fixture()
    const other = listAppBackendProviderDescriptors(value.store).find(
      (entry) => entry.providerId === 'supabase'
    )
    if (!other) throw new Error('Missing alternate provider')
    for (const key of ['', value.providerKey + '-stale', backendProviderDescriptorKey(other)])
      expect(await value.installer.create('personal-notes', authentication(), key)).toBe(false)
    await value.store.setEnabled('open-pencil.nestjs-backend', false)
    expect(
      await value.installer.create('single-sku-shop', authentication(), value.providerKey)
    ).toBe(false)
    expect(value.selectedKey.value).toBe('unrelated-provider-selection')
    expect(readBackendProviderDocumentRequest(value.editor.graph)).toBeNull()
  })

  test('snapshots public authentication and rejects credential-bearing input without invoking getters', async () => {
    const value = await fixture()
    const invalid = authentication()
    let reads = 0
    Object.defineProperty(invalid, 'clientSecret', {
      enumerable: true,
      get: () => {
        reads++
        return 'private'
      }
    })
    expect(await value.installer.create('personal-notes', invalid, value.providerKey)).toBe(false)
    expect(reads).toBe(0)
    expect(readBackendProviderDocumentRequest(value.editor.graph)).toBeNull()
    const original = authentication()
    const running = value.installer.create('personal-notes', original, value.providerKey)
    original.issuer = 'https://changed.example.com'
    expect(await running).toBe(true)
    expect(
      readBackendProviderDocumentRequest(value.editor.graph)?.application.httpApi?.browserClient
        ?.authentication.issuer
    ).toBe('https://identity.example.com')
  })

  test('serializes repeated clicks into a single installation', async () => {
    const value = await fixture()
    const first = value.installer.create('personal-notes', authentication(), value.providerKey)
    expect(value.installer.blockReason()).toBe('busy')
    expect(
      await value.installer.create('single-sku-shop', authentication(), value.providerKey)
    ).toBe(false)
    expect(await first).toBe(true)
    expect(value.created).toHaveLength(1)
    expect(value.editor.graph.getPages()).toHaveLength(3)
  })

  test.each([
    ['personal-notes', 'react'],
    ['personal-notes', 'vue'],
    ['single-sku-shop', 'react'],
    ['single-sku-shop', 'vue'],
    ['single-merchant-shop', 'react'],
    ['single-merchant-shop', 'vue'],
    ['multi-merchant-marketplace', 'react'],
    ['multi-merchant-marketplace', 'vue'],
    ['single-merchant-commerce', 'react'],
    ['single-merchant-commerce', 'vue'],
    ['multi-merchant-commerce', 'react'],
    ['multi-merchant-commerce', 'vue'],
    ['customer-crm', 'react'],
    ['customer-crm', 'vue'],
    ['service-desk', 'react'],
    ['service-desk', 'vue'],
    ['content-knowledge-base', 'react'],
    ['content-knowledge-base', 'vue'],
    ['booking-registration', 'react'],
    ['booking-registration', 'vue'],
    ['project-tasks', 'react'],
    ['project-tasks', 'vue'],
    ['rental-viewing', 'react'],
    ['rental-viewing', 'vue'],
    ['video-live', 'react'],
    ['video-live', 'vue'],
    ['food-ordering', 'react'],
    ['food-ordering', 'vue'],
    ['hospital-registration', 'react'],
    ['hospital-registration', 'vue'],
    ['personal-blog', 'react'],
    ['personal-blog', 'vue'],
    ['automotive-news', 'react'],
    ['automotive-news', 'vue'],
    ['procurement-inventory', 'react'],
    ['procurement-inventory', 'vue'],
    ['enterprise-approvals', 'react'],
    ['enterprise-approvals', 'vue'],
    ['survey-forms', 'react'],
    ['survey-forms', 'vue'],
    ['online-courses', 'react'],
    ['online-courses', 'vue'],
    ['community-forum', 'react'],
    ['community-forum', 'vue'],
    ['asset-management', 'react'],
    ['asset-management', 'vue'],
    ['quote-contracts', 'react'],
    ['quote-contracts', 'vue'],
    ['recruitment-hr', 'react'],
    ['recruitment-hr', 'vue']
  ] as const)(
    'exports %s from the library entry as %s without warnings',
    async (template, target) => {
      const value = await fixture()
      const beforePages = new Set(value.editor.graph.getPages().map((page) => page.id))
      const installed = await value.installer.create(template, authentication(), value.providerKey)
      expect(value.failures).toEqual([])
      expect(installed).toBe(true)
      const pages = value.editor.graph.getPages().filter((page) => !beforePages.has(page.id))
      expect(pages).toHaveLength(templatePageCounts[template])
      if (template === 'personal-notes')
        expect(pages.map((page) => page.name).sort()).toEqual(['Notes login', 'Personal notes'])
      const output = compileAppBackendProviderDocument(value.store, {
        graph: value.editor.graph,
        pageIds: pages.map((page) => page.id),
        options: withDefaults({
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
          devMode: false
        })
      })
      expect(output.warnings).toEqual([])
      expect(output.files.has(target === 'vue' ? 'src/main.ts' : 'src/main.tsx')).toBe(true)
      expect([...output.files.keys()].some((path) => path.startsWith('backend/nestjs/'))).toBe(true)
      const auth = output.files.get('src/lowcode-backend-auth.ts')
      expect(typeof auth).toBe('string')
      expect(auth).toContain(authentication().issuer)
      expect(auth).toContain(authentication().clientId)
    }
  )
})
