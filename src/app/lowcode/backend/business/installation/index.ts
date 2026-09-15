import { canonicalManifestJSON } from '@open-pencil/scene-graph'

import {
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest
} from '@/app/lowcode/backend/document'
import { validateBackendTemplatePages } from '@/app/lowcode/backend/template-validation'

import { composeBusinessModules, detectStandaloneBusinessKinds } from '../composition'
import { businessTemplateDefinition } from '../definitions'
import { assertBusinessTemplateId, type BusinessTemplateId } from '../model/types'
import { requireBusinessTemplatePlugins } from '../plugins'
import { prepareBusinessModulePages, renderBusinessModulePages } from '../template'
import { businessLabel, businessText } from '../types'
import {
  businessModuleDocumentFingerprint,
  businessModuleSharedPages,
  moduleInstallationError,
  resolveBusinessModuleSource
} from './context'
import type {
  BusinessModuleInstallation,
  BusinessModuleInstallationOptions,
  BusinessModuleReview
} from './types'

export type {
  BusinessModuleInstallation,
  BusinessModuleInstallationOptions,
  BusinessModuleInstallationResult,
  BusinessModuleReview
} from './types'

function unavailableReview(
  options: BusinessModuleInstallationOptions,
  message: string,
  installed = false
): BusinessModuleInstallation {
  const review: BusinessModuleReview = Object.freeze({
    kind: options.kind,
    status: installed ? 'installed' : 'blocked',
    reviewKey: '',
    summary: message,
    conflicts: Object.freeze(installed ? [] : [message]),
    addedPages: 0,
    sharedPages: Object.freeze([])
  })
  return {
    review,
    apply() {
      throw moduleInstallationError(message)
    }
  }
}

/** Pure review followed by an explicitly invoked, atomic document mutation. No service or SQL runs. */
export function prepareBusinessModuleInstallation(
  options: BusinessModuleInstallationOptions
): BusinessModuleInstallation {
  assertBusinessTemplateId(options.kind)
  try {
    return prepareInstallation(options, reviewContext(options))
  } catch (cause) {
    return unavailableReview(
      options,
      cause instanceof Error ? cause.message : 'The business module could not be prepared.'
    )
  }
}

function reviewContext(options: BusinessModuleInstallationOptions) {
  const source = resolveBusinessModuleSource(options)
  return {
    source,
    adopted: detectStandaloneBusinessKinds(source.application),
    fingerprint: businessModuleDocumentFingerprint(options.editor.graph),
    sourceIdentity: canonicalManifestJSON(source)
  }
}

/** One synchronous catalog pass shares source verification, never apply authority. */
export function prepareBusinessModuleInstallations(
  options: Omit<BusinessModuleInstallationOptions, 'kind'>,
  kinds: readonly BusinessTemplateId[]
): ReadonlyMap<BusinessTemplateId, BusinessModuleInstallation> {
  const result = new Map<BusinessTemplateId, BusinessModuleInstallation>()
  const first = kinds.at(0)
  if (!first) return result
  for (const kind of kinds) assertBusinessTemplateId(kind)
  try {
    const context = reviewContext({ ...options, kind: first })
    for (const kind of kinds) {
      const request = { ...options, kind }
      try {
        result.set(kind, prepareInstallation(request, context))
      } catch (cause) {
        result.set(
          kind,
          unavailableReview(
            request,
            cause instanceof Error ? cause.message : 'The business module could not be prepared.'
          )
        )
      }
    }
  } catch (cause) {
    for (const kind of kinds)
      result.set(
        kind,
        unavailableReview(
          { ...options, kind },
          cause instanceof Error ? cause.message : 'The business application could not be reviewed.'
        )
      )
  }
  return result
}

function prepareInstallation(
  options: BusinessModuleInstallationOptions,
  context: ReturnType<typeof reviewContext>
): BusinessModuleInstallation {
  const { editor, kind } = options
  requireBusinessTemplatePlugins(options.store, kind)
  const locale = options.locale ?? 'en'
  const graph = editor.graph
  const { source, adopted, fingerprint, sourceIdentity } = context
  const installed =
    source.application.modules?.modules.some((module) => module.id === kind) ||
    adopted.includes(kind)
  if (installed)
    return unavailableReview(
      options,
      locale.startsWith('zh') ? '此业务模块已存在。' : 'This business module is already installed.',
      true
    )
  const shared = businessModuleSharedPages(graph)
  const composition = composeBusinessModules(source.application, [kind], { adoptExisting: adopted })
  createBackendProviderDocumentRequest(source.descriptor, composition.application)
  const pages = graph.getPages().filter((page) => !page.internalOnly && page.lowcodeRoutePattern)
  const navigation = pages.flatMap((page) => {
    const path = page.lowcodeRoutePattern
    return path &&
      page.id !== shared.login.pageId &&
      page.id !== shared.account?.pageId &&
      !/[:*?]/u.test(path)
      ? [{ key: page.id, label: businessText(page.name, page.name), path }]
      : []
  })
  const pagePlan = prepareBusinessModulePages(editor, composition.application, kind, {
    locale,
    shared,
    existingNavigation: navigation,
    existingPageIds: pages.map((page) => page.id),
    resourceBindings: composition.bindings[kind]
  })
  const label = businessLabel(businessTemplateDefinition(kind).title, locale)
  const review: BusinessModuleReview = Object.freeze({
    kind,
    status: 'ready',
    reviewKey: crypto.randomUUID(),
    summary: locale.startsWith('zh')
      ? `添加${label}，共用现有登录，保留原有页面和权限。数据库结构变化仍需在预览中核对后应用。`
      : `Add ${label}, share the existing sign-in and preserve existing pages and permissions. Review database changes separately in the preview.`,
    conflicts: Object.freeze([]),
    addedPages: pagePlan.addedPages,
    sharedPages: Object.freeze([
      shared.login.path,
      ...(shared.account ? [shared.account.path] : [])
    ])
  })
  let applied = false
  return {
    review,
    apply() {
      if (applied) throw moduleInstallationError('This module review has already been applied.')
      requireBusinessTemplatePlugins(options.store, kind)
      if (
        editor.graph !== graph ||
        businessModuleDocumentFingerprint(graph) !== fingerprint ||
        canonicalManifestJSON(resolveBusinessModuleSource(options)) !== sourceIdentity
      )
        throw moduleInstallationError(
          'The document or Backend Provider changed. Review the module again before adding it.'
        )
      return editor.undo.runBatch('Add business module', () => {
        commitBackendProviderDocumentRequest(
          editor,
          source.descriptor,
          composition.application,
          'Add business module'
        )
        const result = renderBusinessModulePages(editor, pagePlan)
        const root = graph.getNode(graph.rootId)
        validateBackendTemplatePages({
          editor,
          application: composition.application,
          docStates: root?.lowcodeDocumentState ?? [],
          pageIds: result.pageIds
        })
        const path = result.paths[businessTemplateDefinition(kind).entryPage]
        const entryPageId = result.pageIds.find(
          (id) => graph.getNode(id)?.lowcodeRoutePattern === path
        )
        if (!path || !entryPageId)
          throw moduleInstallationError('The new business module entry page is unavailable.')
        applied = true
        return { kind, pageIds: result.pageIds, entryPageId, path }
      })
    }
  }
}
