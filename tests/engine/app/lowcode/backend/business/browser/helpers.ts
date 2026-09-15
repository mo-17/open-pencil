import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'

import { prepareBusinessModuleInstallation } from '@/app/lowcode/backend/business/installation'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'
import { createBusinessPages } from '@/app/lowcode/backend/business/template'
import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

export const BUSINESS_BROWSER_USER_ID = '00000000-0000-4000-8000-000000000001'

/** This fixture replaces authentication only; application, compiler and browser bindings are real. */
const TEST_SESSION = `
const state = Object.freeze({ready:true,signedIn:true,id:'${BUSINESS_BROWSER_USER_ID}',email:null,generation:1});
export function getSession(){return state}
export const getSnapshot = getSession;
export function subscribe(){return()=>{}}
export async function initialize(){}
export async function getAccessToken(){return 'business-test-session'}
export async function signIn(){throw new Error('Real OIDC is outside this browser fixture')}
export async function signOut(){throw new Error('Real OIDC is outside this browser fixture')}
`

export async function businessBrowserFixture(
  kind: BusinessTemplateId,
  target: 'react' | 'vue',
  modules: readonly BusinessTemplateId[] = []
) {
  const store = createAppPluginStore({
    catalog: createBundledPluginCatalog().filter((entry) =>
      ['open-pencil.nestjs-backend', 'open-pencil.vr-tour', 'open-pencil.video'].includes(
        entry.manifest.plugin.id
      )
    ),
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  await store.load()
  await store.install('open-pencil.vr-tour')
  await store.setEnabled('open-pencil.vr-tour', true)
  await store.install('open-pencil.video')
  await store.setEnabled('open-pencil.video', true)
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('The test NestJS provider is unavailable')
  let application = createBusinessApplication(
    'business-browser-' + kind,
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'business-browser-test',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    kind
  )
  const editor = createEditor()
  const pages = createBusinessPages(editor, descriptor, application, kind, 'en')
  for (const moduleKind of modules) {
    const installation = prepareBusinessModuleInstallation({ editor, store, kind: moduleKind })
    if (installation.review.status !== 'ready') throw new Error(installation.review.summary)
    installation.apply()
  }
  if (modules.length) {
    const installed = readBackendProviderDocumentRequest(editor.graph)
    if (!installed) throw new Error('Missing composed browser application')
    application = installed.application
    pages.pageIds = editor.graph
      .getPages()
      .filter((page) => !page.internalOnly && page.lowcodeRoutePattern)
      .map((page) => page.id)
  }
  const output = compileAppBackendProviderDocument(store, {
    graph: editor.graph,
    pageIds: pages.pageIds,
    options: withDefaults({
      target,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      devMode: false
    })
  })
  if (output.warnings.length)
    throw new Error('Unexpected business template warnings: ' + JSON.stringify(output.warnings))
  const files = new Map(output.files)
  if (!files.has('src/lowcode-backend-auth.ts')) throw new Error('Missing browser auth boundary')
  files.set('src/lowcode-backend-auth.ts', TEST_SESSION)
  const apiBasePath = application.httpApi?.browserClient?.apiBasePath
  if (!apiBasePath) throw new Error('Missing browser API path')
  return {
    files,
    output,
    application,
    graph: editor.graph,
    apiBasePath,
    editor,
    store,
    descriptor,
    ...pages
  }
}
