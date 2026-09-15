import { describe, expect, test } from 'bun:test'

import {
  NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR,
  nestJSPreviewApplicationDigest,
  validateNestJSConnectedPreview
} from '@open-pencil/compiler/backend'
import { createEditor } from '@open-pencil/core/editor'
import { digestCanonicalManifest, SceneGraph } from '@open-pencil/scene-graph'

import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import {
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest,
  readBackendProviderDocumentRequest,
  validateBackendApplicationDraft
} from '@/app/lowcode/backend/document'
import { createBackendLibraryCatalog } from '@/app/lowcode/backend/library/catalog'
import { backendProviderDescriptorKey } from '@/app/lowcode/backend/library/provider-identity'
import { createNestJSNotesApplication, isNestJSProvider } from '@/app/lowcode/backend/nestjs-draft'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compilerBackendProviderSelection,
  inspectInstalledBackendProviderCompatibility,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderPlan,
  resolveAppBackendProviderDescriptor
} from '@/app/plugins/host/backend-provider'
import {
  NESTJS_PRISMA_CRM_BACKEND_PROVIDER_CONTRIBUTION,
  NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PACKAGE_DIGEST,
  NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PLUGIN_ID
} from '@/app/plugins/host/nestjs-prisma-crm/backend-provider'

async function fixture() {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (!entry) throw new Error('Missing experimental Prisma CRM provider')
  const storage = createMemoryAppPluginStateStorage()
  const options = {
    catalog: [entry],
    storage,
    activationCompatibilityPolicy: () => ({ ok: true as const }),
    engineVersion: '0.15.0'
  }
  const store = createAppPluginStore(options)
  expect((await store.load()).error).toBeNull()
  expect(listAppBackendProviderDescriptors(store)).toEqual([])
  expect((await store.install(entry.manifest.plugin.id)).enabled).toBe(false)
  expect(listAppBackendProviderDescriptors(store)).toEqual([])
  await store.setEnabled(entry.manifest.plugin.id, true)
  const [descriptor] = listAppBackendProviderDescriptors(store)
  if (!descriptor) throw new Error('Missing enabled Prisma CRM provider')
  const application = createBusinessApplication(
    'crm-prisma-export',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'crm-public-client',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    'customer-crm'
  )
  return { entry, store, descriptor, application, options }
}

describe('experimental Prisma CRM App provider', () => {
  test('is opt-in, pins the exact inert catalog declaration and restores its enabled state', async () => {
    const { entry, store, descriptor, options } = await fixture()
    expect(entry).toMatchObject({ installedByDefault: false, enabledByDefault: false })
    expect(entry.manifest).toMatchObject({
      capabilities: [],
      contributions: { backendProviders: [NESTJS_PRISMA_CRM_BACKEND_PROVIDER_CONTRIBUTION] }
    })
    expect('commands' in entry.manifest.contributions).toBe(false)
    expect(NESTJS_PRISMA_CRM_BACKEND_PROVIDER_CONTRIBUTION.permissions).toEqual([])
    expect(NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PACKAGE_DIGEST).toBe(
      `app-bundle-sha256:${await digestCanonicalManifest(entry.manifest)}`
    )
    expect(compilerBackendProviderSelection(descriptor).descriptor).toEqual(
      NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR
    )
    const restored = createAppPluginStore(options)
    expect((await restored.load()).error).toBeNull()
    expect(resolveAppBackendProviderDescriptor(restored, descriptor)).toEqual(descriptor)
    await store.setEnabled(entry.manifest.plugin.id, false)
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).toBeNull()
    await store.setEnabled(entry.manifest.plugin.id, true)
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).toEqual(descriptor)
    await store.uninstall(entry.manifest.plugin.id)
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).toBeNull()
  })

  test('saves and restores the selected CRM declaration while rejecting unsupported models', async () => {
    const { descriptor, application } = await fixture()
    const editor = createEditor()
    const request = commitBackendProviderDocumentRequest(editor, descriptor, application)
    const restored = new SceneGraph()
    restored.updateNode(restored.rootId, {
      pluginData: structuredClone(editor.graph.getNode(editor.graph.rootId)?.pluginData ?? [])
    })
    expect(readBackendProviderDocumentRequest(restored)).toEqual(request)
    expect(request.selection.providerId).toBe('nestjs-prisma-crm')
    expect(validateBackendApplicationDraft(application, descriptor).ok).toBe(true)
    expect(
      validateBackendApplicationDraft(createNestJSNotesApplication('notes'), descriptor).ok
    ).toBe(false)
    const altered = structuredClone(application)
    altered.dataModel.entities[0].fields.push({
      id: 'unreviewed_field',
      name: 'unreviewed_field',
      type: 'string',
      nullable: true
    })
    expect(validateBackendApplicationDraft(altered, descriptor).ok).toBe(false)
    expect(isNestJSProvider(descriptor.providerId)).toBe(false)
  })

  test.each(['react', 'vue'] as const)(
    'plans %s source exports but refuses preview and connected NestJS authority',
    async (target) => {
      const { store, descriptor, application } = await fixture()
      const request = createBackendProviderDocumentRequest(descriptor, application)
      expect(
        prepareAppBackendProviderPlan(store, request, { target, mode: 'production' }).plan
      ).toBeDefined()
      expect(() =>
        prepareAppBackendProviderPlan(store, request, { target, mode: 'preview' })
      ).toThrow()
      const connected = validateNestJSConnectedPreview({
        selection: compilerBackendProviderSelection(descriptor),
        application,
        target,
        applicationDigest: nestJSPreviewApplicationDigest(application)
      })
      expect(connected.ok).toBe(false)
    }
  )

  test('rejects package or contribution substitution before planning', async () => {
    const { store, descriptor, application } = await fixture()
    const installed = store.backendProvider(descriptor.pluginId, descriptor.providerId)
    if (!installed) throw new Error('Missing installed provider')
    const changedDigest = structuredClone(installed)
    Reflect.set(changedDigest.plugin.package, 'digest', `app-bundle-sha256:${'A'.repeat(43)}`)
    const changedDeclaration = structuredClone(installed)
    Reflect.set(changedDeclaration.contribution, 'permissions', ['network'])
    for (const changed of [changedDigest, changedDeclaration]) {
      expect(inspectInstalledBackendProviderCompatibility(changed).ok).toBe(false)
      expect(() =>
        prepareAppBackendProviderPlan(
          { installedBackendProviders: () => [changed] },
          createBackendProviderDocumentRequest(descriptor, application),
          { target: 'vue', mode: 'production' }
        )
      ).toThrow()
    }
  })

  test('presents the CRM-only source boundary in both languages without relabeling other templates', async () => {
    const { descriptor } = await fixture()
    for (const locale of ['en', 'zh-CN']) {
      const catalog = createBackendLibraryCatalog(
        [{ descriptor, descriptorKey: backendProviderDescriptorKey(descriptor) }],
        locale
      )
      const provider = catalog.find(
        (item) => item.kind === 'provider' && item.providerId === 'nestjs-prisma-crm'
      )
      expect(provider?.name).toContain('Prisma 8 CRM')
      expect(provider?.requirements.join(' ')).toContain(locale === 'en' ? 'preview' : '预览')
      expect(
        catalog
          .filter((item) => item.kind === 'template')
          .every((item) => item.providerId === 'nestjs')
      ).toBe(true)
    }
  })
})
