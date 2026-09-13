import { withDefaults } from '@open-pencil/compiler'
import {
  nestJSPreviewApplicationDigest,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'
import {
  isBackendAuthReturnPath,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { readAppBackendProviderDocumentRequest } from '@/app/plugins/host/backend-provider'

import {
  preparePreviewBackendProvider,
  resolveLivePreviewBackendProviderStore,
  type ResolvePreviewBackendProviderStore
} from '../host/backend-provider'
import type { PreviewTarget } from '../host/types'
import {
  LOCAL_BACKEND_PREVIEW_CALLBACK,
  LOCAL_BACKEND_PREVIEW_ORIGIN
} from '../local-backend-connection'

export interface ManagedBackendSnapshot {
  readonly application: BackendApplicationSpecV1
  readonly selection: BackendProviderSelection
  readonly applicationDigest: string
  readonly loginPath: string
  assertCurrent(): void
}

/** Capture public data only, after resolving the current installed Provider authority. */
export async function captureManagedBackendSnapshot(
  graph: SceneGraph,
  target: PreviewTarget,
  isCurrent: () => boolean = () => true,
  resolveStore: ResolvePreviewBackendProviderStore = resolveLivePreviewBackendProviderStore
): Promise<ManagedBackendSnapshot> {
  const store = await resolveStore()
  if (!isCurrent()) throw new Error('The managed preview document changed during preparation.')
  const document = readAppBackendProviderDocumentRequest(graph)
  if (!document) throw new Error('Configure the document NestJS Backend before preparing preview.')
  const applicationDigest = nestJSPreviewApplicationDigest(document.application)
  const prepared = preparePreviewBackendProvider(
    graph,
    withDefaults({ target, backendPreview: { kind: 'nestjs-local', applicationDigest } }),
    store
  )
  const backend = prepared.options.backendProvider
  if (!backend) throw new Error('The managed Backend Provider is unavailable.')
  const browser = backend.application.httpApi?.browserClient
  if (browser?.authentication.callbackPath !== LOCAL_BACKEND_PREVIEW_CALLBACK) {
    throw new Error(`Managed preview requires the callback path ${LOCAL_BACKEND_PREVIEW_CALLBACK}.`)
  }
  const loginPath = graph.getNode(graph.rootId)?.lowcodeAuthRedirect
  if (
    !isBackendAuthReturnPath(loginPath) ||
    new URL(loginPath, LOCAL_BACKEND_PREVIEW_ORIGIN).pathname !== loginPath ||
    !graph
      .getPages()
      .some(
        (page) =>
          !page.internalOnly && page.lowcodeRoutePattern === loginPath && !page.lowcodeRequiresAuth
      )
  ) {
    throw new Error('Managed preview requires an exported, unprotected local login route.')
  }
  const assertCurrent = () => {
    if (
      !isCurrent() ||
      graph.getNode(graph.rootId)?.lowcodeAuthRedirect !== loginPath ||
      !graph
        .getPages()
        .some(
          (page) =>
            !page.internalOnly &&
            page.lowcodeRoutePattern === loginPath &&
            !page.lowcodeRequiresAuth
        )
    ) {
      throw new Error(
        'The managed preview document changed. Prepare its current configuration again.'
      )
    }
    prepared.assertCurrent()
  }
  assertCurrent()
  return Object.freeze({ ...backend, applicationDigest, loginPath, assertCurrent })
}
