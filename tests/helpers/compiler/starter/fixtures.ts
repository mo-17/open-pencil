import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'

import { createCommerceApplication } from '@/app/lowcode/backend/commerce/application'
import { createMerchantCommerceApplication } from '@/app/lowcode/backend/commerce/merchant/application'
import { createMerchantCommercePages } from '@/app/lowcode/backend/commerce/merchant/template'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'
import { createCommerceOperationsPages } from '@/app/lowcode/backend/commerce/operations/template'
import { createCommercePages } from '@/app/lowcode/backend/commerce/template'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'
import { createPersonalNotesPages } from '@/app/lowcode/backend/notes-template'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

const AUTH_SESSION = `
const state = Object.freeze({ready:true,signedIn:true,id:'00000000-0000-4000-8000-000000000001',email:null,generation:1,notice:null});
export function getSession(){return state}
export const getSnapshot = getSession;
export function subscribe(){return()=>{}}
export async function initialize(){}
export async function getAccessToken(){return 'starter-ui-test-session'}
export async function signIn(){throw new Error('Real OIDC is outside this UI fixture')}
export async function signOut(){throw new Error('Real OIDC is outside this UI fixture')}
export function cancelSignIn(){throw new Error('Real OIDC is outside this UI fixture')}
`

export type StarterPresentationKind =
  | 'notes'
  | 'shop'
  | 'single-merchant-shop'
  | 'multi-merchant-marketplace'
  | 'single-merchant-commerce'
  | 'multi-merchant-commerce'

export async function starterPresentationFixture(
  kind: StarterPresentationKind,
  target: 'react' | 'vue',
  locale = 'en'
) {
  const store = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter(
      (entry) => entry.manifest.plugin.id === 'open-pencil.nestjs-backend'
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing bundled provider')
  const authentication = {
    kind: 'oidc-pkce' as const,
    issuer: 'https://identity.example.com',
    clientId: 'starter-presentation-fixture',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  }
  const mode = kind.startsWith('multi-') ? 'multi-merchant' : 'single-merchant'
  const operations = kind.endsWith('-commerce')
  const merchant = !operations && kind !== 'notes' && kind !== 'shop'
  const application = (() => {
    if (kind === 'notes') return createNestJSNotesApplication('notes-presentation')
    if (operations)
      return createCommerceOperationsApplication('commerce-presentation', authentication, mode, 500)
    if (merchant)
      return createMerchantCommerceApplication('merchant-presentation', authentication, mode)
    return createCommerceApplication('shop-presentation', authentication)
  })()
  if (!application.httpApi?.browserClient) throw new Error('Missing browser client')
  application.httpApi.browserClient.authentication = authentication
  const editor = createEditor()
  let pageIds: string[]
  let paths: Record<string, string>
  if (kind === 'notes') {
    const pages = createPersonalNotesPages(editor, descriptor, application)
    pageIds = [pages.loginPageId, pages.notesPageId]
    paths = { login: pages.loginPath, main: pages.notesPath }
  } else {
    const pages = (() => {
      if (operations)
        return createCommerceOperationsPages(editor, descriptor, application, mode, locale)
      if (merchant)
        return createMerchantCommercePages(editor, descriptor, application, mode, locale)
      return createCommercePages(editor, descriptor, application, locale)
    })()
    pageIds = pages.pageIds
    paths = { ...pages.paths, main: pages.paths.shop }
  }
  const output = compileAppBackendProviderDocument(store, {
    graph: editor.graph,
    pageIds,
    options: withDefaults({
      target,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      devMode: false
    })
  })
  if (output.warnings.length) throw new Error(JSON.stringify(output.warnings))
  const files = new Map(output.files)
  if (!files.has('src/lowcode-backend-auth.ts')) throw new Error('Missing generated auth boundary')
  files.set('src/lowcode-backend-auth.ts', AUTH_SESSION)
  return { files: [...files], paths, apiBasePath: application.httpApi.browserClient.apiBasePath }
}
