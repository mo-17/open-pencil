import { canonicalManifestJSON } from '@open-pencil/scene-graph'
import type { ActionDef, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  createBackendProviderDocumentRequest,
  readBackendProviderDocumentRequest
} from '@/app/lowcode/backend/document'
import { pendingBackendDraftReason } from '@/app/lowcode/backend/draft/pending'
import { backendProviderDescriptorKey } from '@/app/lowcode/backend/library/provider-identity'
import {
  AppBackendProviderBuildError,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

import type { BusinessModuleInstallationOptions } from './types'

export function moduleInstallationError(message: string): AppBackendProviderBuildError {
  return new AppBackendProviderBuildError('request-invalid', message)
}

/** Review covers all layout and route fields that appending navigation may touch. */
export function businessModuleDocumentFingerprint(graph: SceneGraph): string {
  return canonicalManifestJSON(
    [...graph.nodes.values()].map((node) => ({
      id: node.id,
      parentId: node.parentId,
      childIds: node.childIds,
      type: node.type,
      name: node.name,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      pluginData: node.pluginData,
      lowcodeRoutePattern: node.lowcodeRoutePattern,
      lowcodeRequiresAuth: node.lowcodeRequiresAuth,
      lowcodeAuthRedirect: node.lowcodeAuthRedirect,
      lowcodeDocumentState: node.lowcodeDocumentState,
      internalOnly: node.internalOnly,
      events: node.events,
      interactiveProps: node.interactiveProps,
      state: node.state,
      bindings: node.bindings
    }))
  )
}

function nestedActions(action: ActionDef): ActionDef[] {
  return [
    action,
    ...('consequent' in action ? action.consequent.flatMap(nestedActions) : []),
    ...('alternate' in action ? (action.alternate ?? []).flatMap(nestedActions) : []),
    ...('onSuccess' in action ? (action.onSuccess ?? []).flatMap(nestedActions) : []),
    ...('onError' in action ? (action.onError ?? []).flatMap(nestedActions) : [])
  ]
}

function pageActions(graph: SceneGraph, page: SceneNode): ActionDef[] {
  const actions = Object.values(page.events ?? {})
    .flat()
    .flatMap(nestedActions)
  for (const child of graph.getChildren(page.id)) actions.push(...pageActions(graph, child))
  return actions
}

export function businessModuleSharedPages(graph: SceneGraph) {
  const root = graph.getNode(graph.rootId)
  const loginPath = root?.lowcodeAuthRedirect
  const pages = graph.getPages().filter((page) => !page.internalOnly)
  const logins = pages.filter((page) => page.lowcodeRoutePattern === loginPath)
  const login = logins.at(0)
  if (
    !loginPath ||
    logins.length !== 1 ||
    !login ||
    login.lowcodeRequiresAuth ||
    !pageActions(graph, login).some(
      (action) => action.kind === 'backendAuth' && action.operation === 'signIn'
    )
  )
    throw moduleInstallationError(
      'An existing public Backend sign-in page is required before adding a business module.'
    )
  const accounts = pages.filter((page) =>
    pageActions(graph, page).some(
      (action) => action.kind === 'backendCommand' && action.commandId === 'register-business-user'
    )
  )
  if (accounts.length > 1)
    throw moduleInstallationError(
      'Multiple account setup pages exist. Keep one shared account page before adding a module.'
    )
  const account = accounts.at(0)
  if (account && (!account.lowcodeRequiresAuth || !account.lowcodeRoutePattern))
    throw moduleInstallationError('The shared account page needs its own protected route.')
  return {
    login: { pageId: login.id, path: loginPath },
    ...(account?.lowcodeRoutePattern
      ? { account: { pageId: account.id, path: account.lowcodeRoutePattern } }
      : {})
  }
}

export function resolveBusinessModuleSource(options: BusinessModuleInstallationOptions) {
  const pending = pendingBackendDraftReason(options.editor.graph)
  if (pending) throw moduleInstallationError(pending)
  const request = readBackendProviderDocumentRequest(options.editor.graph)
  if (request?.selection.providerId !== 'nestjs')
    throw moduleInstallationError(
      'Save an existing NestJS application before adding business modules.'
    )
  const key = backendProviderDescriptorKey(request.selection)
  const descriptor = listAppBackendProviderDescriptors(options.store).find(
    (entry) => entry.providerId === 'nestjs' && backendProviderDescriptorKey(entry) === key
  )
  if (!descriptor)
    throw moduleInstallationError(
      'The saved application needs its original enabled, trusted NestJS Provider.'
    )
  const validated = createBackendProviderDocumentRequest(descriptor, request.application)
  if (canonicalManifestJSON(validated.selection) !== canonicalManifestJSON(request.selection))
    throw moduleInstallationError(
      'The Backend Provider changed. Review and save its current declaration first.'
    )
  return { application: validated.application, descriptor, key }
}
