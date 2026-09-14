import { toRaw } from 'vue'

import { canonicalManifestJSON } from '@open-pencil/scene-graph'

import { listAppBackendProviderDescriptors } from '@/app/plugins/host/backend-provider'

import { prepareBusinessModuleInstallation } from '../business/installation'
import {
  businessModuleDocumentFingerprint,
  moduleInstallationError
} from '../business/installation/context'
import type {
  BusinessModuleInstallation,
  BusinessModuleReview
} from '../business/installation/types'
import { BUSINESS_TEMPLATE_IDS, type BusinessTemplateId } from '../business/model/types'
import { readBackendProviderDocumentRequest } from '../document'
import type { BackendLibraryInstallContext } from './install'
import { backendProviderDescriptorKey } from './provider-identity'

function blockedReview(kind: BusinessTemplateId, message: string): BusinessModuleReview {
  return {
    kind,
    status: 'blocked',
    reviewKey: '',
    summary: message,
    conflicts: [message],
    addedPages: 0,
    sharedPages: []
  }
}

/** Reviews are scoped to this editor panel and discarded after every document/draft change. */
export function createBackendModuleInstaller(
  context: BackendLibraryInstallContext,
  selectedProviderKey: () => string
) {
  const pending = new Map<BusinessTemplateId, BusinessModuleInstallation>()
  let fingerprint = ''
  let reviewedGraph = context.editor.graph
  const unavailable = () => {
    if (context.busy.value) return 'Wait for the current Backend operation to finish.'
    if (context.readError.value)
      return 'Resolve the saved Backend declaration before adding modules.'
    const source = readBackendProviderDocumentRequest(context.editor.graph)
    if (!source) return 'Create and save a NestJS application before adding modules.'
    if (
      !listAppBackendProviderDescriptors(context.store).some(
        (descriptor) =>
          backendProviderDescriptorKey(descriptor) ===
          backendProviderDescriptorKey(source.selection)
      )
    )
      return 'Enable the saved application’s original trusted NestJS Provider before adding modules.'
    if (
      canonicalManifestJSON(toRaw(context.draft.value)) !==
        canonicalManifestJSON(source.application) ||
      selectedProviderKey() !== backendProviderDescriptorKey(source.selection)
    )
      return 'Save or discard the current Backend draft and Provider selection before adding a module.'
    return ''
  }
  const refresh = (): string => {
    const reason = unavailable()
    if (reason) {
      pending.clear()
      fingerprint = ''
      return reason
    }
    const current =
      businessModuleDocumentFingerprint(context.editor.graph) +
      '\n' +
      context.locale() +
      '\n' +
      canonicalManifestJSON(listAppBackendProviderDescriptors(context.store))
    if (reviewedGraph === context.editor.graph && current === fingerprint) return ''
    pending.clear()
    reviewedGraph = context.editor.graph
    fingerprint = current
    for (const kind of BUSINESS_TEMPLATE_IDS)
      pending.set(
        kind,
        prepareBusinessModuleInstallation({
          editor: context.editor,
          store: context.store,
          kind,
          locale: context.locale()
        })
      )
    return ''
  }
  const reviews = (): readonly BusinessModuleReview[] => {
    try {
      const reason = refresh()
      return BUSINESS_TEMPLATE_IDS.map((kind) =>
        reason
          ? blockedReview(kind, reason)
          : (pending.get(kind)?.review ?? blockedReview(kind, 'The module review is unavailable.'))
      )
    } catch (cause) {
      pending.clear()
      fingerprint = ''
      const message =
        cause instanceof Error ? cause.message : 'The Backend module could not be reviewed.'
      return BUSINESS_TEMPLATE_IDS.map((kind) => blockedReview(kind, message))
    }
  }
  const add = async (kind: BusinessTemplateId, reviewKey: string): Promise<boolean> => {
    if (context.busy.value) return false
    let created = false
    try {
      const reason = refresh()
      const installation = pending.get(kind)
      if (
        reason ||
        installation?.review.status !== 'ready' ||
        installation.review.reviewKey !== reviewKey
      )
        throw moduleInstallationError(
          reason || 'The module review changed. Review it again before adding it.'
        )
      context.started()
      context.busy.value = true
      await Promise.resolve()
      // Busy is ours now; the saved declaration and unsaved draft must still match.
      const source = readBackendProviderDocumentRequest(context.editor.graph)
      if (
        !source ||
        canonicalManifestJSON(toRaw(context.draft.value)) !==
          canonicalManifestJSON(source.application) ||
        selectedProviderKey() !== backendProviderDescriptorKey(source.selection)
      )
        throw moduleInstallationError('The Backend draft changed before adding the module.')
      const result = installation.apply()
      created = true
      context.created({
        templateId: kind,
        descriptor: source.selection,
        pageId: result.entryPageId,
        path: result.path
      })
      await context.editor.switchPage(result.entryPageId)
      context.editor.zoomToFit()
      return true
    } catch (cause) {
      context.failed(cause)
      return created
    } finally {
      pending.clear()
      fingerprint = ''
      context.busy.value = false
    }
  }
  return { reviews, add }
}
