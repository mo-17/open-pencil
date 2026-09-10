import type { CompilerOptions } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/scene-graph'

import {
  prepareAppBackendProviderCompilerOptions,
  readAppBackendProviderDocumentRequest,
  type AppBackendProviderHostStore
} from '@/app/plugins/host/backend-provider'

export type ResolvePreviewBackendProviderStore = () =>
  | AppBackendProviderHostStore
  | Promise<AppBackendProviderHostStore>

export async function resolveLivePreviewBackendProviderStore(): Promise<AppBackendProviderHostStore> {
  const { appPluginStore, appPluginStoreReady } = await import('@/app/plugins/app')
  await appPluginStoreReady
  return appPluginStore
}

export function previewHasBackendProvider(graph: SceneGraph): boolean {
  return readAppBackendProviderDocumentRequest(graph) !== null
}

/** Called synchronously at the Host compile/snapshot boundary, after async preparation. */
export function preparePreviewBackendProvider(
  graph: SceneGraph,
  options: CompilerOptions,
  store: AppBackendProviderHostStore | null
): { options: CompilerOptions; assertCurrent(): void } {
  if (options.backendProvider !== undefined) {
    throw new Error('Preview Backend Provider requests must be resolved from the current document.')
  }
  if (!options.devMode || (options.backendCompilationMode ?? 'preview') !== 'preview') {
    throw new Error('Preview Backend Provider compilation must use preview mode.')
  }
  const document = readAppBackendProviderDocumentRequest(graph)
  if (document && !store) throw new Error('Preview Backend Provider Host is unavailable.')
  const prepared = store ? prepareAppBackendProviderCompilerOptions(store, graph, options) : options
  const identity = JSON.stringify(document)
  const normalized = JSON.stringify(prepared.backendProvider)
  return {
    options: prepared,
    assertCurrent() {
      if (JSON.stringify(readAppBackendProviderDocumentRequest(graph)) !== identity) {
        throw new Error('Preview Backend Provider document changed during the build.')
      }
      // Resolve against the live store again; the Worker receives only normalized
      // data, never this callback, the store, or a runtime authority capability.
      const current = store
        ? prepareAppBackendProviderCompilerOptions(store, graph, options)
        : options
      if (JSON.stringify(current.backendProvider) !== normalized) {
        throw new Error('Preview Backend Provider selection changed during the build.')
      }
    }
  }
}
