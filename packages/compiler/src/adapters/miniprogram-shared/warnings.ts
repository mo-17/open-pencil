import type { IREventHandler, IRTree } from '#compiler/ir/types'

import type { MiniProgramWarningSink } from './types'

export { createCompileWarningSink as createMiniProgramWarningSink } from '../native-shared'

export function warnMiniProgramUnsupported(
  warn: MiniProgramWarningSink,
  warningPrefix: string,
  feature: string,
  nodeId?: string
): void {
  warn({
    code: `${warningPrefix}-${feature}-unsupported`,
    message: `Mini-program export omitted unsupported ${feature.replaceAll('-', ' ')}`,
    ...(nodeId ? { nodeId } : {})
  })
}

export function miniProgramEventFeature(handler: IREventHandler): string {
  if (handler.kind === 'apiCall') return 'api-call'
  if (handler.kind.startsWith('supabase')) return 'supabase-action'
  if (handler.kind.startsWith('stripe')) return 'stripe-action'
  if (handler.kind.endsWith('Motion')) return 'motion-action'
  if (handler.kind === 'invokeServerWorkflow') return 'server-workflow-action'
  return `${handler.kind}-action`
}

export function warnMiniProgramPageFeatures(
  ir: IRTree,
  warn: MiniProgramWarningSink,
  warningPrefix: string,
  platformName: string
): void {
  if (ir.docStates.length || ir.docStateReads.length || ir.docStateWrites.length) {
    warn({
      code: `${warningPrefix}-document-state-page-local-fallback`,
      message: `${platformName} rendered document state on page ${JSON.stringify(ir.pageName)} as read-only page-local defaults`,
      nodeId: ir.pageId
    })
  }
  const features: Array<[unknown, string]> = [
    [ir.motion || ir.motionDrivers || ir.motionScene, 'motion'],
    [ir.prototype || ir.prototypeTarget || ir.transitionKey, 'prototype'],
    [ir.routePattern || ir.usesRouteParams || ir.usesQueryParams, 'dynamic-routing'],
    [ir.requiresAuth, 'auth-guard'],
    [ir.serverWorkflows?.length, 'server-workflow'],
    [ir.listQueries?.length, 'remote-list-query'],
    [ir.validatedFields?.length, 'form-validation'],
    [ir.supabaseConfig, 'supabase-runtime'],
    [ir.analyticsConfig, 'analytics-runtime'],
    [ir.translations, 'translation-runtime']
  ]
  for (const [present, feature] of features) {
    if (present) warnMiniProgramUnsupported(warn, warningPrefix, feature, ir.pageId)
  }
}
