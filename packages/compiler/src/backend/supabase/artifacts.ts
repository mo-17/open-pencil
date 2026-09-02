import type {
  BackendApplicationSpecV1,
  BackendSecretRef,
  BackendWorkflowStepIR,
  DataFieldIR,
  DataModelIR
} from '@open-pencil/lowcode/backend'

import { canonicalBackendValue, digestCanonicalBackendValue } from '../canonical'
import type { BackendArtifactSource, BackendProviderAdapterContext } from '../contracts'

export const SUPABASE_ARTIFACT_PATHS = Object.freeze({
  clientConfig: 'backend/supabase/client-config.json',
  clientTypes: 'backend/supabase/database.types.ts',
  databaseSchema: 'backend/supabase/database-schema.json',
  migrationPlan: 'backend/supabase/migration-plan.json',
  securityPolicy: 'backend/supabase/rls-policy.sql',
  securityPolicyManifest: 'backend/supabase/rls-policy.json',
  serverRuntime: 'backend/supabase/functions/openpencil-runtime/workflows.json',
  deploymentManifest: 'backend/supabase/deployment-manifest.json'
} as const)

export function stableBackendJSON(value: unknown, path: string): string {
  return `${JSON.stringify(canonicalBackendValue(value, path), null, 2)}\n`
}

export function jsonArtifact(
  path: string,
  kind: BackendArtifactSource['kind'],
  value: unknown
): BackendArtifactSource {
  return Object.freeze({
    path,
    kind,
    mediaType: 'application/json',
    content: stableBackendJSON(value, `$.artifacts.${kind}`)
  })
}

function unsupportedScalarType(_type: never): never {
  throw new Error('Unsupported backend scalar type.')
}

function scalarType(field: DataFieldIR, model: DataModelIR): string {
  if (field.type === 'enum') {
    const enumName = model.enums.find((entry) => entry.id === field.enumId)?.name
    return enumName ? `Database['public']['Enums'][${JSON.stringify(enumName)}]` : 'never'
  }
  switch (field.type) {
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return 'Json'
    case 'string':
    case 'date':
    case 'datetime':
    case 'uuid':
    case 'bytes':
      return 'string'
    default:
      return unsupportedScalarType(field.type)
  }
}

function fieldType(field: DataFieldIR, model: DataModelIR): string {
  const scalar = scalarType(field, model)
  return field.nullable ? `${scalar} | null` : scalar
}

function objectFields(
  fields: readonly DataFieldIR[],
  model: DataModelIR,
  mode: 'row' | 'insert' | 'update'
): string {
  if (fields.length === 0) return 'Record<string, never>'
  const lines = fields.map((field) => {
    const optional = mode === 'update' || (mode === 'insert' && (field.nullable || field.default))
    return `          ${JSON.stringify(field.name)}${optional ? '?' : ''}: ${fieldType(field, model)};`
  })
  return `{\n${lines.join('\n')}\n        }`
}

/** Deterministic Supabase-js compatible type surface; no endpoint or key is embedded. */
export function emitSupabaseDatabaseTypes(model: DataModelIR): string {
  const tables = model.entities
    .map(
      (entity) => `      ${JSON.stringify(entity.name)}: {
        Row: ${objectFields(entity.fields, model, 'row')}
        Insert: ${objectFields(entity.fields, model, 'insert')}
        Update: ${objectFields(entity.fields, model, 'update')}
        Relationships: []
      }`
    )
    .join('\n')
  const enums = model.enums
    .map(
      (entry) =>
        `      ${JSON.stringify(entry.name)}: ${entry.values.map((value) => JSON.stringify(value)).join(' | ') || 'never'};`
    )
    .join('\n')
  return `// Generated from explicit OpenPencil DataModelIR. Do not edit by hand.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: ${tables ? `{\n${tables}\n    }` : 'Record<string, never>'}
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: ${enums ? `{\n${enums}\n    }` : 'Record<string, never>'}
    CompositeTypes: Record<string, never>
  }
}
`
}

function requiredEnvironment(application: BackendApplicationSpecV1): readonly BackendSecretRef[] {
  return application.secrets
    .filter((entry) => entry.required)
    .map((entry) => ({ ...entry }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

function walkWorkflowSteps(
  steps: readonly BackendWorkflowStepIR[],
  visit: (step: BackendWorkflowStepIR) => void
): void {
  for (const step of steps) {
    visit(step)
    if (step.kind === 'branch') {
      walkWorkflowSteps(step.consequent, visit)
      walkWorkflowSteps(step.alternate, visit)
    }
  }
}

function environmentNames(application: BackendApplicationSpecV1): readonly string[] {
  const names = new Set(application.secrets.map((entry) => entry.name))
  for (const workflow of application.workflows.workflows) {
    walkWorkflowSteps(workflow.steps, (step) => {
      if (step.kind !== 'http.request') return
      const sources = [step.url, step.body, ...(step.headers?.map((entry) => entry.value) ?? [])]
      for (const source of sources) {
        if (source?.kind === 'environment') names.add(source.name)
      }
    })
  }
  return [...names].sort((left, right) => left.localeCompare(right, 'en'))
}

function hasIncludedCapability(
  context: BackendProviderAdapterContext,
  capability: string
): boolean {
  return context.capabilities.some((entry) => entry.capability === capability && entry.included)
}

function plannedArtifactPaths(context: BackendProviderAdapterContext): readonly string[] {
  const paths: string[] = [
    SUPABASE_ARTIFACT_PATHS.serverRuntime,
    SUPABASE_ARTIFACT_PATHS.deploymentManifest
  ]
  if (
    hasIncludedCapability(context, 'data.read') ||
    hasIncludedCapability(context, 'data.write') ||
    hasIncludedCapability(context, 'storage.objects')
  ) {
    paths.push(
      SUPABASE_ARTIFACT_PATHS.clientConfig,
      SUPABASE_ARTIFACT_PATHS.clientTypes,
      SUPABASE_ARTIFACT_PATHS.databaseSchema
    )
  }
  if (hasIncludedCapability(context, 'migrations.schema')) {
    paths.push(SUPABASE_ARTIFACT_PATHS.migrationPlan)
  }
  if (hasIncludedCapability(context, 'policy.row-level')) {
    paths.push(
      SUPABASE_ARTIFACT_PATHS.securityPolicy,
      SUPABASE_ARTIFACT_PATHS.securityPolicyManifest
    )
  }
  return paths.sort((left, right) => left.localeCompare(right, 'en'))
}

export function createSupabaseDataPlan(context: BackendProviderAdapterContext) {
  const model = context.application.dataModel
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-data-plan.v1',
      version: 1,
      applicationId: context.application.applicationId,
      model,
      modelDigest: digestCanonicalBackendValue(model, '$.dataModel'),
      managedEntities: model.entities
        .filter((entry) => entry.management === 'managed')
        .map((entry) => entry.id),
      externalEntities: model.entities
        .filter((entry) => entry.management === 'external')
        .map((entry) => entry.id),
      storagePolicy: hasIncludedCapability(context, 'storage.objects')
        ? 'explicit-policy-review-required'
        : 'not-requested'
    },
    '$.supabase.dataPlan'
  )
}

export function emitSupabaseDataArtifacts(
  context: BackendProviderAdapterContext
): readonly BackendArtifactSource[] {
  const model = context.application.dataModel
  return Object.freeze([
    jsonArtifact(SUPABASE_ARTIFACT_PATHS.clientConfig, 'client-config', {
      format: 'openpencil.supabase-client-config.v1',
      version: 1,
      providerId: 'supabase',
      schema: 'public',
      endpointSource: 'environment-only',
      credentialSource: 'environment-only',
      environment: requiredEnvironment(context.application)
        .filter((entry) => entry.exposure === 'client-public')
        .map((entry) => ({ name: entry.name, required: entry.required, exposure: entry.exposure }))
    }),
    Object.freeze({
      path: SUPABASE_ARTIFACT_PATHS.clientTypes,
      kind: 'client-config',
      mediaType: 'text/typescript; charset=utf-8',
      content: emitSupabaseDatabaseTypes(model)
    }),
    jsonArtifact(SUPABASE_ARTIFACT_PATHS.databaseSchema, 'database-schema', {
      format: 'openpencil.supabase-database-schema.v1',
      version: 1,
      providerId: 'supabase',
      schema: 'public',
      source: 'explicit-data-model-ir',
      modelDigest: digestCanonicalBackendValue(model, '$.dataModel'),
      model,
      management: {
        managed: 'migration-proposal-eligible-after-remote-inspection',
        external: 'inspect-only-never-created-or-altered'
      }
    })
  ])
}

export function createSupabaseMigrationPlan(context: BackendProviderAdapterContext) {
  const model = context.application.dataModel
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-migration-proposal.v1',
      version: 1,
      applicationId: context.application.applicationId,
      targetModelDigest: digestCanonicalBackendValue(model, '$.dataModel'),
      targetModel: model,
      currentModel: 'remote-inspection-required',
      operations: [],
      highestRisk: 'unknown-until-remote-diff',
      applyAllowed: false,
      releaseReady: false,
      requiredReview: [
        'inspect-current-remote-schema',
        'compute-deterministic-model-diff',
        'classify-destructive-and-data-rewrite-risk',
        'confirm-backup-before-destructive-operations'
      ]
    },
    '$.supabase.migrationPlan'
  )
}

export function emitSupabaseMigrationArtifact(
  context: BackendProviderAdapterContext
): readonly BackendArtifactSource[] {
  return Object.freeze([
    jsonArtifact(
      SUPABASE_ARTIFACT_PATHS.migrationPlan,
      'migration-plan',
      createSupabaseMigrationPlan(context)
    )
  ])
}

export function createSupabaseServerPlan(context: BackendProviderAdapterContext) {
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-server-runtime.v1',
      version: 1,
      applicationId: context.application.applicationId,
      runtime: 'declarative-reviewed-adapter-required',
      auth: 'caller-user-rls',
      workflows: context.application.workflows,
      environment: environmentNames(context.application),
      privilegedCredentialAllowed: false,
      outboundHttp: hasIncludedCapability(context, 'server.http')
        ? 'explicit-host-policy-required'
        : 'not-requested'
    },
    '$.supabase.serverPlan'
  )
}

export function createSupabaseDeploymentManifest(context: BackendProviderAdapterContext) {
  const application = context.application
  const externalEntities = application.dataModel.entities
    .filter((entry) => entry.management === 'external')
    .map((entry) => entry.id)
  const checks = [
    'remote-schema-inspection',
    'migration-risk-review',
    'all-exposed-table-rls-verification',
    'data-api-exposure-review',
    'environment-resolution'
  ]
  if (externalEntities.length > 0) checks.push('external-table-authority-and-rls-verification')
  if (hasIncludedCapability(context, 'server.functions')) {
    checks.push('reviewed-edge-runtime-generation', 'authenticated-caller-rls-test')
  }
  if (hasIncludedCapability(context, 'server.http')) checks.push('outbound-http-policy-review')
  if (hasIncludedCapability(context, 'storage.objects')) {
    checks.push('storage-bucket-and-rls-policy-review', 'storage-upsert-select-insert-update-test')
  }
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-deployment-manifest.v1',
      version: 1,
      providerId: 'supabase',
      applicationId: application.applicationId,
      target: context.target,
      mode: context.mode,
      releaseReady: false,
      applyAuthority: 'host-release-controller-only',
      commandAuthority: 'host-owned-no-command-embedded',
      dataApiExposure: 'explicit-review-required',
      environment: requiredEnvironment(application).map((entry) => ({
        kind: entry.kind,
        name: entry.name,
        exposure: entry.exposure,
        required: entry.required
      })),
      artifacts: plannedArtifactPaths(context),
      externalEntities,
      requiredChecks: checks,
      storageUpsertPolicyOperations: ['select', 'insert', 'update'],
      instructions: [
        'Inspect the current remote schema before computing any migration operations.',
        'Review the proposed schema and row-level policies without applying them automatically.',
        'Resolve environment references only inside the trusted deployment host.',
        'Run anonymous, owner, second-user, cross-tenant, mutation, function, and storage negative tests.',
        'Record the live verification evidence before the host release controller may deploy.'
      ]
    },
    '$.supabase.deploymentManifest'
  )
}

export function emitSupabaseServerArtifacts(
  context: BackendProviderAdapterContext
): readonly BackendArtifactSource[] {
  return Object.freeze([
    jsonArtifact(
      SUPABASE_ARTIFACT_PATHS.serverRuntime,
      'server-runtime',
      createSupabaseServerPlan(context)
    ),
    jsonArtifact(
      SUPABASE_ARTIFACT_PATHS.deploymentManifest,
      'deployment-manifest',
      createSupabaseDeploymentManifest(context)
    )
  ])
}
