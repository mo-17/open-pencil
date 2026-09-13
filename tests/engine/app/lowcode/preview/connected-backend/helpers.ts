import { withDefaults } from '@open-pencil/compiler'
import { nestJSPreviewApplicationDigest } from '@open-pencil/compiler/backend'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

import {
  browserApplication,
  browserGraph
} from '#tests/engine/compiler/backend/nestjs/browser-client/helpers'

export const PLUGIN_ID = 'open-pencil.nestjs-backend'

export async function connectedBackendFixture() {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: createBundledPluginCatalog().filter(
      ({ manifest }) => manifest.plugin.id === PLUGIN_ID
    ),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const application = browserApplication()
  const graph = browserGraph()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  graph.graph.updateNode(graph.graph.rootId, {
    pluginData: [
      {
        pluginId: 'open-pencil',
        key: 'lowcode/backendProvider.v1',
        value: appBackendProviderDocumentValue({
          format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
          selection: descriptor,
          application
        })
      }
    ]
  })
  const options = withDefaults({
    target: 'react',
    router: 'react-router-v6',
    devMode: true,
    backendPreview: {
      kind: 'nestjs-local',
      applicationDigest: nestJSPreviewApplicationDigest(application)
    }
  })
  return { ...graph, application, descriptor, store, options }
}
