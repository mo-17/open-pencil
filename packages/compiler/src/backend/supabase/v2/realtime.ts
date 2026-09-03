import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import { backendDiagnostic } from '#compiler/backend/diagnostics'
import type { BackendProviderAdapterContextV2 } from '#compiler/backend/v2/contracts'

import type {
  AuthRowAccessIntentIR,
  BackendApplicationSpecV2,
  BackendDiagnostic,
  BackendRealtimeEvent,
  BackendRealtimeSubscriptionIR,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

export const SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2 = Object.freeze({
  client: 'backend/supabase-v2/realtime/client.ts',
  databasePrerequisites: 'backend/supabase-v2/realtime/database-prerequisites.json',
  reviewManifest: 'backend/supabase-v2/realtime/review-manifest.json',
  sql: 'backend/supabase-v2/realtime/review.sql'
} as const)

export const SUPABASE_PRIVATE_REALTIME_SCHEMA_V2 = 'openpencil_private' as const
export const SUPABASE_PRIVATE_REALTIME_EVENT_V2 = 'openpencil.invalidate' as const

const REQUIRED_ACTUAL_CAPABILITIES = Object.freeze([
  'auth.identity',
  'events.data-change',
  'migrations.schema',
  'policy.row-level',
  'realtime.subscribe'
] as const)
const EVENT_ORDER = Object.freeze([
  'insert',
  'update',
  'delete'
] as const satisfies readonly BackendRealtimeEvent[])

export interface ResolvedSupabasePrivateRealtimeSubscriptionV2 {
  readonly id: string
  readonly digest: string
  readonly applicationObjectKey: string
  readonly subscriptionObjectKey: string
  readonly entityId: string
  readonly table: string
  readonly events: readonly BackendRealtimeEvent[]
  readonly ownerFieldId: string
  readonly ownerField: string
  readonly ownershipId: string
  readonly policyId: string
  readonly primaryKey: readonly { readonly fieldId: string; readonly field: string }[]
  readonly queryKey: string
  readonly topicPrefix: string
}

function stableObjectKey(domain: string, value: unknown, path: string): string {
  // Lower-case output avoids secret-detector ambiguity while preserving ample identifier entropy.
  return digestCanonicalBackendValue({ domain, value }, path).slice(0, 16).toLowerCase()
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  severity: BackendDiagnostic['severity'] = 'error'
): BackendDiagnostic {
  return backendDiagnostic(code, severity, path, message)
}

function entityFor(
  application: BackendApplicationSpecV2,
  subscription: BackendRealtimeSubscriptionIR
): DataEntityIR | undefined {
  return application.dataModel.entities.find((entry) => entry.id === subscription.entityId)
}

function ownershipFor(
  application: BackendApplicationSpecV2,
  subscription: BackendRealtimeSubscriptionIR
) {
  if (subscription.principal.kind !== 'owner') return undefined
  const ownershipId = subscription.principal.ownershipId
  return application.auth.ownership.find(
    (entry) => entry.id === ownershipId && entry.entityId === subscription.entityId
  )
}

function ownerFieldFor(
  application: BackendApplicationSpecV2,
  subscription: BackendRealtimeSubscriptionIR
): DataFieldIR | undefined {
  const entity = entityFor(application, subscription)
  const ownership = ownershipFor(application, subscription)
  return entity?.fields.find((entry) => entry.id === ownership?.identityFieldId)
}

function selectPolicyFor(
  application: BackendApplicationSpecV2,
  subscription: BackendRealtimeSubscriptionIR
): AuthRowAccessIntentIR | undefined {
  if (subscription.principal.kind !== 'owner') return undefined
  const ownershipId = subscription.principal.ownershipId
  return application.auth.rowAccess.find(
    (entry) =>
      entry.entityId === subscription.entityId &&
      entry.effect === 'allow' &&
      entry.operations.includes('select') &&
      entry.principal.kind === 'owner' &&
      entry.principal.ownershipId === ownershipId
  )
}

function primaryKeyFields(entity: DataEntityIR): readonly DataFieldIR[] | undefined {
  const ids = entity.primaryKey?.fields
  if (!ids?.length) return undefined
  const fields = ids.map((fieldId) => entity.fields.find((entry) => entry.id === fieldId))
  return fields.every((entry): entry is DataFieldIR => entry !== undefined) ? fields : undefined
}

function subscriptionDigest(
  application: BackendApplicationSpecV2,
  subscription: BackendRealtimeSubscriptionIR,
  entity: DataEntityIR,
  ownerField: DataFieldIR,
  policy: AuthRowAccessIntentIR,
  primaryKey: readonly DataFieldIR[]
): string {
  return digestCanonicalBackendValue(
    {
      domain: 'openpencil.supabase-private-realtime-subscription.v1',
      applicationId: application.applicationId,
      subscription,
      table: entity.name,
      ownerField: { id: ownerField.id, name: ownerField.name },
      policyId: policy.id,
      primaryKey: primaryKey.map((field) => ({ id: field.id, name: field.name }))
    },
    `$.supabasePrivateRealtime.subscriptions.${subscription.id}`
  )
}

function resolveSubscription(
  application: BackendApplicationSpecV2,
  subscription: BackendRealtimeSubscriptionIR
): ResolvedSupabasePrivateRealtimeSubscriptionV2 {
  const entity = entityFor(application, subscription)
  const ownership = ownershipFor(application, subscription)
  const ownerField = ownerFieldFor(application, subscription)
  const policy = selectPolicyFor(application, subscription)
  const primaryKey = entity ? primaryKeyFields(entity) : undefined
  if (!entity || !ownership || !ownerField || !policy || !primaryKey) {
    throw new TypeError('Supabase private Realtime subscription was not validated.')
  }
  const digest = subscriptionDigest(
    application,
    subscription,
    entity,
    ownerField,
    policy,
    primaryKey
  )
  return Object.freeze({
    id: subscription.id,
    digest,
    applicationObjectKey: stableObjectKey(
      'openpencil.supabase-private-realtime-application-object.v1',
      application.applicationId,
      '$.supabasePrivateRealtime.applicationObjectKey'
    ),
    subscriptionObjectKey: stableObjectKey(
      'openpencil.supabase-private-realtime-subscription-object.v1',
      { applicationId: application.applicationId, subscriptionId: subscription.id },
      `$.supabasePrivateRealtime.subscriptionObjectKey.${subscription.id}`
    ),
    entityId: entity.id,
    table: entity.name,
    events: Object.freeze(EVENT_ORDER.filter((event) => subscription.events.includes(event))),
    ownerFieldId: ownerField.id,
    ownerField: ownerField.name,
    ownershipId: ownership.id,
    policyId: policy.id,
    primaryKey: Object.freeze(
      primaryKey.map((field) => Object.freeze({ fieldId: field.id, field: field.name }))
    ),
    queryKey: subscription.delivery.queryKey,
    topicPrefix: `op:rt:${digest}:`
  })
}

export function resolvedSupabasePrivateRealtimeSubscriptionsV2(
  application: BackendApplicationSpecV2
): readonly ResolvedSupabasePrivateRealtimeSubscriptionV2[] {
  return Object.freeze(
    application.realtime.subscriptions
      .map((subscription) => resolveSubscription(application, subscription))
      .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  )
}

/** Reject every model shape outside the deliberately small owner-scoped first slice. */
export function validateSupabasePrivateRealtimeV2(
  context: BackendProviderAdapterContextV2
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  const actual = new Set(context.actualCapabilities)
  const supported = new Set<string>(REQUIRED_ACTUAL_CAPABILITIES)
  for (const capability of REQUIRED_ACTUAL_CAPABILITIES) {
    if (!actual.has(capability)) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-capability-required',
          `$.actualCapabilities.${capability}`,
          'Supabase private Realtime requires this capability to be proven by normalized Backend V2 IR.'
        )
      )
    }
  }
  for (const capability of context.actualCapabilities) {
    if (!supported.has(capability)) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-capability-unsupported',
          `$.actualCapabilities.${capability}`,
          'The first Supabase Backend V2 slice refuses unrelated application capabilities.'
        )
      )
    }
  }
  diagnostics.push(
    diagnostic(
      'supabase-v2-private-realtime-managed-schema-prerequisite',
      '$.actualCapabilities.migrations.schema',
      'This candidate emits no managed entity schema SQL; trusted P1 source-ledger evidence must prove that prerequisite before release.',
      'warning'
    )
  )
  if (context.target !== 'react' && context.target !== 'vue') {
    diagnostics.push(
      diagnostic(
        'supabase-v2-private-realtime-target-unsupported',
        '$.target',
        'Supabase private Realtime client artifacts currently support only React and Vue web targets.'
      )
    )
  }
  if (!context.application.auth.identities.some((entry) => entry.kind === 'user')) {
    diagnostics.push(
      diagnostic(
        'supabase-v2-private-realtime-user-identity-required',
        '$.application.auth.identities',
        'Owner-scoped Supabase Realtime requires an explicit user identity declaration.'
      )
    )
  }
  for (const [index, subscription] of context.application.realtime.subscriptions.entries()) {
    const path = `$.application.realtime.subscriptions[${index}]`
    if (subscription.principal.kind !== 'owner') {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-owner-principal-required',
          `${path}.principal`,
          'The first Supabase Realtime slice supports only an owner principal.'
        )
      )
      continue
    }
    const entity = entityFor(context.application, subscription)
    if (entity?.management !== 'managed') {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-managed-entity-required',
          `${path}.entityId`,
          'Supabase trigger artifacts require a managed entity.'
        )
      )
    }
    const ownership = ownershipFor(context.application, subscription)
    const ownerField = ownerFieldFor(context.application, subscription)
    if (!ownership || !ownerField) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-owner-field-missing',
          `${path}.principal.ownershipId`,
          'Owner-scoped Supabase Realtime requires a matching ownership and identity field.'
        )
      )
    } else if (ownerField.type !== 'uuid' || ownerField.nullable) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-owner-field-invalid',
          `$.application.dataModel.entities.${subscription.entityId}.fields.${ownerField.id}`,
          'The owner identity field must be a non-null UUID.'
        )
      )
    }
    if (!entity || !primaryKeyFields(entity)) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-primary-key-required',
          `${path}.entityId`,
          'Minimal invalidation envelopes require a declared record primary key.'
        )
      )
    }
    if (!selectPolicyFor(context.application, subscription)) {
      diagnostics.push(
        diagnostic(
          'supabase-v2-private-realtime-select-policy-required',
          `${path}.principal`,
          'Owner-scoped Supabase Realtime requires a matching allow-select row policy.'
        )
      )
    }
  }
  return Object.freeze(diagnostics)
}

export function createSupabasePrivateRealtimePlanV2(
  context: BackendProviderAdapterContextV2
): JSONValue {
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-private-realtime-plan.v1',
      version: 1,
      applicationId: context.application.applicationId,
      providerId: 'supabase',
      reviewOnly: true,
      applyAllowed: false,
      privateSchema: SUPABASE_PRIVATE_REALTIME_SCHEMA_V2,
      event: SUPABASE_PRIVATE_REALTIME_EVENT_V2,
      realtimeSchemaMutation: 'forbidden',
      realtimeMessagesRls: 'select-policy-only',
      dashboard: { allowPublicAccess: false },
      subscriptions: resolvedSupabasePrivateRealtimeSubscriptionsV2(context.application)
    },
    '$.supabasePrivateRealtime.plan'
  )
}
