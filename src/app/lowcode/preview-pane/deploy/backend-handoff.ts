import {
  createBackendProviderCompileHandoff,
  digestBackendProviderCompileHandoff,
  type BackendProviderCompileHandoff
} from '@open-pencil/compiler/backend'

import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  type AppBackendProviderDocumentGraph,
  type PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'

export interface BackendProviderDeployHandoffOptions {
  readonly request: BackendProviderCompileHandoff
  readonly revalidate: () => void | Promise<void>
  readonly signal?: AbortSignal
}

export function prepareBackendProviderDeployHandoff(
  graph: AppBackendProviderDocumentGraph,
  build: PreparedAppBackendProviderBuild | null,
  revalidate: () => {
    graph: AppBackendProviderDocumentGraph
    build: PreparedAppBackendProviderBuild | null
  },
  signal?: AbortSignal
): BackendProviderDeployHandoffOptions | undefined {
  if (!build) return undefined
  const request = appBackendProviderCompileHandoff(graph, build)
  return {
    request,
    signal,
    revalidate() {
      const current = revalidate()
      assertBackendProviderCompileHandoffCurrent(request, current.graph, current.build)
    }
  }
}

/** Bind the exact document declaration to the already reviewed normalized build. */
export function appBackendProviderCompileHandoff(
  graph: AppBackendProviderDocumentGraph,
  build: PreparedAppBackendProviderBuild
): BackendProviderCompileHandoff {
  const declarations = (graph.getNode(graph.rootId)?.pluginData ?? []).filter(
    (entry) =>
      entry.pluginId === APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID &&
      entry.key === APP_BACKEND_PROVIDER_DOCUMENT_KEY
  )
  const target = build.plan.target
  if (declarations.length !== 1 || (target !== 'react' && target !== 'vue')) {
    throw new Error('Backend Provider declaration changed. Review the deployment again.')
  }
  return createBackendProviderCompileHandoff({
    declaration: declarations[0].value,
    selection: build.selection,
    application: build.plan.application,
    target,
    planDigest: build.plan.planDigest,
    manifestDigest: build.emission.manifestDigest
  })
}

export function assertBackendProviderCompileHandoffCurrent(
  expected: BackendProviderCompileHandoff,
  graph: AppBackendProviderDocumentGraph,
  build: PreparedAppBackendProviderBuild | null
): void {
  if (
    !build ||
    digestBackendProviderCompileHandoff(appBackendProviderCompileHandoff(graph, build)) !==
      digestBackendProviderCompileHandoff(expected)
  ) {
    throw new Error('Backend Provider declaration changed. Review the deployment again.')
  }
}
