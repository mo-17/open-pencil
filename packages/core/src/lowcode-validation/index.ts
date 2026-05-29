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
  emitExpression,
  hasPrevReference,
  parseExpression,
  parseTemplate,
  substitutePrev
} from './expression'

export {
  type ValidationResult,
  normalizeSupabaseMutationPayloadJson,
  validateExpression,
  validateStateName,
  validateUrlTemplate
} from './validate'

export {
  decodeJwtPayload,
  detectServiceRole,
  validateSupabaseConfig
} from './supabase-config'

export {
  PAYLOAD_ENTRY_KEY_RE,
  validateSupabasePayloadEntries
} from './supabase-payload-entries'

export {
  type DatePickerIssue,
  type DatePickerIssueCode,
  isIsoDate,
  validateDatePickerProps
} from './datepicker-props'
