import type {
  AuthAccessOperation,
  AuthPrincipalIntent,
  AuthRowAccessIntentIR,
  BackendApplicationSpecV1,
  BackendWorkflowStepIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { canonicalBackendValue } from '../canonical'
import type { BackendArtifactSource, BackendProviderAdapterContext } from '../contracts'
import { jsonArtifact, SUPABASE_ARTIFACT_PATHS } from './artifacts'
import {
  qualifiedSupabaseTable,
  quoteSupabaseIdentifier,
  supabaseAllowPolicyPredicate,
  supabaseModelFieldName,
  supabasePolicyOperationClause,
  supabasePolicyTargetRole
} from './policy-helpers'

const OPERATION_ORDER: readonly AuthAccessOperation[] = Object.freeze([
  'select',
  'insert',
  'update',
  'delete'
])

function unsupportedPolicyVariant(_value: never): never {
  throw new Error('Unsupported Supabase policy variant.')
}

export interface SupabasePolicyActor {
  readonly authenticated: boolean
  readonly userId?: string
  /** Exact values from the trusted `app_metadata.roles` claim. */
  readonly roleNames?: readonly string[]
  /** Tenant-rule id to the tenant values proven by the trusted auth host. */
  readonly tenantMemberships?: Readonly<Record<string, readonly unknown[]>>
}

function policyStatus(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  intent: AuthRowAccessIntentIR
): { status: 'emitted' | 'blocked-review'; predicate?: string; reason?: string } {
  if (entity.management === 'external') {
    return {
      status: 'blocked-review',
      reason: 'External tables are inspect-only and require live RLS verification.'
    }
  }
  if (intent.effect === 'deny') {
    if (intent.principal.kind === 'anonymous' || intent.principal.kind === 'authenticated') {
      return { status: 'emitted', predicate: 'false' }
    }
    return {
      status: 'blocked-review',
      reason: 'Conditional deny intent requires a reviewed restrictive-policy translation.'
    }
  }
  const predicate = supabaseAllowPolicyPredicate(application, entity, intent.principal)
  if (predicate) return { status: 'emitted', predicate }
  return {
    status: 'blocked-review',
    reason:
      intent.principal.kind === 'anonymous' || intent.principal.kind === 'authenticated'
        ? 'A target role alone is broad row access and is never emitted.'
        : 'The authorization predicate is incomplete and requires review.'
  }
}

/** True only when an allow intent becomes an executable RLS predicate. */
export function isSupabaseAllowPolicyEmittable(
  application: BackendApplicationSpecV1,
  intent: AuthRowAccessIntentIR
): boolean {
  if (intent.effect !== 'allow') return false
  const entity = application.dataModel.entities.find((entry) => entry.id === intent.entityId)
  return Boolean(entity && policyStatus(application, entity, intent).status === 'emitted')
}

function orderedOperations(
  operations: readonly AuthAccessOperation[]
): readonly AuthAccessOperation[] {
  const requested = new Set(operations)
  return OPERATION_ORDER.filter((entry) => requested.has(entry))
}

export function createSupabaseSecurityProposal(context: BackendProviderAdapterContext) {
  const application = context.application
  const tables = application.dataModel.entities.map((entity) => {
    const intents = application.auth.rowAccess.filter((entry) => entry.entityId === entity.id)
    return {
      entityId: entity.id,
      table: entity.name,
      management: entity.management,
      rls: entity.management === 'managed' ? 'enable-and-force-proposed' : 'live-review-required',
      policies: intents.flatMap((intent) => {
        const status = policyStatus(application, entity, intent)
        return orderedOperations(intent.operations).map((operation) => ({
          sourceIntentId: intent.id,
          effect: intent.effect,
          operation,
          principal: intent.principal,
          status: status.status,
          ...(status.reason ? { reason: status.reason } : {})
        }))
      })
    }
  })
  const blockers = tables.flatMap((table) =>
    table.policies
      .filter((policy) => policy.status !== 'emitted')
      .map((policy) => `${table.entityId}:${policy.sourceIntentId}:${policy.operation}`)
  )
  if (
    context.capabilities.some((entry) => entry.capability === 'storage.objects' && entry.included)
  ) {
    blockers.push('storage.objects:explicit-bucket-and-object-policy-required')
  }
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-security-policy.v1',
      version: 1,
      applicationId: application.applicationId,
      schema: 'public',
      proposalOnly: true,
      applyAllowed: false,
      releaseReady: false,
      roleClaimsSource: 'app_metadata-only',
      generatedViews: [],
      generatedSecurityDefinerFunctions: [],
      tables,
      blockers,
      storageUpsertPolicyOperations: ['select', 'insert', 'update'],
      requiredLiveChecks: [
        'anonymous-denied-unless-explicitly-reviewed',
        'authenticated-owner-and-second-user-isolation',
        'cross-tenant-isolation',
        'insert-update-delete-upsert-policy-matrix',
        'views-use-security-invoker-or-remain-unexposed',
        'security-definer-functions-remain-in-reviewed-private-schema'
      ]
    },
    '$.supabase.securityProposal'
  )
}

export function emitSupabaseRLSSQL(context: BackendProviderAdapterContext): string {
  const application = context.application
  const lines = [
    '-- OpenPencil Supabase RLS proposal v1.',
    '-- Review only: the compiler and plugin host never apply this SQL automatically.',
    '-- No views or SECURITY DEFINER functions are generated.',
    ''
  ]
  let policyIndex = 0
  for (const entity of application.dataModel.entities) {
    if (entity.management === 'external') {
      lines.push(
        `-- External table ${qualifiedSupabaseTable(entity)} is inspect-only; verify its live RLS policies.`,
        ''
      )
      continue
    }
    const table = qualifiedSupabaseTable(entity)
    lines.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
    lines.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`)
    const intents = application.auth.rowAccess.filter((entry) => entry.entityId === entity.id)
    for (const intent of intents) {
      const status = policyStatus(application, entity, intent)
      for (const operation of orderedOperations(intent.operations)) {
        policyIndex += 1
        if (status.status !== 'emitted' || !status.predicate) {
          lines.push(
            `-- BLOCKED policy ${quoteSupabaseIdentifier(intent.id)} for ${operation.toUpperCase()}: ${status.reason ?? 'review required'}`
          )
          continue
        }
        const policyName = quoteSupabaseIdentifier(
          `openpencil_${String(policyIndex).padStart(4, '0')}_${operation}`
        )
        const mode = intent.effect === 'deny' ? 'RESTRICTIVE' : 'PERMISSIVE'
        lines.push(
          `CREATE POLICY ${policyName} ON ${table} AS ${mode} FOR ${operation.toUpperCase()} TO ${supabasePolicyTargetRole(intent.principal)} ${supabasePolicyOperationClause(operation, status.predicate)};`
        )
      }
    }
    if (intents.length === 0) {
      lines.push('-- No allow policy was declared; RLS therefore keeps this table deny-by-default.')
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function emitSupabaseSecurityArtifacts(
  context: BackendProviderAdapterContext
): readonly BackendArtifactSource[] {
  return Object.freeze([
    Object.freeze({
      path: SUPABASE_ARTIFACT_PATHS.securityPolicy,
      kind: 'security-policy',
      mediaType: 'application/sql; charset=utf-8',
      content: emitSupabaseRLSSQL(context)
    }),
    jsonArtifact(
      SUPABASE_ARTIFACT_PATHS.securityPolicyManifest,
      'security-policy',
      createSupabaseSecurityProposal(context)
    )
  ])
}

function rowValue(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string,
  row: Readonly<Record<string, unknown>>
): unknown {
  if (Object.hasOwn(row, fieldId)) return row[fieldId]
  const name = supabaseModelFieldName(application, entityId, fieldId)
  return name ? row[name] : undefined
}

function principalMatches(
  application: BackendApplicationSpecV1,
  entityId: string,
  principal: AuthPrincipalIntent,
  actor: SupabasePolicyActor,
  row: Readonly<Record<string, unknown>>
): boolean {
  switch (principal.kind) {
    case 'anonymous':
      return !actor.authenticated
    case 'authenticated':
      return actor.authenticated
    case 'role': {
      const role = application.auth.roles.find((entry) => entry.id === principal.roleId)
      return actor.authenticated && Boolean(role && actor.roleNames?.includes(role.name))
    }
    case 'owner': {
      const ownership = application.auth.ownership.find(
        (entry) => entry.id === principal.ownershipId && entry.entityId === entityId
      )
      return Boolean(
        actor.authenticated &&
        actor.userId &&
        ownership &&
        Object.is(rowValue(application, entityId, ownership.identityFieldId, row), actor.userId)
      )
    }
    case 'tenant-member': {
      const tenant = application.auth.tenants.find(
        (entry) => entry.id === principal.tenantId && entry.entityId === entityId
      )
      const memberships = actor.tenantMemberships?.[principal.tenantId]
      return Boolean(
        actor.authenticated &&
        tenant &&
        memberships?.some((value) =>
          Object.is(value, rowValue(application, entityId, tenant.tenantFieldId, row))
        )
      )
    }
    default:
      return unsupportedPolicyVariant(principal)
  }
}

/** Pure intent evaluator used to prove owner/second-user/tenant negative cases. */
export function evaluateSupabaseRowAccess(
  application: BackendApplicationSpecV1,
  input: {
    readonly entityId: string
    readonly operation: AuthAccessOperation
    readonly actor: SupabasePolicyActor
    readonly row: Readonly<Record<string, unknown>>
  }
): boolean {
  const applicable = application.auth.rowAccess.filter(
    (entry) => entry.entityId === input.entityId && entry.operations.includes(input.operation)
  )
  if (
    applicable.some(
      (entry) =>
        entry.effect === 'deny' &&
        principalMatches(application, input.entityId, entry.principal, input.actor, input.row)
    )
  ) {
    return false
  }
  return applicable.some(
    (entry) =>
      entry.effect === 'allow' &&
      principalMatches(application, input.entityId, entry.principal, input.actor, input.row)
  )
}

export function requiredSupabasePolicyOperations(
  step: Extract<BackendWorkflowStepIR, { kind: 'data.read' | 'data.mutate' }>
): readonly AuthAccessOperation[] {
  if (step.kind === 'data.read') return Object.freeze(['select'])
  switch (step.operation) {
    case 'insert':
      return Object.freeze(['insert'])
    case 'update':
      return Object.freeze(['select', 'update'])
    case 'delete':
      return Object.freeze(['select', 'delete'])
    case 'upsert':
      return Object.freeze(['select', 'insert', 'update'])
    default:
      return unsupportedPolicyVariant(step.operation)
  }
}
