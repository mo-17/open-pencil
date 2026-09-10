import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import { backendDiagnostic } from '#compiler/backend/diagnostics'
import type { BackendProviderAdapterContextV2 } from '#compiler/backend/v2/contracts'

import type {
  BackendApplicationSpecV2,
  BackendAutomationDefinitionIR,
  BackendCapabilityV2,
  BackendDiagnostic
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  createSupabaseAutomationsPlanV2,
  validateSupabaseAutomationsV2,
  SUPABASE_AUTOMATION_LIMITS_V2
} from '../automation'
import {
  SUPABASE_OBSERVABILITY_CAPABILITIES_V2,
  SUPABASE_OBSERVABILITY_PROVIDER_CAPABILITIES_V2
} from './descriptor'
import { resolveSupabaseOperationalEventSinkScopeV2 } from './operational-event-sink-sql'

export {
  emitSupabaseOperationalEventSinkReviewSQLV2,
  resolveSupabaseOperationalEventSinkScopeV2,
  supabaseOperationalEventSinkSchemaNameV2
} from './operational-event-sink-sql'

export const SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2 = Object.freeze({
  reviewManifest: 'backend/supabase-v2/observability/review-manifest.json',
  inspectionContract: 'backend/supabase-v2/observability/inspection-contract.json',
  auditContract: 'backend/supabase-v2/observability/audit-contract.json',
  operationalEventSinkSchema: 'backend/supabase-v2/observability/operational-event-sink-schema.sql'
} as const)

export const SUPABASE_OBSERVABILITY_LIMITS_V2 = Object.freeze({
  maximumDriftSchedules: 1,
  maximumObservationBatchEvents: 256,
  maximumObservationEventBytes: 16_384,
  maximumReceiptBytes: 262_144
} as const)

const SUPPORTED_CAPABILITIES = new Set<BackendCapabilityV2>(
  SUPABASE_OBSERVABILITY_PROVIDER_CAPABILITIES_V2
)

function diagnostic(code: string, path: string, message: string): BackendDiagnostic {
  return backendDiagnostic(code, 'error', path, message)
}

function driftSchedules(
  application: BackendApplicationSpecV2
): readonly BackendAutomationDefinitionIR[] {
  return application.automations.automations.filter(
    (entry) => entry.trigger.kind === 'schedule' && entry.action.kind === 'drift.detect'
  )
}

const OBSERVABILITY_CAPABILITIES = new Set<BackendCapabilityV2>(
  SUPABASE_OBSERVABILITY_CAPABILITIES_V2
)

/** 2.5-owned projection into the unchanged 2.4 Automation trust domain. */
export function supabaseObservabilityAutomationContextV2(
  context: BackendProviderAdapterContextV2
): BackendProviderAdapterContextV2 {
  const source = context.application.automations
  const ordinaryAutomations = source.automations.filter(
    (automation) => automation.action.kind !== 'drift.detect'
  )
  const projectedApplication = Object.freeze({
    ...context.application,
    automations: Object.freeze({
      ...source,
      automations: Object.freeze(ordinaryAutomations),
      telemetry: Object.freeze({ logs: false, metrics: false, traces: false, auditEvents: false }),
      driftDetection: Object.freeze({ enabled: false })
    })
  }) as BackendApplicationSpecV2
  return Object.freeze({
    ...context,
    application: projectedApplication,
    actualCapabilities: Object.freeze(
      context.actualCapabilities.filter((capability) => !OBSERVABILITY_CAPABILITIES.has(capability))
    )
  })
}

export function hasSupabaseObservabilityAutomationIntentV2(
  context: BackendProviderAdapterContextV2
): boolean {
  const source = supabaseObservabilityAutomationContextV2(context).application.automations
  return (
    source.queues.length > 0 ||
    source.webhookDestinations.length > 0 ||
    source.automations.length > 0
  )
}

/**
 * Invoke 2.4 validation only over the projected ordinary slice. Drift remains owned by 2.5.
 */
export function validateSupabaseObservabilityAutomationCompositeV2(
  context: BackendProviderAdapterContextV2
): readonly BackendDiagnostic[] {
  const source = context.application.automations
  const ordinaryAutomations = source.automations.filter(
    (automation) => automation.action.kind !== 'drift.detect'
  )
  const diagnostics = [
    ...validateSupabaseAutomationsV2(supabaseObservabilityAutomationContextV2(context))
  ]
  if (
    source.automations.length > SUPABASE_AUTOMATION_LIMITS_V2.maximumAutomations &&
    ordinaryAutomations.length <= SUPABASE_AUTOMATION_LIMITS_V2.maximumAutomations
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-automation-capacity-exceeded',
        '$.application.automations.automations',
        'The candidate Supabase automation slice supports at most 64 automations.'
      )
    )
  }
  const allSchedules = source.automations.filter((entry) => entry.trigger.kind === 'schedule')
  const ordinarySchedules = ordinaryAutomations.filter((entry) => entry.trigger.kind === 'schedule')
  if (
    allSchedules.length > SUPABASE_AUTOMATION_LIMITS_V2.maximumScheduledJobs &&
    ordinarySchedules.length <= SUPABASE_AUTOMATION_LIMITS_V2.maximumScheduledJobs
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-automation-schedule-capacity-exceeded',
        '$.application.automations.automations',
        'The candidate slice caps scheduled jobs at eight so concurrency remains reviewable.'
      )
    )
  }
  return Object.freeze(diagnostics)
}

export function supabaseObservabilityDeclaredDataModelDigestV2(
  application: BackendApplicationSpecV2
): string {
  return digestCanonicalBackendValue(
    application.dataModel,
    '$.supabaseObservability.declaredDataModel'
  )
}

export function supabaseObservabilityDeclaredSubjectDigestV2(
  application: BackendApplicationSpecV2
): string {
  return digestCanonicalBackendValue(
    {
      format: 'openpencil.supabase-observability-declared-subject.v1',
      version: 1,
      applicationId: application.applicationId,
      dataModel: application.dataModel,
      auth: application.auth,
      automations: application.automations
    },
    '$.supabaseObservability.declaredSchemaSubject'
  )
}

/**
 * Accept only telemetry declarations and one read-only scheduled drift action. The Compiler creates
 * no timer, database query, Management request, credential lease, or event sink.
 */
export function validateSupabaseObservabilityV2(
  context: BackendProviderAdapterContextV2
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  for (const capability of context.actualCapabilities) {
    if (!SUPPORTED_CAPABILITIES.has(capability)) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-observability-capability-unsupported',
          `$.actualCapabilities.${capability}`,
          'The Supabase observability candidate refuses unrelated application capabilities.'
        )
      )
    }
  }
  const source = context.application.automations
  const schedules = driftSchedules(context.application)
  if (schedules.length > SUPABASE_OBSERVABILITY_LIMITS_V2.maximumDriftSchedules) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-observability-schedule-capacity-exceeded',
        '$.application.automations.automations',
        'The observability candidate supports at most one read-only drift schedule.'
      )
    )
  }
  if (
    source.driftDetection.enabled &&
    (schedules.length !== 1 || schedules[0]?.id !== source.driftDetection.scheduleAutomationId)
  ) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-observability-drift-schedule-invalid',
        '$.application.automations.driftDetection.scheduleAutomationId',
        'Drift monitoring must bind the exact unique read-only schedule.'
      )
    )
  }
  return Object.freeze(diagnostics)
}

export function createSupabaseObservabilityPlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  const schedule = driftSchedules(context.application).at(0)
  const sinkScope = resolveSupabaseOperationalEventSinkScopeV2(context.application.applicationId)
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-observability-plan.v1',
      version: 1,
      providerId: 'supabase',
      applicationId: context.application.applicationId,
      declaredDataModelDigest: supabaseObservabilityDeclaredDataModelDigestV2(context.application),
      declaredSubjectDigest: supabaseObservabilityDeclaredSubjectDigestV2(context.application),
      expectedSourceLedgerSchemaDigest: null,
      expectedSourceLedgerSchemaDigestAuthority: 'trusted-host-current-environment-only',
      telemetry: context.application.automations.telemetry,
      driftDetection: {
        enabled: context.application.automations.driftDetection.enabled,
        schedule:
          schedule?.trigger.kind === 'schedule'
            ? {
                automationId: schedule.id,
                cron: schedule.trigger.cron,
                timezone: schedule.trigger.timezone,
                scope: 'declared-schema',
                mode: 'read-only'
              }
            : null
      },
      actualObservabilityCapabilities: context.actualCapabilities.filter((capability) =>
        SUPABASE_OBSERVABILITY_CAPABILITIES_V2.includes(
          capability as (typeof SUPABASE_OBSERVABILITY_CAPABILITIES_V2)[number]
        )
      ),
      operationalEventSink: {
        applicationObjectKey: sinkScope.applicationObjectKey,
        applicationScopeDigest: sinkScope.applicationScopeDigest,
        schemaName: sinkScope.schemaName,
        schemaCandidateEmitted: true,
        eventPayloadEmitted: false,
        proposalAndBatchAuthorityClaims: 'fixed-false',
        timestampProjection: 'trusted-host-zero-pad-to-nine-fractional-digits-without-rounding',
        expectedPostgrestExposure: 'not-exposed',
        postgrestExposureVerified: false,
        hostCasWriterEmitted: false,
        databaseApplied: false,
        trustedReceiptAccepted: false
      },
      reviewOnly: true,
      inspectionTransport: 'trusted-desktop-host-single-snapshot',
      comparisonModel: 'normalized-declared-schema-to-inspected-inventory',
      releaseReady: false,
      runtimeAuthorityCreated: false,
      credentialAuthorityCreated: false,
      databaseAuthorityCreated: false,
      networkAuthorityCreated: false,
      schedulerAuthorityCreated: false,
      telemetrySinkAuthorityCreated: false
    },
    '$.supabaseObservability.plan'
  )
}

export function createSupabaseObservabilityAutomationBridgePlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  const schedule = driftSchedules(context.application).at(0)
  const automationContext = supabaseObservabilityAutomationContextV2(context)
  const emitsOrdinaryAutomationArtifacts = hasSupabaseObservabilityAutomationIntentV2(context)
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-observability-automation-composite-plan.v1',
      version: 1,
      applicationId: context.application.applicationId,
      automationPlan: emitsOrdinaryAutomationArtifacts
        ? createSupabaseAutomationsPlanV2(automationContext)
        : null,
      ordinaryAutomationArtifactsEmitted: emitsOrdinaryAutomationArtifacts,
      scheduleId: schedule?.id ?? null,
      maximumScheduledJobs: SUPABASE_AUTOMATION_LIMITS_V2.maximumScheduledJobs,
      reviewOnly: true,
      ordinaryAutomationReviewSqlEmitted: emitsOrdinaryAutomationArtifacts,
      driftSchedulerSqlEmitted: false,
      schedulerAuthorityCreated: false,
      runtimeAuthorityCreated: false
    },
    '$.supabaseObservability.automationBridgePlan'
  )
}

export function createSupabaseObservabilityServerBridgePlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-observability-server-bridge-plan.v1',
      version: 1,
      applicationId: context.application.applicationId,
      reviewOnly: true,
      executableRuntimeEmitted: false,
      runtimeAuthorityCreated: false,
      credentialAuthorityCreated: false,
      networkAuthorityCreated: false
    },
    '$.supabaseObservability.serverBridgePlan'
  )
}
