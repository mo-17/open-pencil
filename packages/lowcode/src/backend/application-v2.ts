import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import { parseBackendAutomationIRV1 } from './application-v2-automations'
import { parseBackendDataMigrationIRV1 } from './application-v2-data-migrations'
import { parseBackendRealtimeIRV1 } from './application-v2-realtime'
import { parseBackendTransactionIRV1 } from './application-v2-transactions'
import {
  BACKEND_APPLICATION_SPEC_V2_VERSION,
  BACKEND_AUTOMATION_IR_VERSION,
  BACKEND_DATA_MIGRATION_IR_VERSION,
  BACKEND_REALTIME_IR_VERSION,
  BACKEND_TRANSACTION_IR_VERSION,
  type BackendApplicationSpecV2,
  type BackendCapabilityRequirementV2,
  type BackendCapabilityV2
} from './application-v2-types'
import { deriveBackendApplicationCapabilities } from './capability-derivation'
import { BACKEND_LIMITS } from './limits'
import { assertBackendSecretFreeData } from './secret-boundary'
import type {
  BackendApplicationSpecV1,
  BackendCapability,
  BackendDiagnostic,
  BackendValidationResult
} from './types'
import { parseBackendApplicationSpecV1, BACKEND_CAPABILITIES } from './validate'
import {
  array,
  assertBoundedBackendData,
  boolean,
  boundedText,
  id,
  oneOf,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

const BACKEND_CAPABILITIES_V2_ADDITIONS = [
  'migrations.backfill',
  'events.data-change',
  'jobs.schedule',
  'queues.publish',
  'queues.consume',
  'webhooks.receive',
  'webhooks.deliver',
  'workflows.idempotency',
  'workflows.retry',
  'workflows.durable-execution',
  'observability.logs',
  'observability.metrics',
  'observability.traces',
  'audit.events',
  'drift.detect'
] as const

export const BACKEND_CAPABILITIES_V2: readonly BackendCapabilityV2[] = Object.freeze([
  ...BACKEND_CAPABILITIES,
  ...BACKEND_CAPABILITIES_V2_ADDITIONS
])

function deepFreezeBackendValue<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreezeBackendValue(descriptor.value, visited)
    }
  }
  return Object.freeze(value)
}

function invalidBackendV2Message(codes: readonly string[]): string {
  return `Backend V2 contract validation failed: ${codes.join(', ')}`
}

function isSafeInput(value: unknown, context: BackendValidationContext): boolean {
  if (!assertBoundedBackendData(value, context)) return false
  return assertBackendSecretFreeData(value, context)
}

function capabilityRequirement(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCapabilityRequirementV2 | undefined {
  const source = record(
    value,
    path,
    context,
    ['capability', 'required', 'reason'],
    ['capability', 'required']
  )
  if (!source) return undefined
  const capability = oneOf(
    source.capability,
    `${path}.capability`,
    context,
    BACKEND_CAPABILITIES_V2
  )
  const required = boolean(source.required, `${path}.required`, context)
  const reason =
    source.reason === undefined
      ? undefined
      : boundedText(source.reason, `${path}.reason`, context, BACKEND_LIMITS.maxReasonLength)
  return capability && required !== undefined
    ? { capability, required, ...(reason ? { reason } : {}) }
    : undefined
}

function legacyCommonInput(source: Readonly<Record<string, unknown>>): unknown {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: source.applicationId,
    dataModel: source.dataModel,
    auth: source.auth,
    workflows: source.workflows,
    ...(source.storage === undefined ? {} : { storage: source.storage }),
    capabilities: [],
    secrets: source.secrets
  }
}

function commonV1(application: BackendApplicationSpecV2): BackendApplicationSpecV1 {
  return {
    format: application.format,
    version: 1,
    applicationId: application.applicationId,
    dataModel: application.dataModel,
    auth: application.auth,
    workflows: application.workflows,
    ...(application.storage ? { storage: application.storage } : {}),
    capabilities: application.capabilities.filter(
      (entry): entry is BackendCapabilityRequirementV2 & { capability: BackendCapability } =>
        BACKEND_CAPABILITIES.includes(entry.capability as BackendCapability)
    ),
    secrets: application.secrets
  }
}

/**
 * Parse the first extensible Backend application contract. It deliberately delegates all V1
 * semantics to the existing authority, then validates new sections without provider dialect data.
 */
// oxlint-disable-next-line complexity -- All section authorities must succeed before normalization.
export function parseBackendApplicationSpecV2(
  value: unknown
): BackendValidationResult<BackendApplicationSpecV2> {
  const context: BackendValidationContext = { diagnostics: [] }
  if (!isSafeInput(value, context)) return { ok: false, diagnostics: context.diagnostics }
  const source = record(
    value,
    '$',
    context,
    [
      'format',
      'version',
      'applicationId',
      'dataModel',
      'auth',
      'workflows',
      'storage',
      'realtime',
      'transactions',
      'dataMigrations',
      'automations',
      'capabilities',
      'secrets'
    ],
    [
      'format',
      'version',
      'applicationId',
      'dataModel',
      'auth',
      'workflows',
      'realtime',
      'transactions',
      'dataMigrations',
      'automations',
      'capabilities',
      'secrets'
    ]
  )
  if (!source) return { ok: false, diagnostics: context.diagnostics }
  if (source.format !== 'openpencil.backend-application') {
    context.diagnostics.push({
      code: 'backend-format-unsupported',
      severity: 'error',
      path: '$.format',
      message: 'Backend application format is not supported.'
    })
  }
  if (source.version !== BACKEND_APPLICATION_SPEC_V2_VERSION) {
    context.diagnostics.push({
      code: 'backend-version-unsupported',
      severity: 'error',
      path: '$.version',
      message: 'Backend application version is not supported.'
    })
  }
  const applicationId = id(source.applicationId, '$.applicationId', context)
  const common = parseBackendApplicationSpecV1(legacyCommonInput(source))
  if (!common.ok) {
    context.diagnostics.push(...common.diagnostics)
    return { ok: false, diagnostics: context.diagnostics }
  }
  context.diagnostics.push(...common.diagnostics)
  const rawCapabilities = array(
    source.capabilities,
    '$.capabilities',
    context,
    BACKEND_LIMITS.maxCapabilities
  )
  const capabilities = (rawCapabilities ?? [])
    .map((entry, index) => capabilityRequirement(entry, `$.capabilities[${index}]`, context))
    .filter((entry): entry is BackendCapabilityRequirementV2 => entry !== undefined)
  uniqueBy(
    capabilities.map((entry) => entry.capability),
    '$.capabilities',
    context,
    'capability requirement'
  )
  const realtime = parseBackendRealtimeIRV1(
    source.realtime,
    '$.realtime',
    common.value.dataModel,
    common.value.auth,
    context
  )
  const transactions = parseBackendTransactionIRV1(
    source.transactions,
    '$.transactions',
    common.value.dataModel,
    common.value.auth,
    context
  )
  const dataMigrations = transactions
    ? parseBackendDataMigrationIRV1(
        source.dataMigrations,
        '$.dataMigrations',
        common.value.dataModel,
        common.value.auth,
        common.value.workflows,
        transactions,
        context
      )
    : undefined
  const automations = transactions
    ? parseBackendAutomationIRV1(
        source.automations,
        '$.automations',
        common.value.dataModel,
        common.value.workflows,
        transactions,
        common.value.secrets,
        context
      )
    : undefined
  if (
    source.format !== 'openpencil.backend-application' ||
    source.version !== BACKEND_APPLICATION_SPEC_V2_VERSION ||
    !applicationId ||
    !rawCapabilities ||
    rawCapabilities.length !== capabilities.length ||
    !realtime ||
    !transactions ||
    !dataMigrations ||
    !automations ||
    context.diagnostics.some((entry) => entry.severity === 'error')
  ) {
    return { ok: false, diagnostics: context.diagnostics }
  }
  const normalized: BackendApplicationSpecV2 = {
    format: 'openpencil.backend-application',
    version: BACKEND_APPLICATION_SPEC_V2_VERSION,
    applicationId,
    dataModel: common.value.dataModel,
    auth: common.value.auth,
    workflows: common.value.workflows,
    ...(common.value.storage ? { storage: common.value.storage } : {}),
    realtime,
    transactions,
    dataMigrations,
    automations,
    capabilities: sorted(capabilities, (entry) => entry.capability),
    secrets: common.value.secrets
  }
  context.diagnostics.push(...validateBackendCapabilityDeclarationsV2(normalized))
  if (context.diagnostics.some((entry) => entry.severity === 'error')) {
    return { ok: false, diagnostics: context.diagnostics }
  }
  return {
    ok: true,
    value: deepFreezeBackendValue(normalized),
    diagnostics: context.diagnostics
  }
}

export function lowerBackendApplicationSpecV1ToV2(
  value: unknown
): BackendValidationResult<BackendApplicationSpecV2> {
  const parsed = parseBackendApplicationSpecV1(value)
  if (!parsed.ok) return parsed
  const declarations = new Map(
    parsed.value.capabilities.map((entry) => [entry.capability, { ...entry }])
  )
  for (const capability of deriveBackendApplicationCapabilities(parsed.value)) {
    const current = declarations.get(capability)
    declarations.set(capability, { ...current, capability, required: true })
  }
  const candidate: BackendApplicationSpecV2 = {
    ...parsed.value,
    version: BACKEND_APPLICATION_SPEC_V2_VERSION,
    capabilities: [...declarations.values()],
    realtime: { version: BACKEND_REALTIME_IR_VERSION, subscriptions: [] },
    transactions: { version: BACKEND_TRANSACTION_IR_VERSION, transactions: [] },
    dataMigrations: { version: BACKEND_DATA_MIGRATION_IR_VERSION, migrations: [] },
    automations: {
      version: BACKEND_AUTOMATION_IR_VERSION,
      queues: [],
      webhookDestinations: [],
      automations: [],
      telemetry: { logs: false, metrics: false, traces: false, auditEvents: false },
      driftDetection: { enabled: false }
    }
  }
  const lowered = parseBackendApplicationSpecV2(candidate)
  if (!lowered.ok) return lowered
  return {
    ok: true,
    value: lowered.value,
    diagnostics: [...parsed.diagnostics, ...lowered.diagnostics]
  }
}

export function normalizedBackendApplicationV2(value: unknown): BackendApplicationSpecV2 {
  const parsed = parseBackendApplicationSpecV2(value)
  if (!parsed.ok) {
    throw new TypeError(invalidBackendV2Message(parsed.diagnostics.map((entry) => entry.code)))
  }
  return parsed.value
}

export function canonicalBackendApplicationV2Bytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(normalizedBackendApplicationV2(value))
}

export async function digestBackendApplicationV2(value: unknown): Promise<string> {
  return digestCanonicalManifest(normalizedBackendApplicationV2(value))
}

// oxlint-disable-next-line complexity -- Capability evidence intentionally scans every closed IR variant.
export function deriveBackendApplicationCapabilitiesV2(
  application: BackendApplicationSpecV2
): BackendCapabilityV2[] {
  const capabilities = new Set<BackendCapabilityV2>(
    deriveBackendApplicationCapabilities(commonV1(application))
  )
  if (application.realtime.subscriptions.length > 0) {
    capabilities.add('realtime.subscribe')
    capabilities.add('events.data-change')
  }
  if (application.transactions.transactions.length > 0) capabilities.add('transactions.atomic')
  for (const transaction of application.transactions.transactions) {
    if (transaction.steps.some((entry) => entry.kind === 'data.read')) capabilities.add('data.read')
    if (transaction.steps.some((entry) => entry.kind === 'data.mutate'))
      capabilities.add('data.write')
  }
  if (application.dataMigrations.migrations.length > 0) {
    capabilities.add('migrations.data')
    capabilities.add('migrations.backfill')
  }
  if (application.automations.queues.length > 0) {
    capabilities.add('queues.publish')
    capabilities.add('queues.consume')
  }
  if (application.automations.automations.length > 0) {
    capabilities.add('server.functions')
    capabilities.add('workflows.idempotency')
    capabilities.add('workflows.retry')
    capabilities.add('workflows.durable-execution')
  }
  for (const automation of application.automations.automations) {
    if (automation.trigger.kind === 'schedule') capabilities.add('jobs.schedule')
    if (automation.trigger.kind === 'queue') capabilities.add('queues.consume')
    if (automation.trigger.kind === 'webhook') capabilities.add('webhooks.receive')
    if (automation.trigger.kind === 'data-change') capabilities.add('events.data-change')
    if (automation.action.kind === 'queue.publish') capabilities.add('queues.publish')
    if (automation.action.kind === 'webhook.deliver') capabilities.add('webhooks.deliver')
    if (automation.action.kind === 'drift.detect') capabilities.add('drift.detect')
  }
  const telemetry = application.automations.telemetry
  if (telemetry.logs) capabilities.add('observability.logs')
  if (telemetry.metrics) capabilities.add('observability.metrics')
  if (telemetry.traces) capabilities.add('observability.traces')
  if (telemetry.auditEvents) capabilities.add('audit.events')
  if (application.automations.driftDetection.enabled) capabilities.add('drift.detect')
  return [...capabilities].sort((left, right) => left.localeCompare(right, 'en'))
}

export function validateBackendCapabilityDeclarationsV2(
  application: BackendApplicationSpecV2
): BackendDiagnostic[] {
  const declarations = new Map(
    application.capabilities.map((requirement) => [requirement.capability, requirement])
  )
  return deriveBackendApplicationCapabilitiesV2(application).flatMap((capability) => {
    const declaration = declarations.get(capability)
    if (declaration?.required) return []
    const optional = declaration !== undefined
    return [
      {
        code: optional
          ? 'backend-capability-use-not-required'
          : 'backend-capability-use-undeclared',
        severity: 'error' as const,
        path: `$.capabilities.${capability}`,
        message: optional
          ? 'A capability used by Backend IR must be declared with required true.'
          : 'Backend IR uses a capability that is not declared as required.'
      }
    ]
  })
}

/** @deprecated Prefer the capability-first name used by the V1 API. */
export const deriveBackendApplicationV2Capabilities = deriveBackendApplicationCapabilitiesV2
