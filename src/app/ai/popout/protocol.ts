export const AI_POPOUT_PROTOCOL_VERSION = 1 as const

export const AI_POPOUT_LIMITS = Object.freeze({
  projectionBytes: 512 * 1024,
  messages: 40,
  partsPerMessage: 64,
  totalParts: 256,
  textChars: 64 * 1024,
  draftChars: 64 * 1024,
  errorChars: 2 * 1024,
  summaryChars: 512,
  labelChars: 256,
  idChars: 256,
  actionIdChars: 128
})

export type AIPopoutStatus = 'unavailable' | 'ready' | 'submitted' | 'streaming' | 'error'
export type AIPopoutToolState = 'running' | 'approval' | 'done' | 'denied' | 'cancelled' | 'error'

export type AIPopoutTextPart = Readonly<{
  type: 'text'
  text: string
}>

export type AIPopoutToolPart = Readonly<{
  type: 'tool'
  name: string
  state: AIPopoutToolState
  summary: string
  /** Reserved for wire compatibility. Popout projections must currently set this to null. */
  approvalToken: string | null
}>

export type AIPopoutMessagePart = AIPopoutTextPart | AIPopoutToolPart

export type AIPopoutMessage = Readonly<{
  id: string
  role: 'user' | 'assistant'
  parts: readonly AIPopoutMessagePart[]
}>

export type AIPopoutProjection = Readonly<{
  protocolVersion: typeof AI_POPOUT_PROTOCOL_VERSION
  contextId: string
  documentName: string
  providerLabel: string
  configured: boolean
  status: AIPopoutStatus
  error: string | null
  draft: string
  canSubmit: boolean
  canStop: boolean
  canContinue: boolean
  canRetry: boolean
  canClear: boolean
  messages: readonly AIPopoutMessage[]
}>

type AIPopoutIntentBase = Readonly<{
  protocolVersion: typeof AI_POPOUT_PROTOCOL_VERSION
  contextId: string
  clientActionId: string
}>

export type AIPopoutIntent =
  | (AIPopoutIntentBase & { type: 'submit'; text: string })
  | (AIPopoutIntentBase & {
      type: 'stop' | 'continue' | 'clear' | 'retry' | 'openSettings'
    })
  | (AIPopoutIntentBase & {
      type: 'toolApproval'
      approvalToken: string
      approved: boolean
    })

export type AIPopoutIntentErrorCode =
  | 'unavailable'
  | 'invalid'
  | 'stale-context'
  | 'unsupported'
  | 'failed'

export type AIPopoutIntentResult =
  | Readonly<{
      ok: true
      duplicate: boolean
      projection: AIPopoutProjection
    }>
  | Readonly<{
      ok: false
      code: AIPopoutIntentErrorCode
      message: string
      projection: AIPopoutProjection | null
    }>

const PROJECTION_KEYS = [
  'protocolVersion',
  'contextId',
  'documentName',
  'providerLabel',
  'configured',
  'status',
  'error',
  'draft',
  'canSubmit',
  'canStop',
  'canContinue',
  'canRetry',
  'canClear',
  'messages'
] as const
const MESSAGE_KEYS = ['id', 'role', 'parts'] as const
const TEXT_PART_KEYS = ['type', 'text'] as const
const TOOL_PART_KEYS = ['type', 'name', 'state', 'summary', 'approvalToken'] as const
const INTENT_BASE_KEYS = ['protocolVersion', 'contextId', 'clientActionId', 'type'] as const

const STATUSES = new Set<AIPopoutStatus>([
  'unavailable',
  'ready',
  'submitted',
  'streaming',
  'error'
])
const TOOL_STATES = new Set<AIPopoutToolState>([
  'running',
  'approval',
  'done',
  'denied',
  'cancelled',
  'error'
])

type UnknownObject = { [key: string]: unknown }

function isUnknownObject(value: unknown): value is UnknownObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function record(value: unknown, path: string): UnknownObject {
  if (!isUnknownObject(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
  return value
}

function exactKeys(value: UnknownObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${path} has unsupported or missing fields.`)
  }
}

function stringValue(value: unknown, path: string, maxChars: number, allowEmpty = true): string {
  if (
    typeof value !== 'string' ||
    value.length > maxChars ||
    (!allowEmpty && value.length === 0) ||
    value.includes('\0')
  ) {
    throw new TypeError(`${path} must be a bounded string.`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean.`)
  return value
}

function nullableString(value: unknown, path: string, maxChars: number): string | null {
  return value === null ? null : stringValue(value, path, maxChars)
}

function nonInteractiveApprovalToken(value: unknown, path: string): null {
  if (value !== null) {
    throw new TypeError(`${path} must be null; tool approval is available only in the editor.`)
  }
  return null
}

function parseMessagePart(value: unknown, path: string): AIPopoutMessagePart {
  const candidate = record(value, path)
  if (candidate.type === 'text') {
    exactKeys(candidate, TEXT_PART_KEYS, path)
    return {
      type: 'text',
      text: stringValue(candidate.text, `${path}.text`, AI_POPOUT_LIMITS.textChars)
    }
  }
  if (candidate.type === 'tool') {
    exactKeys(candidate, TOOL_PART_KEYS, path)
    if (!TOOL_STATES.has(candidate.state as AIPopoutToolState)) {
      throw new TypeError(`${path}.state is unsupported.`)
    }
    return {
      type: 'tool',
      name: stringValue(candidate.name, `${path}.name`, AI_POPOUT_LIMITS.labelChars, false),
      state: candidate.state as AIPopoutToolState,
      summary: stringValue(candidate.summary, `${path}.summary`, AI_POPOUT_LIMITS.summaryChars),
      approvalToken: nonInteractiveApprovalToken(candidate.approvalToken, `${path}.approvalToken`)
    }
  }
  throw new TypeError(`${path}.type is unsupported.`)
}

function parseMessage(
  value: unknown,
  path: string,
  totalParts: { value: number }
): AIPopoutMessage {
  const candidate = record(value, path)
  exactKeys(candidate, MESSAGE_KEYS, path)
  if (candidate.role !== 'user' && candidate.role !== 'assistant') {
    throw new TypeError(`${path}.role is unsupported.`)
  }
  if (
    !Array.isArray(candidate.parts) ||
    candidate.parts.length > AI_POPOUT_LIMITS.partsPerMessage
  ) {
    throw new TypeError(`${path}.parts exceeds its limit.`)
  }
  totalParts.value += candidate.parts.length
  if (totalParts.value > AI_POPOUT_LIMITS.totalParts) {
    throw new TypeError('AI popout projection has too many message parts.')
  }
  return {
    id: stringValue(candidate.id, `${path}.id`, AI_POPOUT_LIMITS.idChars, false),
    role: candidate.role,
    parts: candidate.parts.map((part, index) => parseMessagePart(part, `${path}.parts[${index}]`))
  }
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function parseAIPopoutProjection(value: unknown): AIPopoutProjection {
  if (encodedBytes(value) > AI_POPOUT_LIMITS.projectionBytes) {
    throw new TypeError('AI popout projection exceeds its byte limit.')
  }
  const candidate = record(value, 'AI popout projection')
  exactKeys(candidate, PROJECTION_KEYS, 'AI popout projection')
  if (candidate.protocolVersion !== AI_POPOUT_PROTOCOL_VERSION) {
    throw new TypeError('AI popout projection uses an unsupported protocol version.')
  }
  if (!STATUSES.has(candidate.status as AIPopoutStatus)) {
    throw new TypeError('AI popout projection status is unsupported.')
  }
  if (!Array.isArray(candidate.messages) || candidate.messages.length > AI_POPOUT_LIMITS.messages) {
    throw new TypeError('AI popout projection has too many messages.')
  }
  const totalParts = { value: 0 }
  return {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId: stringValue(
      candidate.contextId,
      'AI popout projection.contextId',
      AI_POPOUT_LIMITS.idChars,
      false
    ),
    documentName: stringValue(
      candidate.documentName,
      'AI popout projection.documentName',
      AI_POPOUT_LIMITS.labelChars
    ),
    providerLabel: stringValue(
      candidate.providerLabel,
      'AI popout projection.providerLabel',
      AI_POPOUT_LIMITS.labelChars
    ),
    configured: booleanValue(candidate.configured, 'AI popout projection.configured'),
    status: candidate.status as AIPopoutStatus,
    error: nullableString(
      candidate.error,
      'AI popout projection.error',
      AI_POPOUT_LIMITS.errorChars
    ),
    draft: stringValue(candidate.draft, 'AI popout projection.draft', AI_POPOUT_LIMITS.draftChars),
    canSubmit: booleanValue(candidate.canSubmit, 'AI popout projection.canSubmit'),
    canStop: booleanValue(candidate.canStop, 'AI popout projection.canStop'),
    canContinue: booleanValue(candidate.canContinue, 'AI popout projection.canContinue'),
    canRetry: booleanValue(candidate.canRetry, 'AI popout projection.canRetry'),
    canClear: booleanValue(candidate.canClear, 'AI popout projection.canClear'),
    messages: candidate.messages.map((message, index) =>
      parseMessage(message, `AI popout projection.messages[${index}]`, totalParts)
    )
  }
}

function parseIntentBase(candidate: UnknownObject): AIPopoutIntentBase {
  if (candidate.protocolVersion !== AI_POPOUT_PROTOCOL_VERSION) {
    throw new TypeError('AI popout intent uses an unsupported protocol version.')
  }
  return {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId: stringValue(
      candidate.contextId,
      'AI popout intent.contextId',
      AI_POPOUT_LIMITS.idChars,
      false
    ),
    clientActionId: stringValue(
      candidate.clientActionId,
      'AI popout intent.clientActionId',
      AI_POPOUT_LIMITS.actionIdChars,
      false
    )
  }
}

export function parseAIPopoutIntent(value: unknown): AIPopoutIntent {
  const candidate = record(value, 'AI popout intent')
  const type = candidate.type
  if (type === 'submit') {
    exactKeys(candidate, [...INTENT_BASE_KEYS, 'text'], 'AI popout intent')
    return {
      ...parseIntentBase(candidate),
      type,
      text: stringValue(candidate.text, 'AI popout intent.text', AI_POPOUT_LIMITS.textChars, false)
    }
  }
  if (type === 'toolApproval') {
    exactKeys(candidate, [...INTENT_BASE_KEYS, 'approvalToken', 'approved'], 'AI popout intent')
    return {
      ...parseIntentBase(candidate),
      type,
      approvalToken: stringValue(
        candidate.approvalToken,
        'AI popout intent.approvalToken',
        AI_POPOUT_LIMITS.idChars,
        false
      ),
      approved: booleanValue(candidate.approved, 'AI popout intent.approved')
    }
  }
  if (
    type === 'stop' ||
    type === 'continue' ||
    type === 'clear' ||
    type === 'retry' ||
    type === 'openSettings'
  ) {
    exactKeys(candidate, INTENT_BASE_KEYS, 'AI popout intent')
    return { ...parseIntentBase(candidate), type }
  }
  throw new TypeError('AI popout intent type is unsupported.')
}
