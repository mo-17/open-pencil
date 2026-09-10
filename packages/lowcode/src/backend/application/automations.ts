/* eslint-disable max-lines -- Automation parsing and reference checks share one authority boundary. */
import { parseExpression } from '@open-pencil/lowcode'

import { discriminatedRecord } from '../discriminated-record'
import type {
  BackendCredentialRef,
  BackendSecretRef,
  BackendWorkflowIR,
  DataModelIR
} from '../types'
import { isBackendCredentialRef } from '../validate'
import {
  boolean,
  boundedText,
  id,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from '../validation-helpers'
import {
  BACKEND_AUTOMATION_IR_VERSION,
  type BackendAutomationActionIR,
  type BackendAutomationDefinitionIR,
  type BackendAutomationIdempotencyIR,
  type BackendAutomationIRV1,
  type BackendAutomationParameterMappingIR,
  type BackendAutomationParameterSourceIR,
  type BackendAutomationRetryIR,
  type BackendAutomationTriggerIR,
  type BackendDriftDetectionIR,
  type BackendOperationalTelemetryIR,
  type BackendQueueIR,
  type BackendTransactionIRV1,
  type BackendWebhookDestinationIR,
  type BackendWebhookHmacEnvelopeIR
} from './types'
import {
  integerBetween,
  literal,
  referencedEntity,
  validateFieldReference
} from './validation-helpers'

const MAX_QUEUES = 256
const MAX_WEBHOOK_DESTINATIONS = 256
const MAX_AUTOMATIONS = 512
const MAX_QUEUE_PAYLOAD_BYTES = 1_048_576
const MAX_QUEUE_RETENTION_SECONDS = 2_592_000

const TRIGGER_SHAPES = {
  schedule: { allowed: ['kind', 'cron', 'timezone'], required: ['kind', 'cron', 'timezone'] },
  queue: { allowed: ['kind', 'queueId'], required: ['kind', 'queueId'] },
  webhook: {
    allowed: ['kind', 'method', 'path', 'signature'],
    required: ['kind', 'method', 'path', 'signature']
  },
  'data-change': {
    allowed: ['kind', 'entityId', 'events'],
    required: ['kind', 'entityId', 'events']
  }
} as const

const ACTION_SHAPES = {
  workflow: {
    allowed: ['kind', 'workflowId', 'parameters'],
    required: ['kind', 'workflowId', 'parameters']
  },
  transaction: {
    allowed: ['kind', 'transactionId', 'parameters'],
    required: ['kind', 'transactionId', 'parameters']
  },
  'queue.publish': {
    allowed: ['kind', 'queueId', 'payloadExpression'],
    required: ['kind', 'queueId', 'payloadExpression']
  },
  'webhook.deliver': {
    allowed: ['kind', 'destinationId', 'payloadExpression'],
    required: ['kind', 'destinationId', 'payloadExpression']
  },
  'drift.detect': {
    allowed: ['kind', 'scope', 'mode'],
    required: ['kind', 'scope', 'mode']
  }
} as const

const PARAMETER_SOURCE_SHAPES = {
  'event-field': { allowed: ['kind', 'path'], required: ['kind', 'path'] },
  literal: { allowed: ['kind', 'value'], required: ['kind', 'value'] }
} as const

const IDEMPOTENCY_SHAPES = {
  'event-id': { allowed: ['kind', 'retentionHours'], required: ['kind', 'retentionHours'] },
  'request-header': {
    allowed: ['kind', 'headerName', 'retentionHours'],
    required: ['kind', 'headerName', 'retentionHours']
  },
  'data-field': {
    allowed: ['kind', 'entityId', 'fieldId', 'retentionHours'],
    required: ['kind', 'entityId', 'fieldId', 'retentionHours']
  }
} as const

function queue(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendQueueIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'visibility',
    'delivery',
    'maxPayloadBytes',
    'visibilityTimeoutSeconds',
    'retentionSeconds'
  ])
  if (!source) return undefined
  const queueId = id(source.id, `${path}.id`, context)
  const name = boundedText(source.name, `${path}.name`, context, 128)
  const visibility = oneOf(source.visibility, `${path}.visibility`, context, ['private'])
  const delivery = oneOf(source.delivery, `${path}.delivery`, context, ['at-least-once'])
  const maxPayloadBytes = integerBetween(
    source.maxPayloadBytes,
    `${path}.maxPayloadBytes`,
    context,
    1,
    MAX_QUEUE_PAYLOAD_BYTES
  )
  const retentionSeconds = integerBetween(
    source.retentionSeconds,
    `${path}.retentionSeconds`,
    context,
    60,
    MAX_QUEUE_RETENTION_SECONDS
  )
  const visibilityTimeoutSeconds = integerBetween(
    source.visibilityTimeoutSeconds,
    `${path}.visibilityTimeoutSeconds`,
    context,
    1,
    3_600
  )
  if (
    visibilityTimeoutSeconds !== undefined &&
    retentionSeconds !== undefined &&
    visibilityTimeoutSeconds >= retentionSeconds
  ) {
    context.diagnostics.push({
      code: 'backend-queue-visibility-invalid',
      severity: 'error',
      path: `${path}.visibilityTimeoutSeconds`,
      message: 'Queue visibility timeout must be shorter than message retention.'
    })
  }
  return queueId &&
    name &&
    visibility &&
    delivery &&
    maxPayloadBytes !== undefined &&
    visibilityTimeoutSeconds !== undefined &&
    retentionSeconds !== undefined
    ? {
        id: queueId,
        name,
        visibility,
        delivery,
        maxPayloadBytes,
        visibilityTimeoutSeconds,
        retentionSeconds
      }
    : undefined
}

function credentialReference(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCredentialRef | undefined {
  if (isBackendCredentialRef(value)) return value
  context.diagnostics.push({
    code: 'backend-credential-reference-invalid',
    severity: 'error',
    path,
    message: 'Credential references must use a host-issued opaque credential.<uuid> handle.'
  })
  return undefined
}

function webhookDestination(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendWebhookDestinationIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'endpointCredentialRef',
    'method',
    'contentType',
    'maxPayloadBytes',
    'signingCredentialRef',
    'signature'
  ])
  if (!source) return undefined
  const destinationId = id(source.id, `${path}.id`, context)
  const name = boundedText(source.name, `${path}.name`, context, 128)
  const endpointCredentialRef = credentialReference(
    source.endpointCredentialRef,
    `${path}.endpointCredentialRef`,
    context
  )
  const method = oneOf(source.method, `${path}.method`, context, ['POST'])
  const contentType = oneOf(source.contentType, `${path}.contentType`, context, [
    'application/json'
  ])
  const maxPayloadBytes = integerBetween(
    source.maxPayloadBytes,
    `${path}.maxPayloadBytes`,
    context,
    1,
    MAX_QUEUE_PAYLOAD_BYTES
  )
  const signingCredentialRef = credentialReference(
    source.signingCredentialRef,
    `${path}.signingCredentialRef`,
    context
  )
  const signatureSource = record(source.signature, `${path}.signature`, context, [
    'kind',
    'canonicalEnvelope',
    'signedComponents',
    'signatureEncoding',
    'timestampFormat',
    'signatureHeaderName',
    'timestampHeaderName',
    'idempotencyHeaderName'
  ])
  const signature = signatureSource
    ? webhookHmacEnvelope(signatureSource, `${path}.signature`, context)
    : undefined
  return destinationId &&
    name &&
    endpointCredentialRef &&
    method &&
    contentType &&
    maxPayloadBytes !== undefined &&
    signingCredentialRef &&
    signature
    ? {
        id: destinationId,
        name,
        endpointCredentialRef,
        method,
        contentType,
        maxPayloadBytes,
        signingCredentialRef,
        signature
      }
    : undefined
}

function realtimeEvents(
  value: unknown,
  path: string,
  context: BackendValidationContext
): ('insert' | 'update' | 'delete')[] | undefined {
  const events = parseArrayItems(value, path, context, 3, (entry, entryPath, entryContext) =>
    oneOf(entry, entryPath, entryContext, ['insert', 'update', 'delete'])
  )
  if (!events) return undefined
  uniqueBy(events, path, context, 'data-change event')
  if (events.length > 0) return [...events].sort()
  context.diagnostics.push({
    code: 'backend-automation-events-empty',
    severity: 'error',
    path,
    message: 'A data-change trigger requires at least one event.'
  })
  return undefined
}

const WEBHOOK_SIGNED_COMPONENTS = [
  'method',
  'path',
  'timestamp',
  'idempotency-key',
  'raw-body-sha256'
] as const

function webhookHmacEnvelope(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): BackendWebhookHmacEnvelopeIR | undefined {
  const kind = oneOf(source.kind, `${path}.kind`, context, ['hmac-sha256'])
  const canonicalEnvelope = oneOf(source.canonicalEnvelope, `${path}.canonicalEnvelope`, context, [
    'raw-body-v1'
  ])
  const components = parseArrayItems(
    source.signedComponents,
    `${path}.signedComponents`,
    context,
    5,
    (entry, entryPath, entryContext) =>
      oneOf(entry, entryPath, entryContext, [
        'method',
        'path',
        'timestamp',
        'idempotency-key',
        'raw-body-sha256'
      ])
  )
  const exactComponents = WEBHOOK_SIGNED_COMPONENTS.every(
    (entry, index) => components?.[index] === entry
  )
  if (!exactComponents) {
    context.diagnostics.push({
      code: 'backend-webhook-signature-envelope-invalid',
      severity: 'error',
      path: `${path}.signedComponents`,
      message:
        'The raw-body-v1 signature must bind method, path, timestamp, idempotency-key, and the raw body digest in canonical order.'
    })
  }
  const signatureHeaderName = oneOf(
    source.signatureHeaderName,
    `${path}.signatureHeaderName`,
    context,
    ['X-OpenPencil-Signature']
  )
  const signatureEncoding = oneOf(source.signatureEncoding, `${path}.signatureEncoding`, context, [
    'lowercase-hex'
  ])
  const timestampFormat = oneOf(source.timestampFormat, `${path}.timestampFormat`, context, [
    'unix-seconds'
  ])
  const timestampHeaderName = oneOf(
    source.timestampHeaderName,
    `${path}.timestampHeaderName`,
    context,
    ['X-OpenPencil-Timestamp']
  )
  const idempotencyHeaderName = oneOf(
    source.idempotencyHeaderName,
    `${path}.idempotencyHeaderName`,
    context,
    ['Idempotency-Key']
  )
  return kind &&
    canonicalEnvelope &&
    exactComponents &&
    signatureEncoding &&
    timestampFormat &&
    signatureHeaderName &&
    timestampHeaderName &&
    idempotencyHeaderName
    ? {
        kind,
        canonicalEnvelope,
        signedComponents: [...WEBHOOK_SIGNED_COMPONENTS],
        signatureEncoding,
        timestampFormat,
        signatureHeaderName,
        timestampHeaderName,
        idempotencyHeaderName
      }
    : undefined
}

function webhookSignature(
  value: unknown,
  path: string,
  context: BackendValidationContext
): Extract<BackendAutomationTriggerIR, { kind: 'webhook' }>['signature'] | undefined {
  const source = record(value, path, context, [
    'kind',
    'credentialRef',
    'canonicalEnvelope',
    'signedComponents',
    'signatureEncoding',
    'timestampFormat',
    'signatureHeaderName',
    'timestampHeaderName',
    'idempotencyHeaderName',
    'maxAgeSeconds'
  ])
  if (!source) return undefined
  const envelope = webhookHmacEnvelope(source, path, context)
  const credentialRef = credentialReference(source.credentialRef, `${path}.credentialRef`, context)
  const maxAgeSeconds = integerBetween(
    source.maxAgeSeconds,
    `${path}.maxAgeSeconds`,
    context,
    30,
    900
  )
  return envelope && credentialRef && maxAgeSeconds !== undefined
    ? { ...envelope, credentialRef, maxAgeSeconds }
    : undefined
}

function validCronInteger(value: string, minimum: number, maximum: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
}

function validCronSegment(segment: string, minimum: number, maximum: number): boolean {
  const parts = segment.split('/')
  const base = parts[0]
  const step = parts.at(1)
  if (!base || parts.length > 2) return false
  if (step !== undefined && !validCronInteger(step, 1, maximum - minimum + 1)) {
    return false
  }
  if (base === '*') return true
  const range = base.split('-')
  if (range.length === 1) return step === undefined && validCronInteger(base, minimum, maximum)
  if (range.length !== 2) return false
  const [start, end] = range
  return (
    Boolean(start && end) &&
    validCronInteger(start, minimum, maximum) &&
    validCronInteger(end, minimum, maximum) &&
    Number(start) <= Number(end)
  )
}

function validCronField(field: string, minimum: number, maximum: number): boolean {
  const segments = field.split(',')
  return (
    segments.length > 0 &&
    segments.length <= maximum - minimum + 1 &&
    segments.every((segment) => validCronSegment(segment, minimum, maximum))
  )
}

function validCron(cron: string): boolean {
  if (!/^\S+(?: \S+){4}$/u.test(cron)) return false
  const fields = cron.split(' ')
  return (
    validCronField(fields[0], 0, 59) &&
    validCronField(fields[1], 0, 23) &&
    validCronField(fields[2], 1, 31) &&
    validCronField(fields[3], 1, 12) &&
    validCronField(fields[4], 0, 6)
  )
}

// oxlint-disable-next-line complexity -- Trigger variants are closed and normalized in one dispatch.
function trigger(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationTriggerIR | undefined {
  const parsed = discriminatedRecord(value, path, context, TRIGGER_SHAPES)
  if (!parsed) return undefined
  const { kind, source } = parsed
  if (kind === 'schedule') {
    const cron = boundedText(source.cron, `${path}.cron`, context, 128)
    const timezone = oneOf(source.timezone, `${path}.timezone`, context, ['UTC'])
    if (cron && !validCron(cron)) {
      context.diagnostics.push({
        code: 'backend-automation-cron-invalid',
        severity: 'error',
        path: `${path}.cron`,
        message: 'Schedule cron must use the bounded five-field provider-neutral subset.'
      })
    }
    return cron && validCron(cron) && timezone ? { kind, cron, timezone } : undefined
  }
  if (kind === 'queue') {
    const queueId = id(source.queueId, `${path}.queueId`, context)
    return queueId ? { kind, queueId } : undefined
  }
  if (kind === 'webhook') {
    const method = oneOf(source.method, `${path}.method`, context, ['POST'])
    const webhookPath = boundedText(source.path, `${path}.path`, context, 128)
    if (
      webhookPath &&
      (!/^\/[A-Za-z0-9/_-]{1,127}$/u.test(webhookPath) || webhookPath.includes('..'))
    ) {
      context.diagnostics.push({
        code: 'backend-automation-webhook-path-invalid',
        severity: 'error',
        path: `${path}.path`,
        message: 'Webhook path must be an absolute bounded path without traversal segments.'
      })
    }
    const signature = webhookSignature(source.signature, `${path}.signature`, context)
    return method &&
      webhookPath &&
      /^\/[A-Za-z0-9/_-]{1,127}$/u.test(webhookPath) &&
      !webhookPath.includes('..') &&
      signature
      ? { kind, method, path: webhookPath, signature }
      : undefined
  }
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const events = realtimeEvents(source.events, `${path}.events`, context)
  return entityId && events ? { kind, entityId, events } : undefined
}

function parameterSource(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationParameterSourceIR | undefined {
  const parsed = discriminatedRecord(value, path, context, PARAMETER_SOURCE_SHAPES)
  if (!parsed) return undefined
  if (parsed.kind === 'literal') {
    const parsedLiteral = literal(parsed.source.value, `${path}.value`, context)
    return parsedLiteral !== undefined || parsed.source.value === null
      ? { kind: parsed.kind, value: parsedLiteral ?? null }
      : undefined
  }
  const fieldPath = boundedText(parsed.source.path, `${path}.path`, context, 256)
  if (fieldPath && !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/u.test(fieldPath)) {
    context.diagnostics.push({
      code: 'backend-automation-event-path-invalid',
      severity: 'error',
      path: `${path}.path`,
      message: 'Event field paths must use at most eight bounded identifier segments.'
    })
  }
  return fieldPath && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}$/u.test(fieldPath)
    ? { kind: parsed.kind, path: fieldPath }
    : undefined
}

function parameterMapping(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationParameterMappingIR | undefined {
  const source = record(value, path, context, ['parameter', 'source'])
  if (!source) return undefined
  const parameterName = id(source.parameter, `${path}.parameter`, context)
  const parsedSource = parameterSource(source.source, `${path}.source`, context)
  return parameterName && parsedSource
    ? { parameter: parameterName, source: parsedSource }
    : undefined
}

function parameterMappings(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationParameterMappingIR[] | undefined {
  const mappings = parseArrayItems(value, path, context, 128, parameterMapping)
  if (mappings) {
    uniqueBy(
      mappings.map((entry) => entry.parameter),
      path,
      context,
      'automation parameter mapping'
    )
  }
  return mappings
}

// oxlint-disable-next-line complexity -- Action variants are closed and normalized in one dispatch.
function action(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationActionIR | undefined {
  const parsed = discriminatedRecord(value, path, context, ACTION_SHAPES)
  if (!parsed) return undefined
  const { kind, source } = parsed
  if (kind === 'workflow') {
    const workflowId = id(source.workflowId, `${path}.workflowId`, context)
    const parameters = parameterMappings(source.parameters, `${path}.parameters`, context)
    return workflowId && parameters ? { kind, workflowId, parameters } : undefined
  }
  if (kind === 'transaction') {
    const transactionId = id(source.transactionId, `${path}.transactionId`, context)
    const parameters = parameterMappings(source.parameters, `${path}.parameters`, context)
    return transactionId && parameters ? { kind, transactionId, parameters } : undefined
  }
  if (kind === 'queue.publish') {
    const queueId = id(source.queueId, `${path}.queueId`, context)
    const payloadExpression = boundedText(
      source.payloadExpression,
      `${path}.payloadExpression`,
      context
    )
    if (payloadExpression && !parseExpression(payloadExpression).ok) {
      context.diagnostics.push({
        code: 'backend-automation-expression-invalid',
        severity: 'error',
        path: `${path}.payloadExpression`,
        message: 'Queue payload expression is invalid.'
      })
    }
    return queueId && payloadExpression && parseExpression(payloadExpression).ok
      ? { kind, queueId, payloadExpression }
      : undefined
  }
  if (kind === 'webhook.deliver') {
    const destinationId = id(source.destinationId, `${path}.destinationId`, context)
    const payloadExpression = boundedText(
      source.payloadExpression,
      `${path}.payloadExpression`,
      context
    )
    if (payloadExpression && !parseExpression(payloadExpression).ok) {
      context.diagnostics.push({
        code: 'backend-automation-expression-invalid',
        severity: 'error',
        path: `${path}.payloadExpression`,
        message: 'Webhook payload expression is invalid.'
      })
    }
    return destinationId && payloadExpression && parseExpression(payloadExpression).ok
      ? { kind, destinationId, payloadExpression }
      : undefined
  }
  const scope = oneOf(source.scope, `${path}.scope`, context, ['declared-schema'])
  const mode = oneOf(source.mode, `${path}.mode`, context, ['read-only'])
  return scope && mode ? { kind, scope, mode } : undefined
}

function retry(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationRetryIR | undefined {
  const source = record(
    value,
    path,
    context,
    ['maxAttempts', 'initialDelayMs', 'maxDelayMs', 'backoff', 'jitter', 'deadLetterQueueId'],
    ['maxAttempts', 'initialDelayMs', 'maxDelayMs', 'backoff', 'jitter']
  )
  if (!source) return undefined
  const maxAttempts = integerBetween(source.maxAttempts, `${path}.maxAttempts`, context, 1, 20)
  const initialDelayMs = integerBetween(
    source.initialDelayMs,
    `${path}.initialDelayMs`,
    context,
    100,
    60_000
  )
  const maxDelayMs = integerBetween(
    source.maxDelayMs,
    `${path}.maxDelayMs`,
    context,
    100,
    86_400_000
  )
  if (initialDelayMs !== undefined && maxDelayMs !== undefined && maxDelayMs < initialDelayMs) {
    context.diagnostics.push({
      code: 'backend-automation-retry-delay-invalid',
      severity: 'error',
      path: `${path}.maxDelayMs`,
      message: 'Maximum retry delay cannot be smaller than the initial delay.'
    })
  }
  const backoff = oneOf(source.backoff, `${path}.backoff`, context, ['fixed', 'exponential'])
  const jitter = oneOf(source.jitter, `${path}.jitter`, context, ['none', 'full'])
  const deadLetterQueueId =
    source.deadLetterQueueId === undefined
      ? undefined
      : id(source.deadLetterQueueId, `${path}.deadLetterQueueId`, context)
  return maxAttempts !== undefined &&
    initialDelayMs !== undefined &&
    maxDelayMs !== undefined &&
    maxDelayMs >= initialDelayMs &&
    backoff &&
    jitter
    ? {
        maxAttempts,
        initialDelayMs,
        maxDelayMs,
        backoff,
        jitter,
        ...(deadLetterQueueId ? { deadLetterQueueId } : {})
      }
    : undefined
}

function idempotency(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationIdempotencyIR | undefined {
  const parsed = discriminatedRecord(value, path, context, IDEMPOTENCY_SHAPES)
  if (!parsed) return undefined
  const retentionHours = integerBetween(
    parsed.source.retentionHours,
    `${path}.retentionHours`,
    context,
    1,
    2_160
  )
  if (retentionHours === undefined) return undefined
  if (parsed.kind === 'event-id') return { kind: parsed.kind, retentionHours }
  if (parsed.kind === 'request-header') {
    if (parsed.source.headerName !== 'Idempotency-Key') {
      context.diagnostics.push({
        code: 'backend-automation-idempotency-header-invalid',
        severity: 'error',
        path: `${path}.headerName`,
        message: 'The provider-neutral webhook idempotency header is fixed to Idempotency-Key.'
      })
      return undefined
    }
    return { kind: parsed.kind, headerName: 'Idempotency-Key', retentionHours }
  }
  const entityId = id(parsed.source.entityId, `${path}.entityId`, context)
  const fieldId = id(parsed.source.fieldId, `${path}.fieldId`, context)
  return entityId && fieldId ? { kind: parsed.kind, entityId, fieldId, retentionHours } : undefined
}

function causation(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationDefinitionIR['causation'] | undefined {
  const source = record(value, path, context, ['kind', 'idField', 'maxHop'])
  if (!source) return undefined
  const kind = oneOf(source.kind, `${path}.kind`, context, ['required'])
  const idField = oneOf(source.idField, `${path}.idField`, context, ['causationId'])
  const maxHop = integerBetween(source.maxHop, `${path}.maxHop`, context, 1, 16)
  return kind && idField && maxHop !== undefined ? { kind, idField, maxHop } : undefined
}

function automationDefinition(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendAutomationDefinitionIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'subject',
    'trigger',
    'action',
    'retry',
    'idempotency',
    'causation'
  ])
  if (!source) return undefined
  const automationId = id(source.id, `${path}.id`, context)
  const name = boundedText(source.name, `${path}.name`, context, 128)
  const subject = oneOf(source.subject, `${path}.subject`, context, ['caller-user', 'system'])
  const parsedTrigger = trigger(source.trigger, `${path}.trigger`, context)
  const parsedAction = action(source.action, `${path}.action`, context)
  const parsedRetry = retry(source.retry, `${path}.retry`, context)
  const parsedIdempotency = idempotency(source.idempotency, `${path}.idempotency`, context)
  const parsedCausation = causation(source.causation, `${path}.causation`, context)
  if (subject === 'caller-user') {
    context.diagnostics.push({
      code: 'backend-automation-subject-invalid',
      severity: 'error',
      path: `${path}.subject`,
      message: 'P2 automation triggers have no trusted caller and must use system authority.'
    })
  }
  let expectedIdempotencyKind: BackendAutomationIdempotencyIR['kind'] | undefined
  if (parsedTrigger?.kind === 'webhook') expectedIdempotencyKind = 'request-header'
  else if (parsedTrigger?.kind === 'data-change') expectedIdempotencyKind = 'data-field'
  else if (parsedTrigger) expectedIdempotencyKind = 'event-id'
  if (
    parsedIdempotency &&
    expectedIdempotencyKind &&
    parsedIdempotency.kind !== expectedIdempotencyKind
  ) {
    context.diagnostics.push({
      code: 'backend-automation-idempotency-trigger-invalid',
      severity: 'error',
      path: `${path}.idempotency`,
      message:
        'Idempotency sources are fixed by trigger: schedule/queue use event-id, webhook uses request-header, and data-change uses data-field.'
    })
  }
  return automationId &&
    name &&
    subject &&
    parsedTrigger &&
    parsedAction &&
    parsedRetry &&
    parsedIdempotency &&
    parsedCausation
    ? {
        id: automationId,
        name,
        subject,
        trigger: parsedTrigger,
        action: parsedAction,
        retry: parsedRetry,
        idempotency: parsedIdempotency,
        causation: parsedCausation
      }
    : undefined
}

function telemetry(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendOperationalTelemetryIR | undefined {
  const source = record(value, path, context, ['logs', 'metrics', 'traces', 'auditEvents'])
  if (!source) return undefined
  const logs = boolean(source.logs, `${path}.logs`, context)
  const metrics = boolean(source.metrics, `${path}.metrics`, context)
  const traces = boolean(source.traces, `${path}.traces`, context)
  const auditEvents = boolean(source.auditEvents, `${path}.auditEvents`, context)
  return logs !== undefined &&
    metrics !== undefined &&
    traces !== undefined &&
    auditEvents !== undefined
    ? { logs, metrics, traces, auditEvents }
    : undefined
}

function driftDetection(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendDriftDetectionIR | undefined {
  const source = record(value, path, context, ['enabled', 'scheduleAutomationId'], ['enabled'])
  if (!source) return undefined
  const enabled = boolean(source.enabled, `${path}.enabled`, context)
  const scheduleAutomationId =
    source.scheduleAutomationId === undefined
      ? undefined
      : id(source.scheduleAutomationId, `${path}.scheduleAutomationId`, context)
  if (enabled === true && !scheduleAutomationId) {
    context.diagnostics.push({
      code: 'backend-drift-schedule-required',
      severity: 'error',
      path: `${path}.scheduleAutomationId`,
      message: 'Enabled drift detection requires a schedule automation.'
    })
  }
  if (enabled === false && source.scheduleAutomationId !== undefined) {
    context.diagnostics.push({
      code: 'backend-drift-schedule-forbidden',
      severity: 'error',
      path: `${path}.scheduleAutomationId`,
      message: 'Disabled drift detection cannot retain a schedule automation reference.'
    })
  }
  if (enabled === true && scheduleAutomationId) return { enabled, scheduleAutomationId }
  return enabled === false ? { enabled } : undefined
}

function declaredCredentialRefs(secrets: readonly BackendSecretRef[]): ReadonlySet<string> {
  return new Set(
    secrets
      .filter(
        (secret): secret is Extract<BackendSecretRef, { kind: 'credential' }> =>
          secret.kind === 'credential' && secret.exposure === 'server' && secret.required
      )
      .map((secret) => secret.credentialRef)
  )
}

function validateCredentialDeclaration(
  credentialRef: string,
  path: string,
  declared: ReadonlySet<string>,
  context: BackendValidationContext
): void {
  if (declared.has(credentialRef)) return
  context.diagnostics.push({
    code: 'backend-automation-credential-undeclared',
    severity: 'error',
    path,
    message:
      'Webhook HMAC credentials must be declared as required server-scoped credential secrets; release evidence must also verify a dedicated webhook-hmac purpose.'
  })
}

function validateParameterMappings(
  mappings: readonly BackendAutomationParameterMappingIR[],
  expected: readonly string[],
  required: ReadonlySet<string>,
  path: string,
  context: BackendValidationContext
): void {
  const actual = new Set(mappings.map((entry) => entry.parameter))
  for (const parameter of expected) {
    if (!required.has(parameter) || actual.has(parameter)) continue
    context.diagnostics.push({
      code: 'backend-automation-parameter-mapping-missing',
      severity: 'error',
      path,
      message: 'Every required target parameter needs one explicit event or literal mapping.'
    })
  }
  for (const parameter of actual) {
    if (expected.includes(parameter)) continue
    context.diagnostics.push({
      code: 'backend-automation-parameter-mapping-unknown',
      severity: 'error',
      path,
      message: 'Automation parameter mappings cannot target undeclared parameters.'
    })
  }
}

function retryWindowSeconds(retry: BackendAutomationRetryIR): number {
  let delay = retry.initialDelayMs
  let total = 0
  for (let attempt = 1; attempt < retry.maxAttempts; attempt++) {
    total += Math.min(delay, retry.maxDelayMs)
    if (retry.backoff === 'exponential') delay = Math.min(delay * 2, retry.maxDelayMs)
  }
  return Math.ceil(total / 1_000)
}

function workflowMutatesField(
  workflows: BackendWorkflowIR,
  entityId: string,
  fieldId: string
): boolean {
  const walk = (steps: BackendWorkflowIR['workflows'][number]['steps']): boolean =>
    steps.some((step) => {
      if (step.kind === 'branch') return walk(step.consequent) || walk(step.alternate)
      return (
        step.kind === 'data.mutate' &&
        step.entityId === entityId &&
        (step.operation === 'update' || step.operation === 'upsert') &&
        Boolean(step.values?.some((entry) => entry.field === fieldId))
      )
    })
  return workflows.workflows.some((workflow) => walk(workflow.steps))
}

function transactionMutatesField(
  transactions: BackendTransactionIRV1,
  entityId: string,
  fieldId: string
): boolean {
  return transactions.transactions.some((transaction) =>
    transaction.steps.some(
      (step) =>
        step.kind === 'data.mutate' &&
        step.entityId === entityId &&
        (step.operation === 'update' || step.operation === 'upsert') &&
        Boolean(
          step.values?.some((entry) => entry.field === fieldId) ||
          step.increments?.some((entry) => entry.field === fieldId)
        )
    )
  )
}

// oxlint-disable-next-line complexity -- Cross-section automation references fail closed together.
function validateAutomationReferences(
  automation: BackendAutomationDefinitionIR,
  queues: ReadonlyMap<string, BackendQueueIR>,
  destinations: ReadonlyMap<string, BackendWebhookDestinationIR>,
  workflows: BackendWorkflowIR,
  transactions: BackendTransactionIRV1,
  model: DataModelIR,
  credentialRefs: ReadonlySet<string>,
  context: BackendValidationContext
): void {
  const path = `$.automations.automations.${automation.id}`
  const trigger = automation.trigger
  const action = automation.action
  if (trigger.kind === 'queue' && !queues.has(trigger.queueId)) {
    context.diagnostics.push({
      code: 'backend-automation-queue-missing',
      severity: 'error',
      path: `${path}.trigger.queueId`,
      message: 'Queue triggers must reference a declared private queue.'
    })
  }
  if (trigger.kind === 'webhook') {
    validateCredentialDeclaration(
      trigger.signature.credentialRef,
      `${path}.trigger.signature.credentialRef`,
      credentialRefs,
      context
    )
  }
  if (trigger.kind === 'data-change') {
    referencedEntity(trigger.entityId, `${path}.trigger.entityId`, model, context)
  }
  if (
    action.kind === 'workflow' &&
    !workflows.workflows.some((entry) => entry.id === action.workflowId)
  ) {
    context.diagnostics.push({
      code: 'backend-automation-workflow-missing',
      severity: 'error',
      path: `${path}.action.workflowId`,
      message: 'Automation actions must reference a declared workflow.'
    })
  }
  if (action.kind === 'workflow') {
    const workflow = workflows.workflows.find((entry) => entry.id === action.workflowId)
    if (workflow) {
      validateParameterMappings(
        action.parameters,
        workflow.parameters,
        new Set(workflow.parameters),
        `${path}.action.parameters`,
        context
      )
    }
    context.diagnostics.push({
      code: 'backend-automation-authority-incompatible',
      severity: 'error',
      path: `${path}.action`,
      message: 'System automations cannot invoke caller-authenticated V1 workflows.'
    })
  }
  if (
    action.kind === 'transaction' &&
    !transactions.transactions.some((entry) => entry.id === action.transactionId)
  ) {
    context.diagnostics.push({
      code: 'backend-automation-transaction-missing',
      severity: 'error',
      path: `${path}.action.transactionId`,
      message: 'Automation actions must reference a declared transaction.'
    })
  }
  if (action.kind === 'transaction') {
    const transaction = transactions.transactions.find((entry) => entry.id === action.transactionId)
    if (transaction) {
      validateParameterMappings(
        action.parameters,
        transaction.parameters.map((entry) => entry.name),
        new Set(
          transaction.parameters.filter((entry) => entry.required).map((entry) => entry.name)
        ),
        `${path}.action.parameters`,
        context
      )
    }
    context.diagnostics.push({
      code: 'backend-automation-authority-incompatible',
      severity: 'error',
      path: `${path}.action`,
      message: 'System automations cannot invoke caller-authenticated transactions.'
    })
  }
  if (action.kind === 'queue.publish' && !queues.has(action.queueId)) {
    context.diagnostics.push({
      code: 'backend-automation-queue-missing',
      severity: 'error',
      path: `${path}.action.queueId`,
      message: 'Queue publish actions must reference a declared private queue.'
    })
  }
  if (action.kind === 'webhook.deliver') {
    if (!destinations.has(action.destinationId)) {
      context.diagnostics.push({
        code: 'backend-webhook-destination-missing',
        severity: 'error',
        path: `${path}.action.destinationId`,
        message: 'Outbound webhooks must reference a pinned host-owned destination.'
      })
    }
  }
  if (action.kind === 'drift.detect' && trigger.kind !== 'schedule') {
    context.diagnostics.push({
      code: 'backend-drift-action-trigger-invalid',
      severity: 'error',
      path: `${path}.action`,
      message: 'Read-only drift detection may only run from a bounded schedule trigger.'
    })
  }
  const deadLetterQueueId = automation.retry.deadLetterQueueId
  if (deadLetterQueueId && !queues.has(deadLetterQueueId)) {
    context.diagnostics.push({
      code: 'backend-automation-dead-letter-queue-missing',
      severity: 'error',
      path: `${path}.retry.deadLetterQueueId`,
      message: 'Dead-letter queues must reference a declared private queue.'
    })
  }
  if (trigger.kind === 'queue' && deadLetterQueueId === trigger.queueId) {
    context.diagnostics.push({
      code: 'backend-automation-dead-letter-cycle',
      severity: 'error',
      path: `${path}.retry.deadLetterQueueId`,
      message: 'A queue consumer cannot use its input queue as its dead-letter queue.'
    })
  }
  if (automation.idempotency.kind === 'data-field') {
    const idempotencySpec = automation.idempotency
    if (trigger.kind !== 'data-change' || trigger.entityId !== idempotencySpec.entityId) {
      context.diagnostics.push({
        code: 'backend-automation-idempotency-entity-invalid',
        severity: 'error',
        path: `${path}.idempotency.entityId`,
        message:
          'data-field idempotency is valid only for a data-change trigger on the same entity.'
      })
    }
    if (
      trigger.kind === 'data-change' &&
      (trigger.events.length !== 1 || trigger.events[0] !== 'insert')
    ) {
      context.diagnostics.push({
        code: 'backend-automation-idempotency-event-unsafe',
        severity: 'error',
        path: `${path}.trigger.events`,
        message:
          'Primary-key idempotency is safe only for insert events; update and delete require a Provider-issued immutable event identifier.'
      })
    }
    const entity = referencedEntity(
      idempotencySpec.entityId,
      `${path}.idempotency.entityId`,
      model,
      context
    )
    validateFieldReference(entity, idempotencySpec.fieldId, `${path}.idempotency.fieldId`, context)
    const field = entity?.fields.find((entry) => entry.id === idempotencySpec.fieldId)
    const immutablePrimaryKey = Boolean(
      entity?.primaryKey?.fields.length === 1 &&
      entity.primaryKey.fields[0] === idempotencySpec.fieldId
    )
    if (
      !field ||
      field.nullable ||
      !immutablePrimaryKey ||
      workflowMutatesField(workflows, idempotencySpec.entityId, idempotencySpec.fieldId) ||
      transactionMutatesField(transactions, idempotencySpec.entityId, idempotencySpec.fieldId)
    ) {
      context.diagnostics.push({
        code: 'backend-automation-idempotency-field-unsafe',
        severity: 'error',
        path: `${path}.idempotency.fieldId`,
        message:
          'data-field idempotency requires a non-null single-field primary key immutable by declared runtimes and enforced by the Provider.'
      })
    }
  }
  const queueHorizon =
    trigger.kind === 'queue' ? (queues.get(trigger.queueId)?.retentionSeconds ?? 0) : 0
  const visibilityHorizon =
    trigger.kind === 'queue' ? (queues.get(trigger.queueId)?.visibilityTimeoutSeconds ?? 0) : 0
  const requiredRetentionSeconds =
    queueHorizon + visibilityHorizon + retryWindowSeconds(automation.retry)
  if (automation.idempotency.retentionHours * 3_600 < requiredRetentionSeconds) {
    context.diagnostics.push({
      code: 'backend-automation-idempotency-retention-short',
      severity: 'error',
      path: `${path}.idempotency.retentionHours`,
      message:
        'Idempotency retention must cover queue retention, visibility lease, and retry backoff.'
    })
  }
}

function validateDriftReference(
  drift: BackendDriftDetectionIR,
  automations: readonly BackendAutomationDefinitionIR[],
  context: BackendValidationContext
): void {
  const driftAutomations = automations.filter((entry) => entry.action.kind === 'drift.detect')
  if (!drift.enabled && driftAutomations.length === 0) return
  if (!drift.enabled) {
    context.diagnostics.push({
      code: 'backend-drift-action-disabled',
      severity: 'error',
      path: '$.automations.automations',
      message: 'Read-only drift actions are forbidden while drift detection is disabled.'
    })
    return
  }
  const automation = driftAutomations.find((entry) => entry.id === drift.scheduleAutomationId)
  if (
    driftAutomations.length === 1 &&
    automation?.trigger.kind === 'schedule' &&
    automation.action.kind === 'drift.detect'
  ) {
    return
  }
  context.diagnostics.push({
    code: 'backend-drift-schedule-invalid',
    severity: 'error',
    path: '$.automations.driftDetection.scheduleAutomationId',
    message:
      'Drift detection must reference the unique existing read-only drift schedule automation.'
  })
}

function validateAutomationGraph(
  automations: readonly BackendAutomationDefinitionIR[],
  context: BackendValidationContext
): void {
  const queueConsumers = new Map<string, BackendAutomationDefinitionIR>()
  const webhookRoutes: string[] = []
  const deadLetterQueues = new Set<string>()
  for (const automation of automations) {
    if (automation.retry.deadLetterQueueId) deadLetterQueues.add(automation.retry.deadLetterQueueId)
    if (automation.trigger.kind === 'webhook') {
      webhookRoutes.push(`${automation.trigger.method}:${automation.trigger.path.toLowerCase()}`)
    }
    if (automation.trigger.kind !== 'queue') continue
    if (queueConsumers.has(automation.trigger.queueId)) {
      context.diagnostics.push({
        code: 'backend-automation-queue-consumer-duplicate',
        severity: 'error',
        path: '$.automations.automations',
        message: 'A private queue may have only one declared consumer in this contract version.'
      })
    }
    queueConsumers.set(automation.trigger.queueId, automation)
  }
  uniqueBy(webhookRoutes, '$.automations.automations', context, 'webhook method/path')
  for (const queueId of deadLetterQueues) {
    if (!queueConsumers.has(queueId)) continue
    context.diagnostics.push({
      code: 'backend-automation-dead-letter-consumed',
      severity: 'error',
      path: '$.automations.automations',
      message:
        'Dead-letter queues are terminal evidence stores and cannot be consumed by automations.'
    })
  }
  const edges = new Map<string, string[]>()
  for (const automation of automations) {
    const consumer =
      automation.action.kind === 'queue.publish'
        ? queueConsumers.get(automation.action.queueId)
        : undefined
    edges.set(automation.id, consumer ? [consumer.id] : [])
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (automationId: string): boolean => {
    if (visiting.has(automationId)) return true
    if (visited.has(automationId)) return false
    visiting.add(automationId)
    const cyclic = (edges.get(automationId) ?? []).some(visit)
    visiting.delete(automationId)
    visited.add(automationId)
    return cyclic
  }
  if ([...edges.keys()].some(visit)) {
    context.diagnostics.push({
      code: 'backend-automation-causation-cycle',
      severity: 'error',
      path: '$.automations.automations',
      message:
        'Static queue action graphs must be acyclic in addition to runtime maxHop enforcement.'
    })
  }
}

export function parseBackendAutomationIRV1(
  value: unknown,
  path: string,
  model: DataModelIR,
  workflows: BackendWorkflowIR,
  transactions: BackendTransactionIRV1,
  secrets: readonly BackendSecretRef[],
  context: BackendValidationContext
): BackendAutomationIRV1 | undefined {
  const source = record(value, path, context, [
    'version',
    'queues',
    'webhookDestinations',
    'automations',
    'telemetry',
    'driftDetection'
  ])
  if (!source) return undefined
  if (source.version !== BACKEND_AUTOMATION_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-automation-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Automation IR version is not supported.'
    })
  }
  const queues = parseArrayItems(source.queues, `${path}.queues`, context, MAX_QUEUES, queue)
  const webhookDestinations = parseArrayItems(
    source.webhookDestinations,
    `${path}.webhookDestinations`,
    context,
    MAX_WEBHOOK_DESTINATIONS,
    webhookDestination
  )
  const automations = parseArrayItems(
    source.automations,
    `${path}.automations`,
    context,
    MAX_AUTOMATIONS,
    automationDefinition
  )
  const parsedTelemetry = telemetry(source.telemetry, `${path}.telemetry`, context)
  const parsedDriftDetection = driftDetection(
    source.driftDetection,
    `${path}.driftDetection`,
    context
  )
  if (queues)
    uniqueBy(
      queues.map((entry) => entry.id),
      `${path}.queues`,
      context,
      'queue id'
    )
  if (automations) {
    uniqueBy(
      automations.map((entry) => entry.id),
      `${path}.automations`,
      context,
      'automation id'
    )
  }
  if (webhookDestinations) {
    uniqueBy(
      webhookDestinations.map((entry) => entry.id),
      `${path}.webhookDestinations`,
      context,
      'webhook destination id'
    )
  }
  if (queues && webhookDestinations && automations) {
    const queueMap = new Map(queues.map((entry) => [entry.id, entry]))
    const destinationMap = new Map(webhookDestinations.map((entry) => [entry.id, entry]))
    const credentialRefs = declaredCredentialRefs(secrets)
    for (const [index, destination] of webhookDestinations.entries()) {
      validateCredentialDeclaration(
        destination.endpointCredentialRef,
        `${path}.webhookDestinations[${index}].endpointCredentialRef`,
        credentialRefs,
        context
      )
      validateCredentialDeclaration(
        destination.signingCredentialRef,
        `${path}.webhookDestinations[${index}].signingCredentialRef`,
        credentialRefs,
        context
      )
    }
    const credentialUses = [
      ...webhookDestinations.map((destination) => destination.endpointCredentialRef),
      ...webhookDestinations.map((destination) => destination.signingCredentialRef),
      ...automations.flatMap((automation) =>
        automation.trigger.kind === 'webhook' ? [automation.trigger.signature.credentialRef] : []
      )
    ]
    if (new Set(credentialUses).size !== credentialUses.length) {
      context.diagnostics.push({
        code: 'backend-automation-credential-reused',
        severity: 'error',
        path: `${path}.webhookDestinations`,
        message:
          'Each inbound HMAC, outbound endpoint, and outbound HMAC purpose requires a dedicated credential.'
      })
    }
    for (const automation of automations) {
      validateAutomationReferences(
        automation,
        queueMap,
        destinationMap,
        workflows,
        transactions,
        model,
        credentialRefs,
        context
      )
    }
    validateAutomationGraph(automations, context)
  }
  if (parsedDriftDetection && automations) {
    validateDriftReference(parsedDriftDetection, automations, context)
  }
  return source.version === BACKEND_AUTOMATION_IR_VERSION &&
    queues &&
    webhookDestinations &&
    automations &&
    parsedTelemetry &&
    parsedDriftDetection
    ? {
        version: BACKEND_AUTOMATION_IR_VERSION,
        queues: sorted(queues, (entry) => entry.id),
        webhookDestinations: sorted(webhookDestinations, (entry) => entry.id),
        automations: sorted(automations, (entry) => entry.id),
        telemetry: parsedTelemetry,
        driftDetection: parsedDriftDetection
      }
    : undefined
}
