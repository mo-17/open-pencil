import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import { backendDiagnostic } from '#compiler/backend/diagnostics'
import type { BackendProviderAdapterContextV2 } from '#compiler/backend/v2/contracts'

import type {
  BackendApplicationSpecV2,
  BackendAutomationDefinitionIR,
  BackendCapabilityV2,
  BackendDiagnostic,
  BackendQueueIR,
  BackendWebhookDestinationIR
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import { SUPABASE_AUTOMATION_PROVIDER_CAPABILITIES_V2 } from './descriptor'

export const SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2 = Object.freeze({
  reviewManifest: 'backend/supabase-v2/automations/review-manifest.json',
  sql: 'backend/supabase-v2/automations/review.sql',
  workerContract: 'backend/supabase-v2/automations/worker-contract.json'
} as const)

export const SUPABASE_AUTOMATION_LIMITS_V2 = Object.freeze({
  maximumAutomations: 64,
  maximumQueues: 32,
  maximumScheduledJobs: 8,
  maximumWebhookDestinations: 16
} as const)

const SUPPORTED_CAPABILITIES = new Set<BackendCapabilityV2>(
  SUPABASE_AUTOMATION_PROVIDER_CAPABILITIES_V2
)

export interface ResolvedSupabaseAutomationQueueV2 {
  readonly id: string
  readonly name: string
  readonly physicalName: string
  readonly maxPayloadBytes: number
  readonly visibilityTimeoutSeconds: number
  readonly retentionSeconds: number
  readonly delivery: 'at-least-once'
  readonly visibility: 'private'
}

export interface ResolvedSupabaseAutomationDefinitionV2 {
  readonly id: string
  readonly name: string
  readonly objectKey: string
  readonly trigger: BackendAutomationDefinitionIR['trigger']
  readonly action: BackendAutomationDefinitionIR['action']
  readonly retry: BackendAutomationDefinitionIR['retry']
  readonly idempotency: BackendAutomationDefinitionIR['idempotency']
  readonly causation: BackendAutomationDefinitionIR['causation']
}

export interface ResolvedSupabaseWebhookDestinationV2 {
  readonly id: string
  readonly name: string
  readonly maxPayloadBytes: number
  readonly endpointCredentialReferenceDigest: string
  readonly endpointAuthorityDigest: null
  readonly endpointCredentialGeneration: null
  readonly credentialReferenceDigest: string
  readonly signature: BackendWebhookDestinationIR['signature']
}

export interface ResolvedSupabaseAutomationsV2 {
  readonly applicationObjectKey: string
  readonly dispatchQueueName: string
  readonly queues: readonly ResolvedSupabaseAutomationQueueV2[]
  readonly automations: readonly ResolvedSupabaseAutomationDefinitionV2[]
  readonly webhookDestinations: readonly ResolvedSupabaseWebhookDestinationV2[]
}

function stableObjectKey(domain: string, value: unknown, path: string): string {
  return digestCanonicalBackendValue({ domain, value }, path).slice(0, 20).toLowerCase()
}

function diagnostic(code: string, path: string, message: string): BackendDiagnostic {
  return backendDiagnostic(code, 'error', path, message)
}

function resolvedQueue(
  applicationId: string,
  queue: BackendQueueIR
): ResolvedSupabaseAutomationQueueV2 {
  return Object.freeze({
    id: queue.id,
    name: queue.name,
    physicalName: `op_${stableObjectKey(
      'openpencil.supabase-automation-queue.v1',
      { applicationId, queueId: queue.id },
      `$.supabaseAutomations.queues.${queue.id}`
    )}`,
    maxPayloadBytes: queue.maxPayloadBytes,
    visibilityTimeoutSeconds: queue.visibilityTimeoutSeconds,
    retentionSeconds: queue.retentionSeconds,
    delivery: queue.delivery,
    visibility: queue.visibility
  })
}

function resolvedAutomation(
  applicationId: string,
  automation: BackendAutomationDefinitionIR
): ResolvedSupabaseAutomationDefinitionV2 {
  return Object.freeze({
    id: automation.id,
    name: automation.name,
    objectKey: stableObjectKey(
      'openpencil.supabase-automation-object.v1',
      { applicationId, automationId: automation.id },
      `$.supabaseAutomations.automations.${automation.id}`
    ),
    trigger: automation.trigger,
    action: automation.action,
    retry: automation.retry,
    idempotency: automation.idempotency,
    causation: automation.causation
  })
}

function resolvedDestination(
  applicationId: string,
  destination: BackendWebhookDestinationIR
): ResolvedSupabaseWebhookDestinationV2 {
  return Object.freeze({
    id: destination.id,
    name: destination.name,
    maxPayloadBytes: destination.maxPayloadBytes,
    endpointCredentialReferenceDigest: digestCanonicalBackendValue(
      {
        domain: 'openpencil.supabase-webhook-endpoint-credential-reference.v1',
        applicationId,
        destinationId: destination.id,
        credentialRef: destination.endpointCredentialRef
      },
      `$.supabaseAutomations.webhookDestinations.${destination.id}.endpointCredentialReferenceDigest`
    ),
    endpointAuthorityDigest: null,
    endpointCredentialGeneration: null,
    credentialReferenceDigest: digestCanonicalBackendValue(
      {
        domain: 'openpencil.supabase-webhook-credential-reference.v1',
        applicationId,
        destinationId: destination.id,
        credentialRef: destination.signingCredentialRef
      },
      `$.supabaseAutomations.webhookDestinations.${destination.id}.credentialReferenceDigest`
    ),
    signature: destination.signature
  })
}

export function resolvedSupabaseAutomationsV2(
  application: BackendApplicationSpecV2
): ResolvedSupabaseAutomationsV2 {
  const applicationObjectKey = stableObjectKey(
    'openpencil.supabase-automation-application.v1',
    application.applicationId,
    '$.supabaseAutomations.applicationObjectKey'
  )
  return Object.freeze({
    applicationObjectKey,
    dispatchQueueName: `op_dispatch_${applicationObjectKey}`,
    queues: Object.freeze(
      application.automations.queues
        .map((queue) => resolvedQueue(application.applicationId, queue))
        .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    ),
    automations: Object.freeze(
      application.automations.automations
        .map((automation) => resolvedAutomation(application.applicationId, automation))
        .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    ),
    webhookDestinations: Object.freeze(
      application.automations.webhookDestinations
        .map((destination) => resolvedDestination(application.applicationId, destination))
        .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    )
  })
}

/**
 * Accept only the first server-owned automation slice. Data-change triggers, workflow/transaction
 * execution, telemetry and drift stay outside this candidate until their own authority paths exist.
 */
export function validateSupabaseAutomationsV2(
  context: BackendProviderAdapterContextV2
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  for (const capability of context.actualCapabilities) {
    if (!SUPPORTED_CAPABILITIES.has(capability)) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-automation-capability-unsupported',
          `$.actualCapabilities.${capability}`,
          'The first Supabase automation slice refuses unrelated application capabilities.'
        )
      )
    }
  }
  const source = context.application.automations
  if (source.queues.length > SUPABASE_AUTOMATION_LIMITS_V2.maximumQueues) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-automation-queue-capacity-exceeded',
        '$.application.automations.queues',
        'The candidate Supabase automation slice supports at most 32 private queues.'
      )
    )
  }
  if (
    source.webhookDestinations.length > SUPABASE_AUTOMATION_LIMITS_V2.maximumWebhookDestinations
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-automation-webhook-capacity-exceeded',
        '$.application.automations.webhookDestinations',
        'The candidate Supabase automation slice supports at most 16 webhook destinations.'
      )
    )
  }
  if (source.automations.length > SUPABASE_AUTOMATION_LIMITS_V2.maximumAutomations) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-automation-capacity-exceeded',
        '$.application.automations.automations',
        'The candidate Supabase automation slice supports at most 64 automations.'
      )
    )
  }
  const schedules = source.automations.filter((entry) => entry.trigger.kind === 'schedule')
  if (schedules.length > SUPABASE_AUTOMATION_LIMITS_V2.maximumScheduledJobs) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-automation-schedule-capacity-exceeded',
        '$.application.automations.automations',
        'The candidate slice caps scheduled jobs at eight so concurrency remains reviewable.'
      )
    )
  }
  for (const [index, automation] of source.automations.entries()) {
    const path = `$.application.automations.automations[${index}]`
    if (automation.trigger.kind === 'data-change') {
      diagnostics.push(
        diagnostic(
          'supabase-v2-automation-data-change-trigger-unsupported',
          `${path}.trigger`,
          'Database-event automation requires a separately reviewed trigger and event authority.'
        )
      )
    }
    if (automation.action.kind === 'workflow' || automation.action.kind === 'transaction') {
      diagnostics.push(
        diagnostic(
          'supabase-v2-automation-action-unsupported',
          `${path}.action`,
          'The first slice cannot issue workflow or transaction execution authority.'
        )
      )
    }
    if (automation.action.kind === 'drift.detect') {
      diagnostics.push(
        diagnostic(
          'supabase-v2-automation-drift-action-unsupported',
          `${path}.action`,
          'Drift detection belongs to the separate read-only observability authority.'
        )
      )
    }
  }
  if (
    source.telemetry.logs ||
    source.telemetry.metrics ||
    source.telemetry.traces ||
    source.telemetry.auditEvents ||
    source.driftDetection.enabled
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-automation-observability-unsupported',
        '$.application.automations',
        'Telemetry and drift declarations require the separate observability adapter.'
      )
    )
  }
  return Object.freeze(diagnostics)
}

export function createSupabaseAutomationsPlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  const resolved = resolvedSupabaseAutomationsV2(context.application)
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-automations-plan.v1',
      version: 1,
      applicationId: context.application.applicationId,
      providerId: 'supabase',
      reviewOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      releaseReady: false,
      requiredExtensions: resolved.automations.some((entry) => entry.trigger.kind === 'schedule')
        ? ['pg_cron', 'pgmq']
        : ['pgmq'],
      extensionBootstrapAllowed: false,
      extensionInventoryVerification: 'trusted-post-apply-receipt-required',
      expectedPostApplyState: {
        evidenceStatus: 'unverified-until-trusted-post-apply-receipt',
        acceptedReceipt: false,
        queues: {
          existingGeneratedQueuePolicy: 'reject',
          exposure: 'postgres-server-only',
          durability: 'logged',
          partitioning: 'none',
          ownershipAndConfigurationMarker: 'exact',
          declaredRuntimeConfiguration: 'marker-only-not-database-enforced',
          completeAclInventory: 'unverified',
          publicAnonAuthenticatedServiceRoleTableAccess: 'none'
        },
        cron: {
          existingSameNameJobPolicy: 'reject',
          timezone: 'effective-zero-offset-UTC',
          username: 'current-user',
          database: 'current-database',
          connectionTarget: 'local-current-database-server',
          scheduleCommandAndActiveState: 'exact'
        }
      },
      queueCompletionContract: 'explicit-archive-after-idempotent-action',
      retirement: {
        automatic: false,
        explicitApprovalRequired: true,
        inspectedInventoryRequired: true,
        inspectedInventoryVerified: false
      },
      runtimeAuthorityCreated: false,
      credentialAuthorityCreated: false,
      networkAuthorityCreated: false,
      ...resolved
    },
    '$.supabaseAutomations.plan'
  )
}

export function createSupabaseAutomationServerBridgePlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-automation-server-bridge-plan.v1',
      version: 1,
      applicationId: context.application.applicationId,
      providerId: 'supabase',
      reviewOnly: true,
      executableRuntimeEmitted: false,
      runtimeAuthorityCreated: false,
      credentialAuthorityCreated: false,
      networkAuthorityCreated: false,
      owner: 'automations-adapter-review-contract'
    },
    '$.supabaseAutomations.serverBridgePlan'
  )
}
