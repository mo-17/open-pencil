import { toRaw, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'
import { canonicalManifestJSON, type SceneGraph } from '@open-pencil/scene-graph'

import {
  AppBackendProviderBuildError,
  listAppBackendProviderDescriptors,
  type AppBackendProviderDescriptor,
  type AppBackendProviderHostStore
} from '@/app/plugins/host/backend-provider'

import { businessTemplateDefinition } from '../business/definitions'
import { createBusinessApplication } from '../business/model'
import { requireBusinessTemplatePlugins } from '../business/plugins'
import { createBusinessPages } from '../business/template'
import { createCommerceApplication } from '../commerce/application'
import { createMerchantCommerceApplication } from '../commerce/merchant/application'
import { createMerchantCommercePages } from '../commerce/merchant/template'
import { createCommerceOperationsApplication } from '../commerce/operations/application'
import { createCommerceOperationsPages } from '../commerce/operations/template'
import { createCommercePages } from '../commerce/template'
import {
  BackendDocumentValidationError,
  createEmptyBackendApplication,
  readBackendProviderDocumentRequest
} from '../document'
import { createNestJSNotesApplication } from '../nestjs-draft'
import { createPersonalNotesPages, type NotesTemplateEditor } from '../notes-template'
import {
  isBackendLibraryTemplateId,
  isBusinessTemplate,
  isCommerceOperationsTemplate,
  type BackendLibraryTemplateId
} from './catalog'
import { backendProviderDescriptorKey } from './provider-identity'
export type BackendLibraryBlockReason = '' | 'busy' | 'document' | 'draft' | 'read-error'
type LibraryEditor = NotesTemplateEditor & Pick<Editor, 'switchPage' | 'zoomToFit'>

export interface BackendLibraryInstallResult {
  readonly templateId: BackendLibraryTemplateId
  readonly descriptor: AppBackendProviderDescriptor
  readonly pageId: string
  readonly path: string
}

export interface BackendLibraryInstallContext {
  readonly editor: LibraryEditor
  readonly store: AppBackendProviderHostStore
  readonly draft: Ref<BackendApplicationSpecV1>
  readonly busy: Ref<boolean>
  readonly readError: Ref<string>
  readonly locale: () => string
  readonly started: () => void
  readonly created: (result: BackendLibraryInstallResult) => void
  readonly failed: (cause: unknown) => void
}

/** Existing authentication remains owned by its authored flow, even when incomplete. */
export function hasBackendAuthenticationFlow(graph: SceneGraph): boolean {
  const root = graph.getNode(graph.rootId)
  return Boolean(
    !root ||
    root.lowcodeSupabaseConfig !== undefined ||
    root.lowcodeAuthRedirect !== undefined ||
    graph.getPages().some((page) => page.lowcodeRequiresAuth)
  )
}

/** Parse before comparing so malformed, unknown or non-JSON draft fields cannot disappear. */
export function isEmptyBackendLibraryDraft(draft: BackendApplicationSpecV1): boolean {
  const parsed = parseBackendApplicationSpecV1(draft)
  return (
    parsed.ok &&
    canonicalManifestJSON(draft) ===
      canonicalManifestJSON(createEmptyBackendApplication(parsed.value.applicationId))
  )
}

function blockReason(
  context: BackendLibraryInstallContext,
  includeBusy = true
): BackendLibraryBlockReason {
  if (includeBusy && context.busy.value) return 'busy'
  if (context.readError.value) return 'read-error'
  try {
    if (
      readBackendProviderDocumentRequest(context.editor.graph) ||
      hasBackendAuthenticationFlow(context.editor.graph)
    )
      return 'document'
  } catch {
    return 'read-error'
  }
  return isEmptyBackendLibraryDraft(toRaw(context.draft.value)) ? '' : 'draft'
}

function unavailable(message: string): AppBackendProviderBuildError {
  return new AppBackendProviderBuildError('request-invalid', message)
}

function authenticationSnapshot(
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
): BackendHttpAPIOIDCAuthenticationIRV1 {
  const application = createNestJSNotesApplication('template-authentication')
  if (!application.httpApi?.browserClient)
    throw unavailable('The template browser client is unavailable.')
  application.httpApi.browserClient.authentication = toRaw(authentication)
  const parsed = parseBackendApplicationSpecV1(application)
  if (!parsed.ok) throw new BackendDocumentValidationError(parsed.diagnostics)
  const normalized = parsed.value.httpApi?.browserClient?.authentication
  if (!normalized)
    throw unavailable('Configure public OIDC authentication before creating this template.')
  return normalized
}

function provider(
  context: BackendLibraryInstallContext,
  key: string
): AppBackendProviderDescriptor {
  const descriptor = listAppBackendProviderDescriptors(context.store).find(
    (entry) => entry.providerId === 'nestjs' && backendProviderDescriptorKey(entry) === key
  )
  if (!descriptor)
    throw unavailable(
      'The selected template provider is no longer available. Review the library and try again.'
    )
  return descriptor
}

function install(
  context: BackendLibraryInstallContext,
  templateId: BackendLibraryTemplateId,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  descriptor: AppBackendProviderDescriptor,
  commissionBasisPoints: number
): BackendLibraryInstallResult {
  const applicationId = context.draft.value.applicationId
  if (isBusinessTemplate(templateId)) {
    requireBusinessTemplatePlugins(context.store, templateId)
    const application = createBusinessApplication(applicationId, authentication, templateId)
    const result = createBusinessPages(
      context.editor,
      descriptor,
      application,
      templateId,
      context.locale()
    )
    const path = result.paths[businessTemplateDefinition(templateId).entryPage]
    const pageId = result.pageIds.find(
      (id) => context.editor.graph.getNode(id)?.lowcodeRoutePattern === path
    )
    if (!pageId) throw unavailable('The created business page is unavailable.')
    return { templateId, descriptor, pageId, path }
  }
  if (templateId === 'personal-notes') {
    const application = createNestJSNotesApplication(applicationId)
    if (!application.httpApi?.browserClient)
      throw unavailable('The template browser client is unavailable.')
    application.httpApi.browserClient.authentication = authentication
    const result = createPersonalNotesPages(context.editor, descriptor, application)
    return { templateId, descriptor, pageId: result.notesPageId, path: result.notesPath }
  }
  const mode =
    templateId === 'multi-merchant-marketplace' || templateId === 'multi-merchant-commerce'
      ? 'multi-merchant'
      : 'single-merchant'
  const createPages = () => {
    if (isCommerceOperationsTemplate(templateId))
      return createCommerceOperationsPages(
        context.editor,
        descriptor,
        createCommerceOperationsApplication(
          applicationId,
          authentication,
          mode,
          commissionBasisPoints
        ),
        mode,
        context.locale()
      )
    if (templateId === 'single-sku-shop')
      return createCommercePages(
        context.editor,
        descriptor,
        createCommerceApplication(applicationId, authentication),
        context.locale()
      )
    return createMerchantCommercePages(
      context.editor,
      descriptor,
      createMerchantCommerceApplication(applicationId, authentication, mode),
      mode,
      context.locale()
    )
  }
  const result = createPages()
  const pageId = result.pageIds.find(
    (id) => context.editor.graph.getNode(id)?.lowcodeRoutePattern === result.paths.shop
  )
  if (!pageId) throw unavailable('The created template page is unavailable.')
  return { templateId, descriptor, pageId, path: result.paths.shop }
}

/** Templates share the same live authority and document admission immediately before mutation. */
export function createBackendLibraryInstaller(context: BackendLibraryInstallContext) {
  async function create(
    templateId: string,
    authentication: BackendHttpAPIOIDCAuthenticationIRV1,
    expectedProviderKey: string,
    commissionBasisPoints = 0
  ): Promise<boolean> {
    if (context.busy.value) return false
    if (blockReason(context)) {
      context.failed(
        unavailable(
          'Templates require an empty Backend draft and a document without an existing Backend or sign-in flow.'
        )
      )
      return false
    }
    const graph = context.editor.graph
    const fingerprint = canonicalManifestJSON(toRaw(context.draft.value))
    context.busy.value = true
    context.started()
    let created = false
    try {
      if (!isBackendLibraryTemplateId(templateId))
        throw unavailable('Select a supported application template.')
      if (
        !Number.isInteger(commissionBasisPoints) ||
        commissionBasisPoints < 0 ||
        commissionBasisPoints > 10000 ||
        (!isCommerceOperationsTemplate(templateId) && commissionBasisPoints !== 0)
      )
        throw unavailable(
          'Commission requires an operations template and an integer from 0 to 10000 basis points.'
        )
      const auth = authenticationSnapshot(authentication)
      provider(context, expectedProviderKey)
      await Promise.resolve()
      if (
        context.editor.graph !== graph ||
        blockReason(context, false) ||
        canonicalManifestJSON(toRaw(context.draft.value)) !== fingerprint
      )
        throw unavailable(
          'The document or Backend draft changed before template creation. Review it and try again.'
        )
      const result = install(
        context,
        templateId,
        auth,
        provider(context, expectedProviderKey),
        commissionBasisPoints
      )
      created = true
      context.created(result)
      await context.editor.switchPage(result.pageId)
      if (context.editor.graph === graph) context.editor.zoomToFit()
      return true
    } catch (cause) {
      context.failed(cause)
      // A navigation failure cannot turn an already committed document into a retryable install.
      return created
    } finally {
      context.busy.value = false
    }
  }
  return { blockReason: () => blockReason(context), create }
}
