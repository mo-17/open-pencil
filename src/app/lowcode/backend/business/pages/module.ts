import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { canonicalManifestJSON } from '@open-pencil/scene-graph'

import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'
import { validateBackendTemplatePages } from '@/app/lowcode/backend/template-validation'

import { businessTemplateDefinition } from '../definitions'
import { bindBusinessDefinitionResources } from '../definitions/bindings'
import { assertBusinessTemplateId, type BusinessTemplateId } from '../model/types'
import { businessText, type BusinessTemplateEditor } from '../types'
import { prepareBusinessActions, renderBusinessActions } from './actions'
import { createBusinessPageContext, type BusinessPageContext } from './context'
import { renderBusinessPrimaryList } from './listing'
import type {
  BusinessModulePageOptions,
  BusinessModulePagePlan,
  BusinessPageReference
} from './module-types'
import {
  prepareBusinessNavigation,
  renderBusinessNavigation,
  type BusinessNavigationAddition
} from './navigation'
import { preflightBusinessPages } from './preflight'
import { createBusinessScreen } from './screen'

interface PreparedModule {
  readonly editor: BusinessTemplateEditor
  readonly context: BusinessPageContext
  readonly options: BusinessModulePageOptions
  readonly snapshot: string
  readonly additions: readonly BusinessNavigationAddition[]
}
const plans = new WeakMap<BusinessModulePagePlan, PreparedModule>()

function snapshot(editor: BusinessTemplateEditor): string {
  return canonicalManifestJSON({
    states: editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState,
    nodes: [...editor.graph.getAllNodes()].map((node) => ({
      id: node.id,
      parentId: node.parentId,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      route: node.lowcodeRoutePattern,
      markers: node.pluginData.filter((entry) => entry.pluginId === 'open-pencil.business-pages')
    }))
  })
}

function validateReference(editor: BusinessTemplateEditor, reference: BusinessPageReference): void {
  const page = editor.graph.getNode(reference.pageId)
  if (page?.type !== 'CANVAS' || page.lowcodeRoutePattern !== reference.path)
    throw new BackendDraftOperationError(
      'A shared application page changed before module preparation.'
    )
}

/** Prepare paths, bindings and append-only navigation without writing Backend or graph state. */
export function prepareBusinessModulePages(
  editor: BusinessTemplateEditor,
  application: BackendApplicationSpecV1,
  kind: BusinessTemplateId,
  options: BusinessModulePageOptions = {}
): BusinessModulePagePlan {
  assertBusinessTemplateId(kind)
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) throw new BackendDraftOperationError('The application document is unavailable.')
  if (options.shared) {
    validateReference(editor, options.shared.login)
    if (options.shared.account) validateReference(editor, options.shared.account)
    if (root.lowcodeAuthRedirect !== options.shared.login.path)
      throw new BackendDraftOperationError(
        'The existing sign-in flow must be reused without changing its redirect.'
      )
  }
  const definition = bindBusinessDefinitionResources(
    businessTemplateDefinition(kind),
    options.resourceBindings
  )
  preflightBusinessPages(application, definition)
  const context = createBusinessPageContext(
    editor,
    root,
    structuredClone(application),
    definition,
    options.locale ?? 'en',
    options
  )
  const additions = prepareBusinessNavigation(
    editor.graph,
    options.existingPageIds ?? [],
    application.applicationId,
    context.navigation
  )
  const plan: BusinessModulePagePlan = Object.freeze({
    kind,
    paths: Object.freeze({ ...context.paths }),
    navigation: Object.freeze(
      context.navigation.map((entry) =>
        Object.freeze({ ...entry, label: Object.freeze({ ...entry.label }) })
      )
    ),
    addedPages:
      definition.pages.length + (options.shared ? 0 : 1) - (options.shared?.account ? 1 : 0),
    navigationChanges: Object.freeze(
      additions
        .filter((entry) => entry.entries.length)
        .map((entry) =>
          Object.freeze({
            pageId: entry.pageId,
            strategy: entry.containerId ? ('append-marked' as const) : ('append-entry' as const),
            addedLinks: entry.entries.length
          })
        )
    )
  })
  plans.set(plan, {
    editor,
    context,
    options: structuredClone(options),
    snapshot: snapshot(editor),
    additions
  })
  return plan
}

function renderLogin(ctx: BusinessPageContext): void {
  const login = createBusinessScreen(ctx, {
    id: 'login',
    path: ctx.paths.login,
    title: businessText('Business sign in', '业务系统登录'),
    description: businessText(
      'Sign in using your identity service, then register your profile in Account setup.',
      '通过身份服务登录后，在账号设置登记个人资料。'
    ),
    public: true,
    actions: []
  })
  ctx.layout.button(
    login.page,
    ctx.copy.signIn,
    { x: 272, y: login.reserve(64), width: 240, height: 44 },
    [
      {
        id: crypto.randomUUID(),
        kind: 'backendAuth',
        operation: 'signIn',
        returnPath: ctx.paths.account,
        errorTarget: login.error
      }
    ]
  )
  login.finish()
}

/** The caller owns one undo batch covering model composition and every page mutation. */
export function renderBusinessModulePages(
  editor: BusinessTemplateEditor,
  plan: BusinessModulePagePlan
) {
  const prepared = plans.get(plan)
  if (!prepared || prepared.editor.graph !== editor.graph || prepared.snapshot !== snapshot(editor))
    throw new BackendDraftOperationError(
      'The document changed after module preparation. Review the module again.'
    )
  plans.delete(plan)
  const { context: ctx, options, additions } = prepared
  if (!options.shared) renderLogin(ctx)
  for (const page of ctx.definition.pages) {
    if (page.id === 'account' && options.shared?.account) continue
    const screen = createBusinessScreen(ctx, page)
    const actions = prepareBusinessActions(screen)
    renderBusinessPrimaryList(screen)
    renderBusinessActions(screen, actions)
    screen.finish()
  }
  const touched = renderBusinessNavigation(
    editor,
    ctx.application.applicationId,
    additions,
    ctx.locale
  )
  editor.updateNodeWithUndo(
    editor.graph.rootId,
    { lowcodeDocumentState: ctx.documentStates, lowcodeAuthRedirect: ctx.paths.login },
    'Configure business module pages'
  )
  validateBackendTemplatePages({
    editor,
    application: ctx.application,
    docStates: ctx.documentStates,
    pageIds: [...ctx.pageIds, ...touched]
  })
  const reference = (key: string): BusinessPageReference => {
    const page = editor.graph
      .getPages()
      .find((entry) => entry.lowcodeRoutePattern === ctx.paths[key])
    if (!page)
      throw new BackendDraftOperationError('The shared business page could not be resolved.')
    return { pageId: page.id, path: ctx.paths[key] }
  }
  return {
    pageIds: ctx.pageIds,
    paths: ctx.paths,
    shared: { login: reference('login'), account: reference('account') },
    navigationChanges: plan.navigationChanges
  }
}
