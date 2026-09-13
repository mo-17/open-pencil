import type { ComponentDef, IREventHandler, IRNode, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

import { sanitizeVueHrefLiteral } from './emit'
import { collectVueComponentLowcodeUsage, collectVueTreeLowcodeUsage } from './lowcode/usage'
import { supportsVueModule } from './modules/registry'
import { normalizeVueSourceLocale } from './project'

// oxlint-disable-next-line complexity -- Capability auditing intentionally enumerates every fail-closed Vue v1 boundary.
export function collectVueWarnings(
  irs: readonly IRTree[],
  components: readonly ComponentDef[],
  options: CompilerOptions
): CompileWarning[] {
  const warnings: CompileWarning[] = []
  const seen = new Set<string>()
  const warn = (code: string, message: string, nodeId?: string): void => {
    if (seen.has(code)) return
    seen.add(code)
    warnings.push({ code, message, ...(nodeId ? { nodeId } : {}) })
  }
  if (irs.length > 1 && options.router !== 'vue-router-v4') {
    warn(
      'vue-router-option-normalized',
      `Vue multi-page output requires vue-router v4; router option '${options.router}' was normalized for the generated project.`
    )
  }
  if (options.i18n) {
    warn(
      'vue-i18n-unsupported',
      'Vue v1 does not emit an i18n runtime; source-language text is preserved without translation controls.'
    )
  }
  if (options.uiKit) {
    warn(
      'vue-ui-kit-unsupported',
      `Vue v1 does not emit the '${options.uiKit}' React UI kit; semantic nodes use plain HTML.`
    )
  }
  if (options.themeSwitch) {
    warn(
      'vue-theme-switch-unsupported',
      'Vue v1 preserves generated theme CSS but omits the interactive theme switch runtime.'
    )
  }
  if (
    options.sourceLocale?.trim() &&
    normalizeVueSourceLocale(options.sourceLocale) !== options.sourceLocale.trim()
  ) {
    warn(
      'vue-source-locale-invalid',
      `Vue v1 replaced the invalid source locale '${options.sourceLocale.trim()}' with 'en'.`
    )
  }
  if (irs.length > 1 && Object.keys(options.metadata?.pages ?? {}).length > 0) {
    warn(
      'vue-page-metadata-unsupported',
      'Vue v1 emits one HTML shell for multi-page output, so route-specific metadata overrides are omitted.'
    )
  }
  const router = irs.length > 1
  const supabaseAvailable = irs.some((ir) => ir.supabaseConfig !== undefined)
  const serverWorkflowAvailable =
    supabaseAvailable && irs.some((ir) => (ir.serverWorkflows?.length ?? 0) > 0)
  for (const ir of irs) {
    if (!router && (ir.usesRouteParams || ir.usesQueryParams)) {
      warn(
        'vue-route-context-unavailable',
        'Vue single-page output cannot provide route or query parameters without vue-router; those bindings use empty objects.',
        ir.pageId
      )
    }
    if (ir.motion || ir.motionDrivers || ir.motionScene) motionWarning(warn, ir.pageId)
    if (ir.prototype || ir.prototypeTarget || ir.transitionKey) prototypeWarning(warn, ir.pageId)
    const usage = collectVueTreeLowcodeUsage(ir)
    if (
      !supabaseAvailable &&
      (usage.supabase ||
        (ir.listQueries?.length ?? 0) > 0 ||
        (!ir.backendClient &&
          (ir.requiresAuth === true || ir.docStateReads.includes('$currentUser'))))
    ) {
      warn(
        'vue-supabase-config-required',
        'Vue omitted a Supabase-backed behavior because the document has no valid public client configuration.',
        ir.pageId
      )
    }
    if (usage.serverWorkflow && !serverWorkflowAvailable) {
      warn(
        'vue-server-workflow-definition-required',
        'Vue omitted a server-workflow invocation because no validated workflow bundle is available.',
        ir.pageId
      )
    }
    if (ir.validatedFields?.some((field) => field.async)) {
      asyncValidationWarning(warn, ir.pageId)
    }
    if (ir.analyticsConfig) {
      warn(
        'vue-analytics-unsupported',
        'Vue v1 omits analytics providers and tracking actions.',
        ir.pageId
      )
    }
    ir.children.forEach((node) => scanNode(node, warn, router))
  }
  for (const definition of components) {
    const usage = collectVueComponentLowcodeUsage(definition)
    const componentReadsRouteContext = (definition.docStateReads ?? []).some(
      (name) => name === '$params' || name === '$query'
    )
    if (!router && componentReadsRouteContext) {
      warn(
        'vue-route-context-unavailable',
        'Vue single-page output cannot provide route or query parameters without vue-router; those bindings use empty objects.',
        definition.componentId
      )
    }
    if (definition.prototypeBody) prototypeWarning(warn, definition.componentId)
    if (definition.validatedFields?.some((field) => field.async)) {
      asyncValidationWarning(warn, definition.componentId)
    }
    if (
      !supabaseAvailable &&
      (usage.supabase ||
        (!definition.backendClient && (definition.docStateReads ?? []).includes('$currentUser')))
    ) {
      warn(
        'vue-supabase-config-required',
        'Vue omitted a Supabase-backed component behavior because the document has no valid public client configuration.',
        definition.componentId
      )
    }
    if (usage.serverWorkflow && !serverWorkflowAvailable) {
      warn(
        'vue-server-workflow-definition-required',
        'Vue omitted a component server-workflow invocation because no validated workflow bundle is available.',
        definition.componentId
      )
    }
    definition.children.forEach((node) => scanNode(node, warn, router))
    definition.variants?.forEach((variant) =>
      variant.children.forEach((node) => scanNode(node, warn, router))
    )
  }
  for (const state of irs[0]?.docStates ?? []) {
    if (state.persist) {
      warn(
        'vue-doc-state-persistence-unsupported',
        'Vue v1 keeps document state in memory and omits localStorage persistence.'
      )
    }
  }
  return warnings
}

// oxlint-disable-next-line complexity -- This exhaustive IR capability scanner keeps unsupported behaviors visible.
function scanNode(
  node: IRNode,
  warn: (code: string, message: string, nodeId?: string) => void,
  router: boolean
): void {
  if (node.kind === 'conditional') return scanNode(node.consequent, warn, router)
  if (node.kind === 'list') return scanNode(node.template, warn, router)
  if (node.kind === 'text' || node.kind === 'expression') return
  if (node.motion || node.motionDrivers || node.motionDriverMarker)
    motionWarning(warn, node.sourceId)
  if (
    (node.kind === 'componentRef' && node.prototypeBody) ||
    node.transitionKey ||
    node.prototypeTarget
  ) {
    prototypeWarning(warn, node.sourceId)
  }
  scanEvents(node.events, warn, node.sourceId, router)
  if (node.kind === 'componentRef') return
  if (node.motionScene || node.generatedEffect) motionWarning(warn, node.sourceId)
  if (node.module && !supportsVueModule(node.module)) {
    warn(
      'vue-module-unsupported',
      'Vue v1 has no runtime for this trusted plugin module and preserves only its static node shell.',
      node.sourceId
    )
  }
  if (node.link?.hrefLiteral !== undefined) {
    if (sanitizeVueHrefLiteral(node.link.hrefLiteral) === undefined) {
      warn(
        'vue-link-href-unsafe',
        'Vue v1 blocked an unsafe or non-allowlisted link URL.',
        node.sourceId
      )
    }
  }
  if (node.link?.hrefExpr) {
    warn(
      'vue-link-href-runtime-sanitized',
      'Vue v1 applies a runtime allowlist to this dynamic link URL and removes unsafe values.',
      node.sourceId
    )
  }
  if ((node.image?.sources?.length ?? 0) > 0) {
    warn(
      'vue-responsive-image-unsupported',
      'Vue v1 omits responsive image sources and preserves only the fallback image.',
      node.sourceId
    )
  }
  if (node.rawHtml !== undefined) {
    warn(
      'vue-raw-html-unsupported',
      'Vue v1 omits authored raw HTML instead of emitting an injectable v-html binding.',
      node.sourceId
    )
  }
  if (node.validation?.async) asyncValidationWarning(warn, node.sourceId)
  if (node.icon || node.displayKind || node.overlay) {
    warn(
      'vue-advanced-ui-unsupported',
      'Vue v1 preserves the static HTML shell but omits advanced icon/display/overlay behavior.',
      node.sourceId
    )
  }
  for (const value of Object.values(node.attrs)) {
    if (typeof value === 'object' && value.kind === 'intlMessage') {
      warn(
        'vue-i18n-unsupported',
        'Vue v1 preserves source-language attributes but omits the i18n runtime.',
        node.sourceId
      )
    }
  }
  node.children.forEach((child) => scanNode(child, warn, router))
}

function scanEvents(
  events: Partial<Record<string, IREventHandler[]>> | undefined,
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string,
  router: boolean
): void {
  for (const handlers of Object.values(events ?? {})) {
    for (const handler of handlers ?? []) scanHandler(handler, warn, nodeId, router)
  }
}

function scanHandler(
  handler: IREventHandler,
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string,
  router: boolean
): void {
  if (handler.kind === 'navigate' && !router) {
    warn(
      'vue-navigation-no-router',
      'Vue single-page output omitted an internal navigate action because no router is present.',
      nodeId
    )
    return
  }
  if (handler.kind === 'condition' || handler.kind === 'confirm') {
    handler.consequent.forEach((item) => scanHandler(item, warn, nodeId, router))
    handler.alternate?.forEach((item) => scanHandler(item, warn, nodeId, router))
    return
  }
  if (
    handler.kind === 'backendCommand' ||
    handler.kind === 'backendCommandRecovery' ||
    handler.kind === 'backendRequest' ||
    handler.kind === 'apiCall' ||
    handler.kind === 'supabaseQuery' ||
    handler.kind === 'supabaseMutation' ||
    handler.kind === 'invokeServerWorkflow'
  ) {
    handler.onSuccess?.forEach((item) => scanHandler(item, warn, nodeId, router))
    handler.onError?.forEach((item) => scanHandler(item, warn, nodeId, router))
    return
  }
  if (['playMotion', 'stopMotion', 'toggleMotion', 'awaitMotion'].includes(handler.kind)) {
    motionWarning(warn, nodeId)
    return
  }
  if (handler.kind === 'stripeCheckout' || handler.kind === 'stripeCustomerPortal') {
    warn('vue-stripe-unsupported', 'Vue v1 omitted a Stripe redirect action.', nodeId)
    return
  }
  if (handler.kind === 'trackEvent') {
    warn('vue-analytics-unsupported', 'Vue v1 omitted an analytics tracking action.', nodeId)
    return
  }
  if (!SUPPORTED_HANDLER_KINDS.has(handler.kind)) {
    warn(
      `vue-event-${handler.kind}-unsupported`,
      `Vue v1 omitted unsupported '${handler.kind}' event behavior.`,
      nodeId
    )
  }
}

const SUPPORTED_HANDLER_KINDS = new Set<IREventHandler['kind']>([
  'backendAuth',
  'backendRequest',
  'backendCommand',
  'backendCommandRecovery',
  'setState',
  'setVariable',
  'navigate',
  'apiCall',
  'condition',
  'delay',
  'stop',
  'toast',
  'confirm',
  'clipboard',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'invokeServerWorkflow'
])

function motionWarning(
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string
): void {
  warn(
    'vue-motion-unsupported',
    'Vue v1 preserves the static visual state but omits MotionSpec playback and generated effects.',
    nodeId
  )
}

function prototypeWarning(
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string
): void {
  warn(
    'vue-prototype-unsupported',
    'Vue v1 omits prototype transitions and Smart Animate behavior.',
    nodeId
  )
}

function asyncValidationWarning(
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string
): void {
  warn(
    'vue-validation-async-unsupported',
    'Vue v1 supports local validation but blocks submit when a field still requires remote validation.',
    nodeId
  )
}
