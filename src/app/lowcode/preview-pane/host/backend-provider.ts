import type { CompilerOptions } from '@open-pencil/compiler'
import { validateNestJSConnectedPreview } from '@open-pencil/compiler/backend'
import type { SceneGraph } from '@open-pencil/scene-graph'

import {
  prepareAppBackendProviderCompilerOptions,
  readAppBackendProviderDocumentRequest,
  resolveAppBackendProviderDescriptor,
  compilerBackendProviderSelection,
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

function prepareConnectedPreview(
  graph: SceneGraph,
  options: CompilerOptions,
  store: AppBackendProviderHostStore | null
): CompilerOptions {
  const connection = options.backendPreview
  if (!connection)
    return store ? prepareAppBackendProviderCompilerOptions(store, graph, options) : options
  const request = readAppBackendProviderDocumentRequest(graph)
  if (!request || !store || options.packaging?.kind === 'microfrontend') {
    throw new Error('Connected NestJS preview requires a current standalone Backend document.')
  }
  const descriptor = resolveAppBackendProviderDescriptor(store, request.selection)
  if (!descriptor) throw new Error('The connected Backend Provider is no longer available.')
  const selection = compilerBackendProviderSelection(descriptor)
  const validated = validateNestJSConnectedPreview({
    selection,
    application: request.application,
    target: options.target,
    applicationDigest: connection.applicationDigest
  })
  if (!validated.ok) {
    throw new Error(
      `Connected NestJS preview failed closed: ${validated.diagnostics.map((entry) => entry.code).join(', ')}.`
    )
  }
  return Object.freeze({
    ...options,
    backendProvider: Object.freeze({ selection, application: validated.application })
  })
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
  const prepared = prepareConnectedPreview(graph, options, store)
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
      const current = prepareConnectedPreview(graph, options, store)
      if (JSON.stringify(current.backendProvider) !== normalized) {
        throw new Error('Preview Backend Provider selection changed during the build.')
      }
    }
  }
}
