export const BACKEND_APPLICATION_SPEC_VERSION = 1 as const
export const DATA_MODEL_IR_VERSION = 1 as const
export const AUTH_POLICY_IR_VERSION = 1 as const
export const BACKEND_WORKFLOW_IR_VERSION = 1 as const
export const MIGRATION_PLAN_VERSION = 1 as const

export type BackendCapability =
  | 'data.read'
  | 'data.write'
  | 'auth.identity'
  | 'auth.roles'
  | 'policy.row-level'
  | 'server.functions'
  | 'server.http'
  | 'storage.objects'
  | 'migrations.schema'
  | 'migrations.data'
  | 'realtime.subscribe'
  | 'transactions.atomic'

export interface BackendCapabilityRequirement {
  capability: BackendCapability
  required: boolean
  reason?: string
}

export type BackendDiagnosticSeverity = 'error' | 'warning' | 'info'

export interface BackendDiagnostic {
  code: string
  severity: BackendDiagnosticSeverity
  path: string
  message: string
}

export type BackendFieldScalarType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'json'
  | 'bytes'

export type BackendLiteral = string | number | boolean | null

export type BackendFieldDefault =
  | { kind: 'literal'; value: BackendLiteral }
  | { kind: 'generated'; generator: 'uuid' | 'identity' | 'created-at' | 'updated-at' }

export interface DataFieldIR {
  id: string
  name: string
  type: BackendFieldScalarType | 'enum'
  enumId?: string
  nullable: boolean
  default?: BackendFieldDefault
}

export interface DataPrimaryKeyIR {
  fields: string[]
}

export interface DataForeignKeyIR {
  id: string
  fields: string[]
  targetEntityId: string
  targetFields: string[]
  onDelete: 'restrict' | 'cascade' | 'set-null' | 'no-action'
}

export interface DataIndexIR {
  id: string
  fields: string[]
  order?: 'asc' | 'desc'
}

export interface DataUniqueIR {
  id: string
  fields: string[]
}

export interface DataEntityIR {
  id: string
  name: string
  management: 'managed' | 'external'
  fields: DataFieldIR[]
  primaryKey?: DataPrimaryKeyIR
  foreignKeys?: DataForeignKeyIR[]
  indexes?: DataIndexIR[]
  uniques?: DataUniqueIR[]
}

export type DataEnumIR = Pick<DataEntityIR, 'id' | 'name'> & {
  values: string[]
}

export interface DataRelationIR {
  id: string
  kind: 'one-to-one' | 'one-to-many' | 'many-to-many'
  sourceEntityId: string
  targetEntityId: string
  sourceForeignKeyId?: string
  targetForeignKeyId?: string
  junctionEntityId?: string
}

export interface DataModelIR {
  version: typeof DATA_MODEL_IR_VERSION
  entities: DataEntityIR[]
  enums: DataEnumIR[]
  relations: DataRelationIR[]
}

export interface AuthIdentityIR {
  id: string
  kind: 'anonymous' | 'user' | 'service'
}

export type AuthRoleIR = Pick<DataEnumIR, 'id' | 'name'>

export interface AuthOwnershipIR {
  id: string
  entityId: string
  identityFieldId: string
}

export interface AuthTenantIR {
  id: string
  entityId: string
  tenantFieldId: string
  membershipEntityId?: string
  membershipIdentityFieldId?: string
  membershipTenantFieldId?: string
}

export type AuthAccessOperation = 'select' | 'insert' | 'update' | 'delete'

export type AuthPrincipalIntent =
  | { kind: 'anonymous' }
  | { kind: 'authenticated' }
  | { kind: 'role'; roleId: string }
  | { kind: 'owner'; ownershipId: string }
  | { kind: 'tenant-member'; tenantId: string }

export interface AuthRowAccessIntentIR {
  id: string
  entityId: string
  effect: 'allow' | 'deny'
  operations: AuthAccessOperation[]
  principal: AuthPrincipalIntent
}

export interface AuthPolicyIR {
  version: typeof AUTH_POLICY_IR_VERSION
  identities: AuthIdentityIR[]
  roles: AuthRoleIR[]
  ownership: AuthOwnershipIR[]
  tenants: AuthTenantIR[]
  rowAccess: AuthRowAccessIntentIR[]
}

export type BackendValueSource =
  | { kind: 'expression'; expression: string }
  | { kind: 'environment'; name: string }

export interface BackendDataFilterIR {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in'
  value: BackendValueSource
}

export interface BackendDataValueIR {
  field: string
  value: BackendValueSource
}

export interface BackendHttpHeaderIR {
  name: string
  value: BackendValueSource
}

export type BackendWorkflowStepIR =
  | {
      id: string
      kind: 'data.read'
      entityId: string
      resultName: string
      fields?: string[]
      filters?: BackendDataFilterIR[]
      single?: boolean
    }
  | {
      id: string
      kind: 'data.mutate'
      entityId: string
      operation: 'insert' | 'update' | 'delete' | 'upsert'
      values?: BackendDataValueIR[]
      filters?: BackendDataFilterIR[]
      resultName?: string
    }
  | {
      id: string
      kind: 'http.request'
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      url: BackendValueSource
      headers?: BackendHttpHeaderIR[]
      body?: BackendValueSource
      resultName?: string
    }
  | {
      id: string
      kind: 'branch'
      condition: string
      consequent: BackendWorkflowStepIR[]
      alternate: BackendWorkflowStepIR[]
    }
  | { id: string; kind: 'respond'; value?: string; status?: number }
  | { id: string; kind: 'call'; workflowId: string }

export interface BackendWorkflowDefinitionIR {
  id: string
  name: string
  trigger: { kind: 'http'; method: 'POST'; access: 'authenticated' }
  parameters: string[]
  steps: BackendWorkflowStepIR[]
}

export interface BackendWorkflowIR {
  version: typeof BACKEND_WORKFLOW_IR_VERSION
  workflows: BackendWorkflowDefinitionIR[]
}

export type BackendCredentialRef = `credential.${string}-${string}-${string}-${string}-${string}`

export type BackendSecretRef =
  | {
      kind: 'environment'
      name: string
      exposure: 'server' | 'client-public'
      required: boolean
    }
  | {
      kind: 'credential'
      credentialRef: BackendCredentialRef
      name: string
      exposure: 'host' | 'server'
      required: boolean
    }

export interface BackendApplicationSpecV1 {
  format: 'openpencil.backend-application'
  version: typeof BACKEND_APPLICATION_SPEC_VERSION
  applicationId: string
  dataModel: DataModelIR
  auth: AuthPolicyIR
  workflows: BackendWorkflowIR
  capabilities: BackendCapabilityRequirement[]
  secrets: BackendSecretRef[]
}

export type MigrationRiskLevel = 'low' | 'medium' | 'high' | 'destructive'

export type MigrationOperation =
  | { id: string; kind: 'create-enum'; enum: DataEnumIR }
  | { id: string; kind: 'drop-enum'; enumId: string }
  | { id: string; kind: 'add-enum-value'; enumId: string; value: string }
  | { id: string; kind: 'drop-enum-value'; enumId: string; value: string }
  | { id: string; kind: 'create-entity'; entity: DataEntityIR }
  | { id: string; kind: 'drop-entity'; entityId: string }
  | { id: string; kind: 'rename-entity'; entityId: string; nextName: string }
  | { id: string; kind: 'add-field'; entityId: string; field: DataFieldIR }
  | { id: string; kind: 'drop-field'; entityId: string; fieldId: string }
  | { id: string; kind: 'rename-field'; entityId: string; fieldId: string; nextName: string }
  | {
      id: string
      kind: 'alter-field'
      entityId: string
      fieldId: string
      change: 'widen-type' | 'narrow-type' | 'set-not-null' | 'drop-not-null' | 'change-default'
      nextField: DataFieldIR
    }
  | { id: string; kind: 'add-primary-key'; entityId: string; fields: string[] }
  | { id: string; kind: 'drop-primary-key'; entityId: string }
  | { id: string; kind: 'add-foreign-key'; entityId: string; foreignKey: DataForeignKeyIR }
  | { id: string; kind: 'drop-foreign-key'; entityId: string; foreignKeyId: string }
  | { id: string; kind: 'add-unique'; entityId: string; unique: DataUniqueIR }
  | { id: string; kind: 'drop-unique'; entityId: string; uniqueId: string }
  | { id: string; kind: 'add-index'; entityId: string; index: DataIndexIR }
  | { id: string; kind: 'drop-index'; entityId: string; indexId: string }
  | { id: string; kind: 'rewrite-data'; entityId: string; reason: string }

export interface MigrationPlanOperation {
  operation: MigrationOperation
  risk: MigrationRiskLevel
  reason: string
}

export interface MigrationPlan {
  version: typeof MIGRATION_PLAN_VERSION
  planId: string
  fromModelDigest?: string
  targetModelDigest: string
  operations: MigrationPlanOperation[]
  highestRisk: MigrationRiskLevel
  requiresBackup: boolean
}

export type BackendValidationResult<T> =
  | { ok: true; value: T; diagnostics: BackendDiagnostic[] }
  | { ok: false; diagnostics: BackendDiagnostic[] }
