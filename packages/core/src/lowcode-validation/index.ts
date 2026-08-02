/**
 * Phase 3 §3 — shared lowcode validators + expression sublanguage.
 *
 * Single source of truth for the validation logic that the editor UI,
 * the compiler IR pass, and the lowcode AI tool surface all rely on.
 * Lives in `@open-pencil/core` so the tool (which sits in core) can
 * reach it without violating the `compiler → core` direction. Compiler
 * + editor previously held copies in `packages/compiler/src/ir/`; this
 * module is now the canonical location and the compiler re-exports from
 * here at its public entry point so older consumers stay unbroken.
 */
export {
  type BinaryOp,
  type ExprAst,
  type ParseFailure,
  type ParseResult,
  type ParseSuccess,
  PREV_IDENT,
  collectReferences,
  emitExpression,
  hasPrevReference,
  parseExpression,
  parseTemplate,
  substituteIdents,
  substitutePrev
} from './expression'

export {
  type ValidationResult,
  normalizeSupabaseMutationPayloadJson,
  validateExpression,
  validateStateName,
  validateUrlTemplate
} from './validate'

export { decodeJwtPayload, detectServiceRole, validateSupabaseConfig } from './supabase-config'

export { isSafeAnalyticsPolicyUrl, validateAnalyticsConfig } from './analytics-config'

export {
  lowcodeCustomCssUrls,
  unsafeLowcodeCustomCssUrls,
  validateLowcodeCustomCss
} from './custom-css'

export {
  compactLowcodeHeadMetadata,
  isSafeLowcodeHeadLinkHref,
  unsafeLowcodeHeadMetaRefreshUrl,
  validateLowcodeHeadMeta
} from './head-metadata'

export { PAYLOAD_ENTRY_KEY_RE, validateSupabasePayloadEntries } from './supabase-payload-entries'

export {
  type DatePickerIssue,
  type DatePickerIssueCode,
  isIsoDate,
  validateDatePickerProps
} from './datepicker-props'

export {
  type InteractivePropsIssue,
  type InteractivePropsIssueSeverity,
  isInteractivePropsObject,
  validateInteractiveProps
} from './interactive-props'

export {
  type RlsTableRequirement,
  type SqlCommand,
  buildRlsPolicySql,
  collectRlsRequirements
} from './rls-advisor'

export {
  type LowcodePageRouteInfo,
  type LowcodeRoutePage,
  type LowcodeRouteParameter,
  deriveLowcodePageRoutes,
  inspectLowcodeRouteParameters,
  lowcodeNavigationPathname,
  lowcodeRouteCollisionKey,
  lowcodeRouteMatches,
  validateLowcodeRoutePattern
} from './routes'

export {
  type NavigationAuditIssue,
  type NavigationAuditIssueCode,
  type NavigationAuditOptions,
  type NavigationAuditResult,
  type NavigationEdge,
  type NavigationEdgeStatus,
  type NavigationNoEventButton,
  type NavigationRouteCollision,
  type NavigationRouteEntry,
  auditLowcodeNavigation
} from './navigation-audit'

export {
  FORM_CONTROLS_AUDIT_DEFAULT_LIMIT,
  FORM_CONTROLS_AUDIT_MAX_LIMIT,
  FORM_VALUE_BINDING_MAX_REPAIRS,
  type FormControlAuditEntry,
  type FormControlBindingTargetType,
  type FormControlBindingStatus,
  type FormControlsAuditOptions,
  type FormControlsAudit,
  type FormControlsResult,
  type FormControlStateType,
  type FormValueBindingPlan,
  auditValidatedFormControls,
  findComponentMasterAncestor,
  isCheckboxGroupControl,
  planValidatedFormValueBindings
} from './form-controls'
