import { parseExpression } from './expression'
import { ECMASCRIPT_RESERVED_IDENTIFIERS, isSafeLowcodeIdentifier } from './identifiers'

export interface ValidInvokeServerWorkflowAction {
  workflowId: string
  args?: Record<string, string>
  resultName?: string
}

export type InvokeServerWorkflowValidationResult =
  | { ok: true; value: ValidInvokeServerWorkflowAction }
  | { ok: false; reason: string }

const RESERVED_BINDING_NAMES: ReadonlySet<string> = new Set(ECMASCRIPT_RESERVED_IDENTIFIERS)
const ALLOWED_KEYS = new Set([
  'id',
  'kind',
  'workflowId',
  'args',
  'resultName',
  'onSuccess',
  'onError'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

type ParsedField<T> = { ok: true; value: T | undefined } | { ok: false; reason: string }

function parseResultName(raw: unknown): ParsedField<string> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== 'string' || !isSafeLowcodeIdentifier(raw) || RESERVED_BINDING_NAMES.has(raw)) {
    return { ok: false, reason: 'resultName must be a valid identifier when present' }
  }
  return { ok: true, value: raw }
}

function parseArgs(raw: unknown): ParsedField<Record<string, string>> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!isRecord(raw)) return { ok: false, reason: 'args must be an object when present' }
  const args: Record<string, string> = {}
  for (const [name, expression] of Object.entries(raw)) {
    if (!isSafeLowcodeIdentifier(name)) {
      return { ok: false, reason: `args key "${name}" must be a valid identifier` }
    }
    if (typeof expression !== 'string' || expression.trim() === '') {
      return { ok: false, reason: `args.${name} must be a non-empty expression string` }
    }
    const parsed = parseExpression(expression)
    if (!parsed.ok) return { ok: false, reason: `args.${name} is invalid: ${parsed.error}` }
    args[name] = expression
  }
  return { ok: true, value: args }
}

/** Shared shape/expression gate for the client-side server-workflow action.
 * Branch contents are recursively validated by the existing ActionDef caller;
 * this function validates their container shape and every scalar field. */
export function validateInvokeServerWorkflowAction(
  raw: unknown
): InvokeServerWorkflowValidationResult {
  if (!isRecord(raw)) return { ok: false, reason: 'must be an object' }
  if (Object.keys(raw).some((key) => !ALLOWED_KEYS.has(key))) {
    return { ok: false, reason: 'contains an unknown field' }
  }
  if (raw.kind !== 'invokeServerWorkflow') {
    return { ok: false, reason: 'kind must be "invokeServerWorkflow"' }
  }
  if (typeof raw.workflowId !== 'string' || raw.workflowId.trim() === '') {
    return { ok: false, reason: 'workflowId must be a non-empty string' }
  }
  if (raw.onSuccess !== undefined && !Array.isArray(raw.onSuccess)) {
    return { ok: false, reason: 'onSuccess must be an array when present' }
  }
  if (raw.onError !== undefined && !Array.isArray(raw.onError)) {
    return { ok: false, reason: 'onError must be an array when present' }
  }

  const resultName = parseResultName(raw.resultName)
  if (!resultName.ok) return resultName
  const args = parseArgs(raw.args)
  if (!args.ok) return args

  return {
    ok: true,
    value: {
      workflowId: raw.workflowId.trim(),
      ...(args.value === undefined ? {} : { args: args.value }),
      ...(resultName.value === undefined ? {} : { resultName: resultName.value })
    }
  }
}
