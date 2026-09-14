import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'

import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'
import { createCommerceOperationsPages } from '@/app/lowcode/backend/commerce/operations/template'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

/** Auth and HTTP are fixture boundaries; all page, routing, form and recovery code is generated. */
const TEST_SESSION = `
const state = Object.freeze({ready:true,signedIn:true,id:'00000000-0000-4000-8000-000000000001',email:null,generation:1});
export function getSession(){return state}
export const getSnapshot = getSession;
export function subscribe(){return()=>{}}
export async function initialize(){}
export async function getAccessToken(){return 'test-session-only'}
export async function signIn(){throw new Error('Real OIDC is outside this UI fixture')}
export async function signOut(){throw new Error('Real OIDC is outside this UI fixture')}
`

export async function commerceBrowserFixture(target: 'react' | 'vue') {
  const store = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter(
      (entry) => entry.manifest.plugin.id === 'open-pencil.nestjs-backend'
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing NestJS provider')
  const application = createCommerceOperationsApplication(
    'browser-commerce',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'browser-test',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    'multi-merchant',
    500
  )
  const editor = createEditor()
  const pages = createCommerceOperationsPages(editor, descriptor, application, 'multi-merchant')
  const output = compileAppBackendProviderDocument(store, {
    graph: editor.graph,
    pageIds: pages.pageIds,
    options: withDefaults({
      target,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      devMode: false
    })
  })
  if (output.warnings.length) throw new Error('Unexpected commerce compiler warnings')
  if (!output.files.has('src/lowcode-backend-auth.ts'))
    throw new Error('Missing generated auth boundary')
  output.files.set('src/lowcode-backend-auth.ts', TEST_SESSION)
  const apiBasePath = application.httpApi?.browserClient?.apiBasePath
  if (!apiBasePath) throw new Error('Missing browser API path')
  return { files: output.files, apiBasePath, paths: pages.paths }
}
