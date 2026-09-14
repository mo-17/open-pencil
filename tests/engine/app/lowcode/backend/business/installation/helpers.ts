import { createEditor } from '@open-pencil/core/editor'
import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import { createBusinessPages } from '@/app/lowcode/backend/business/template'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import { listAppBackendProviderDescriptors } from '@/app/plugins/host/backend-provider'

export const MODULE_AUTHENTICATION: BackendHttpAPIOIDCAuthenticationIRV1 = {
  kind: 'oidc-pkce',
  issuer: 'https://identity.example.com',
  clientId: 'business-modules',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}

export async function moduleInstallationFixture() {
  const store = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter(
      (entry) => entry.manifest.plugin.id === 'open-pencil.nestjs-backend'
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store).find(
    (entry) => entry.providerId === 'nestjs'
  )
  if (!descriptor) throw new Error('Missing module test Provider')
  const editor = createEditor()
  const application = createBusinessApplication(
    'modular-application',
    MODULE_AUTHENTICATION,
    'customer-crm'
  )
  const pages = createBusinessPages(editor, descriptor, application, 'customer-crm')
  return { editor, store, descriptor, application, pages }
}
