/* eslint-disable max-lines -- Reviewed request shaping and response normalization share one boundary. */
import {
  parsePluginConnectorContract,
  parsePluginObjectParameterValue,
  type PluginConnectorContractV1,
  type PluginConnectorOperationV1,
  type PluginParameterValue
} from '@open-pencil/plugin-contracts'
import { parseBoundedManifestArray, parseExactManifestRecord } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { credentialRef } from '@/app/settings/credentials/reference'

import {
  ConnectorExecutionError,
  type ConnectorHostAdapter,
  type ConnectorParameterObject,
  type PrepareConnectorRequestContext,
  type PreparedConnectorRequest
} from './types'

export const RESEND_EMAIL_PLUGIN_ID = 'open-pencil.resend-email'
export const RESEND_EMAIL_CONNECTOR_ID = 'resend.email'
export const RESEND_EMAIL_ADAPTER_ID = 'open-pencil.connector.resend-email'
export const RESEND_EMAIL_ORIGIN = 'https://api.resend.com'
export const RESEND_EMAIL_CREDENTIAL_SLOT_ID = 'api-key'
export const RESEND_GET_EMAIL_OPERATION_ID = 'get-email'
export const RESEND_SEND_EMAIL_OPERATION_ID = 'send-email'

export const RESEND_EMAIL_LIMITS = Object.freeze({
  timeoutMs: 15_000,
  parameterBytes: 256 * 1024,
  requestBytes: 256 * 1024,
  upstreamResponseBytes: 512 * 1024,
  resultBytes: 384 * 1024,
  recipientCount: 50,
  emailAddressLength: 320,
  fromLength: 512,
  subjectLength: 998,
  textLength: 128 * 1024,
  htmlLength: 192 * 1024,
  emailIdLength: 128,
  timestampLength: 64,
  eventLength: 64
})

const EMAIL_ADDRESS_SCHEMA = Object.freeze({
  type: 'string' as const,
  minLength: 3,
  maxLength: RESEND_EMAIL_LIMITS.emailAddressLength
})

const RECIPIENTS_SCHEMA = Object.freeze({
  type: 'array' as const,
  items: EMAIL_ADDRESS_SCHEMA,
  minItems: 1,
  maxItems: RESEND_EMAIL_LIMITS.recipientCount
})
const FROM_SCHEMA = Object.freeze({
  type: 'string' as const,
  minLength: 3,
  maxLength: RESEND_EMAIL_LIMITS.fromLength
})
const SUBJECT_SCHEMA = Object.freeze({
  type: 'string' as const,
  minLength: 1,
  maxLength: RESEND_EMAIL_LIMITS.subjectLength
})
const TEXT_SCHEMA = Object.freeze({
  type: 'string' as const,
  maxLength: RESEND_EMAIL_LIMITS.textLength
})
const HTML_SCHEMA = Object.freeze({
  type: 'string' as const,
  maxLength: RESEND_EMAIL_LIMITS.htmlLength
})
const EMAIL_ID_SCHEMA = Object.freeze({
  type: 'string' as const,
  minLength: 1,
  maxLength: RESEND_EMAIL_LIMITS.emailIdLength
})

const SEND_PARAMETERS_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    from: FROM_SCHEMA,
    to: RECIPIENTS_SCHEMA,
    cc: RECIPIENTS_SCHEMA,
    bcc: RECIPIENTS_SCHEMA,
    subject: SUBJECT_SCHEMA,
    text: TEXT_SCHEMA,
    html: HTML_SCHEMA
  }),
  required: Object.freeze(['from', 'to', 'subject']),
  additionalProperties: false as const,
  minProperties: 4,
  maxProperties: 7
})

const SEND_RESULT_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    id: EMAIL_ID_SCHEMA
  }),
  required: Object.freeze(['id']),
  additionalProperties: false as const,
  minProperties: 1,
  maxProperties: 1
})

const GET_RESULT_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    id: EMAIL_ID_SCHEMA,
    from: FROM_SCHEMA,
    to: RECIPIENTS_SCHEMA,
    cc: Object.freeze({ ...RECIPIENTS_SCHEMA, minItems: 0 }),
    bcc: Object.freeze({ ...RECIPIENTS_SCHEMA, minItems: 0 }),
    subject: SUBJECT_SCHEMA,
    text: TEXT_SCHEMA,
    html: HTML_SCHEMA,
    createdAt: Object.freeze({
      type: 'string' as const,
      minLength: 1,
      maxLength: RESEND_EMAIL_LIMITS.timestampLength
    }),
    lastEvent: Object.freeze({
      type: 'string' as const,
      minLength: 1,
      maxLength: RESEND_EMAIL_LIMITS.eventLength
    })
  }),
  required: Object.freeze(['id', 'from', 'to', 'cc', 'bcc', 'subject', 'createdAt', 'lastEvent']),
  additionalProperties: false as const,
  minProperties: 8,
  maxProperties: 10
})

export const RESEND_EMAIL_CONNECTOR_CONTRACT: PluginConnectorContractV1 =
  parsePluginConnectorContract({
    format: 'openpencil-plugin-connector-contract',
    schemaVersion: 1,
    pluginId: RESEND_EMAIL_PLUGIN_ID,
    connectorId: RESEND_EMAIL_CONNECTOR_ID,
    adapterId: RESEND_EMAIL_ADAPTER_ID,
    name: 'Resend Email',
    description: 'Retrieve or send bounded email messages through a reviewed Resend host adapter.',
    kind: 'data-source',
    network: {
      origins: [RESEND_EMAIL_ORIGIN],
      methods: ['GET', 'POST'],
      credentials: 'omit',
      redirects: 'error'
    },
    credentialSlots: [
      {
        slotId: RESEND_EMAIL_CREDENTIAL_SLOT_ID,
        label: 'Resend API key',
        kind: 'bearer-token',
        required: true
      }
    ],
    operations: [
      {
        operationId: RESEND_GET_EMAIL_OPERATION_ID,
        name: 'Get email',
        description: 'Retrieve one previously sent email by its bounded Resend ID.',
        kind: 'query',
        credentialSlots: [RESEND_EMAIL_CREDENTIAL_SLOT_ID],
        request: {
          origin: RESEND_EMAIL_ORIGIN,
          method: 'GET',
          pathTemplate: '/emails/{emailId}',
          maxResponseBytes: RESEND_EMAIL_LIMITS.upstreamResponseBytes
        },
        parameters: {
          schema: {
            type: 'object',
            properties: {
              emailId: {
                type: 'string',
                minLength: 1,
                maxLength: RESEND_EMAIL_LIMITS.emailIdLength
              }
            },
            required: ['emailId'],
            additionalProperties: false,
            minProperties: 1,
            maxProperties: 1
          },
          maxBytes: 512
        },
        result: {
          schema: GET_RESULT_SCHEMA,
          maxBytes: RESEND_EMAIL_LIMITS.resultBytes
        }
      },
      {
        operationId: RESEND_SEND_EMAIL_OPERATION_ID,
        name: 'Send email',
        description: 'Send one bounded email after explicit confirmation for this invocation.',
        kind: 'mutation',
        credentialSlots: [RESEND_EMAIL_CREDENTIAL_SLOT_ID],
        request: {
          origin: RESEND_EMAIL_ORIGIN,
          method: 'POST',
          pathTemplate: '/emails',
          maxResponseBytes: RESEND_EMAIL_LIMITS.upstreamResponseBytes
        },
        parameters: {
          schema: SEND_PARAMETERS_SCHEMA,
          maxBytes: RESEND_EMAIL_LIMITS.parameterBytes
        },
        result: {
          schema: SEND_RESULT_SCHEMA,
          maxBytes: 2 * 1024
        }
      }
    ]
  })

function requiredOperation(operationId: string): PluginConnectorOperationV1 {
  const operation = RESEND_EMAIL_CONNECTOR_CONTRACT.operations.find(
    (candidate) => candidate.operationId === operationId
  )
  if (!operation) throw new Error(`Reviewed Resend operation is unavailable: ${operationId}`)
  return operation
}

export const RESEND_GET_EMAIL_OPERATION = requiredOperation(RESEND_GET_EMAIL_OPERATION_ID)
export const RESEND_SEND_EMAIL_OPERATION = requiredOperation(RESEND_SEND_EMAIL_OPERATION_ID)
export const RESEND_EMAIL_CREDENTIAL_REFS = Object.freeze({
  [RESEND_EMAIL_CREDENTIAL_SLOT_ID]: credentialRef(
    RESEND_EMAIL_PLUGIN_ID,
    RESEND_EMAIL_CREDENTIAL_SLOT_ID
  )
})
export const RESEND_EMAIL_EXECUTION_DEFAULTS = Object.freeze({
  credentialRefs: RESEND_EMAIL_CREDENTIAL_REFS,
  timeoutMs: RESEND_EMAIL_LIMITS.timeoutMs
})

const REVIEWED_CONTRACT_JSON = JSON.stringify(RESEND_EMAIL_CONNECTOR_CONTRACT)
const REVIEWED_OPERATION_JSON = new Map(
  RESEND_EMAIL_CONNECTOR_CONTRACT.operations.map((operation) => [
    operation.operationId,
    JSON.stringify(operation)
  ])
)
const EMAIL_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/
const LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const EVENT = /^[a-z][a-z0-9_-]{0,63}$/
const TEXT_ENCODER = new TextEncoder()
const SEND_RESPONSE_KEYS = new Set(['id'])
const GET_RESPONSE_KEYS = new Set([
  'object',
  'id',
  'to',
  'from',
  'created_at',
  'subject',
  'html',
  'text',
  'bcc',
  'cc',
  'reply_to',
  'last_event',
  'scheduled_at',
  'tags'
])
const GET_RESPONSE_REQUIRED_KEYS = new Set([
  'object',
  'id',
  'to',
  'from',
  'created_at',
  'subject',
  'last_event'
])

function invalidParameters(message: string, cause?: unknown): ConnectorExecutionError {
  return new ConnectorExecutionError(
    'invalid-parameters',
    message,
    cause === undefined ? undefined : { cause }
  )
}

function invalidResponse(message: string, cause?: unknown): ConnectorExecutionError {
  return new ConnectorExecutionError(
    'invalid-response',
    message,
    cause === undefined ? undefined : { cause }
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new ConnectorExecutionError('aborted', 'Resend email operation was aborted.')
}

function reviewedOperation(
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1
): PluginConnectorOperationV1 {
  try {
    const parsedContract = parsePluginConnectorContract(contract)
    if (JSON.stringify(parsedContract) !== REVIEWED_CONTRACT_JSON) {
      throw new TypeError('contract mismatch')
    }
    const envelope = parsePluginConnectorContract({
      ...RESEND_EMAIL_CONNECTOR_CONTRACT,
      operations: [operation]
    })
    const parsedOperation = envelope.operations.at(0)
    const reviewedJSON = parsedOperation
      ? REVIEWED_OPERATION_JSON.get(parsedOperation.operationId)
      : undefined
    if (!parsedOperation || !reviewedJSON || JSON.stringify(parsedOperation) !== reviewedJSON) {
      throw new TypeError('operation mismatch')
    }
    return requiredOperation(parsedOperation.operationId)
  } catch (cause) {
    throw new ConnectorExecutionError(
      'authority-mismatch',
      'Resend Email connector authority does not match the reviewed contract.',
      { cause }
    )
  }
}

function boundedString(value: unknown, maximum: number, label: string, minimum = 1): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${label} must contain between ${minimum} and ${maximum} characters`)
  }
  return value
}

function headerText(value: unknown, maximum: number, label: string): string {
  const parsed = boundedString(value, maximum, label)
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(parsed)) {
    throw new TypeError(`${label} must not contain control or line-separator characters`)
  }
  return parsed
}

function emailAddress(value: unknown, label: string): string {
  const parsed = headerText(value, RESEND_EMAIL_LIMITS.emailAddressLength, label)
  const separator = parsed.lastIndexOf('@')
  if (separator <= 0 || separator === parsed.length - 1) {
    throw new TypeError(`${label} must be a bounded email address`)
  }
  const local = parsed.slice(0, separator)
  const domain = parsed.slice(separator + 1)
  const labels = domain.split('.')
  if (
    !LOCAL_PART.test(local) ||
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some((candidate) => !DOMAIN_LABEL.test(candidate))
  ) {
    throw new TypeError(`${label} must be a bounded email address`)
  }
  return parsed
}

function sender(value: unknown): string {
  const parsed = headerText(value, RESEND_EMAIL_LIMITS.fromLength, 'Resend from')
  if (!parsed.endsWith('>')) return emailAddress(parsed, 'Resend from')
  const opening = parsed.lastIndexOf('<')
  if (opening <= 0) throw new TypeError('Resend from must contain a valid sender')
  const displayName = parsed.slice(0, opening).trim()
  if (!displayName || displayName.length > 128 || /[<>]/.test(displayName)) {
    throw new TypeError('Resend from display name is invalid')
  }
  const address = emailAddress(parsed.slice(opening + 1, -1), 'Resend from address')
  return `${displayName} <${address}>`
}

function recipientList(value: unknown, label: string, minimum = 1): readonly string[] {
  const values = parseBoundedManifestArray(value, label, RESEND_EMAIL_LIMITS.recipientCount)
  if (values.length < minimum) throw new TypeError(`${label} must contain at least one recipient`)
  return Object.freeze(
    values.map((candidate, index) => emailAddress(candidate, `${label}[${index}]`))
  )
}

function optionalRecipientList(value: unknown, label: string): readonly string[] {
  if (value === undefined || value === null) return Object.freeze([])
  return recipientList(value, label, 0)
}

function emailId(value: unknown, label = 'Resend email ID'): string {
  const parsed = boundedString(value, RESEND_EMAIL_LIMITS.emailIdLength, label)
  if (!EMAIL_ID.test(parsed)) throw new TypeError(`${label} is invalid`)
  return parsed
}

function parsedParameters(
  parameters: ConnectorParameterObject,
  operation: PluginConnectorOperationV1
): Readonly<{ [key: string]: PluginParameterValue }> {
  try {
    return parsePluginObjectParameterValue(
      parameters,
      operation.parameters.schema,
      operation.parameters.maxBytes,
      `Resend ${operation.operationId} parameters`
    )
  } catch (cause) {
    throw invalidParameters('Resend email parameters are invalid.', cause)
  }
}

function normalizedSendBody(parameters: ConnectorParameterObject): JSONObject {
  const source = parsedParameters(parameters, RESEND_SEND_EMAIL_OPERATION)
  try {
    const from = sender(source.from)
    const to = recipientList(source.to, 'Resend to')
    const cc = Object.hasOwn(source, 'cc') ? recipientList(source.cc, 'Resend cc') : undefined
    const bcc = Object.hasOwn(source, 'bcc') ? recipientList(source.bcc, 'Resend bcc') : undefined
    if (to.length + (cc?.length ?? 0) + (bcc?.length ?? 0) > RESEND_EMAIL_LIMITS.recipientCount) {
      throw new TypeError(
        `Resend recipients exceed the ${RESEND_EMAIL_LIMITS.recipientCount}-address limit`
      )
    }
    const subject = headerText(source.subject, RESEND_EMAIL_LIMITS.subjectLength, 'Resend subject')
    const text = Object.hasOwn(source, 'text')
      ? boundedString(source.text, RESEND_EMAIL_LIMITS.textLength, 'Resend text', 0)
      : undefined
    const html = Object.hasOwn(source, 'html')
      ? boundedString(source.html, RESEND_EMAIL_LIMITS.htmlLength, 'Resend HTML', 0)
      : undefined
    if (!text && !html) throw new TypeError('Resend email requires non-empty text or HTML content')
    return Object.freeze({
      from,
      to,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      subject,
      ...(text !== undefined ? { text } : {}),
      ...(html !== undefined ? { html } : {})
    }) as JSONObject
  } catch (cause) {
    if (cause instanceof ConnectorExecutionError) throw cause
    throw invalidParameters('Resend email parameters are invalid.', cause)
  }
}

export function prepareResendEmailRequest(
  context: PrepareConnectorRequestContext
): PreparedConnectorRequest {
  throwIfAborted(context.signal)
  const operation = reviewedOperation(context.contract, context.operation)
  if (operation.operationId === RESEND_GET_EMAIL_OPERATION_ID) {
    const parameters = parsedParameters(context.parameters, operation)
    let id: string
    try {
      id = emailId(parameters.emailId)
    } catch (cause) {
      throw invalidParameters('Resend email ID is invalid.', cause)
    }
    return Object.freeze({
      url: `${RESEND_EMAIL_ORIGIN}/emails/${encodeURIComponent(id)}`,
      headers: Object.freeze({ Accept: 'application/json' })
    })
  }
  const body = JSON.stringify(normalizedSendBody(context.parameters))
  if (TEXT_ENCODER.encode(body).byteLength > RESEND_EMAIL_LIMITS.requestBytes) {
    throw new ConnectorExecutionError(
      'request-too-large',
      'Resend email request exceeds its limit.'
    )
  }
  throwIfAborted(context.signal)
  return Object.freeze({
    url: `${RESEND_EMAIL_ORIGIN}/emails`,
    headers: Object.freeze({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(context.mutationAttemptId ? { 'Idempotency-Key': context.mutationAttemptId } : {})
    }),
    body
  })
}

function resultValue(
  value: JSONObject,
  operation: PluginConnectorOperationV1
): Readonly<{ [key: string]: PluginParameterValue }> {
  const json = JSON.stringify(value)
  if (TEXT_ENCODER.encode(json).byteLength > operation.result.maxBytes) {
    throw new ConnectorExecutionError(
      'response-too-large',
      'Resend normalized response exceeds its result limit.'
    )
  }
  try {
    return parsePluginObjectParameterValue(
      value,
      operation.result.schema,
      operation.result.maxBytes,
      `Resend ${operation.operationId} result`
    )
  } catch (cause) {
    throw invalidResponse('Resend response is invalid or unsupported.', cause)
  }
}

function nullableContent(value: unknown, maximum: number, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return boundedString(value, maximum, label, 0)
}

function normalizedSendResponse(value: unknown): Readonly<{ [key: string]: PluginParameterValue }> {
  try {
    const source = parseExactManifestRecord(value, 'Resend send response', SEND_RESPONSE_KEYS)
    return resultValue(
      { id: emailId(source.id, 'Resend response ID') },
      RESEND_SEND_EMAIL_OPERATION
    )
  } catch (cause) {
    if (cause instanceof ConnectorExecutionError) throw cause
    throw invalidResponse('Resend send response is invalid or unsupported.', cause)
  }
}

function responseTimestamp(value: unknown): string {
  const parsed = headerText(value, RESEND_EMAIL_LIMITS.timestampLength, 'Resend created timestamp')
  if (!Number.isFinite(Date.parse(parsed)))
    throw new TypeError('Resend created timestamp is invalid')
  return parsed
}

function normalizedGetResponse(value: unknown): Readonly<{ [key: string]: PluginParameterValue }> {
  try {
    const source = parseExactManifestRecord(
      value,
      'Resend get response',
      GET_RESPONSE_KEYS,
      GET_RESPONSE_REQUIRED_KEYS
    )
    if (source.object !== 'email') throw new TypeError('Resend response object must be email')
    const lastEvent = headerText(
      source.last_event,
      RESEND_EMAIL_LIMITS.eventLength,
      'Resend last event'
    )
    if (!EVENT.test(lastEvent)) throw new TypeError('Resend last event is invalid')
    const text = nullableContent(
      source.text,
      RESEND_EMAIL_LIMITS.textLength,
      'Resend response text'
    )
    const html = nullableContent(
      source.html,
      RESEND_EMAIL_LIMITS.htmlLength,
      'Resend response HTML'
    )
    const normalized = Object.freeze({
      id: emailId(source.id, 'Resend response ID'),
      from: sender(source.from),
      to: recipientList(source.to, 'Resend response to'),
      cc: optionalRecipientList(source.cc, 'Resend response cc'),
      bcc: optionalRecipientList(source.bcc, 'Resend response bcc'),
      subject: headerText(
        source.subject,
        RESEND_EMAIL_LIMITS.subjectLength,
        'Resend response subject'
      ),
      createdAt: responseTimestamp(source.created_at),
      lastEvent,
      ...(text === undefined ? {} : { text }),
      ...(html === undefined ? {} : { html })
    }) as JSONObject
    return resultValue(normalized, RESEND_GET_EMAIL_OPERATION)
  } catch (cause) {
    if (cause instanceof ConnectorExecutionError) throw cause
    throw invalidResponse('Resend get response is invalid or unsupported.', cause)
  }
}

export function normalizeResendEmailResponse(
  value: unknown,
  operationId: string
): Readonly<{ [key: string]: PluginParameterValue }> {
  if (operationId === RESEND_SEND_EMAIL_OPERATION_ID) return normalizedSendResponse(value)
  if (operationId === RESEND_GET_EMAIL_OPERATION_ID) return normalizedGetResponse(value)
  throw invalidResponse('Resend response operation is not supported.')
}

export interface ResendEmailConnectorAdapter extends ConnectorHostAdapter {
  normalizeResponse(
    value: unknown,
    operationId: string
  ): Readonly<{ [key: string]: PluginParameterValue }>
}

export const RESEND_EMAIL_CONNECTOR_ADAPTER: ResendEmailConnectorAdapter = Object.freeze({
  pluginId: RESEND_EMAIL_PLUGIN_ID,
  connectorId: RESEND_EMAIL_CONNECTOR_ID,
  adapterId: RESEND_EMAIL_ADAPTER_ID,
  contract: RESEND_EMAIL_CONNECTOR_CONTRACT,
  async prepare(context: PrepareConnectorRequestContext): Promise<PreparedConnectorRequest> {
    return prepareResendEmailRequest(context)
  },
  transformResponse(value: unknown, context: PrepareConnectorRequestContext): PluginParameterValue {
    throwIfAborted(context.signal)
    const operation = reviewedOperation(context.contract, context.operation)
    const result = normalizeResendEmailResponse(value, operation.operationId)
    throwIfAborted(context.signal)
    return result
  },
  normalizeResponse: normalizeResendEmailResponse
})
