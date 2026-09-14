export const BACKEND_APPLICATION_SPEC_VERSION = 1 as const
export const DATA_MODEL_IR_VERSION = 1 as const
export const AUTH_POLICY_IR_VERSION = 1 as const
export const BACKEND_WORKFLOW_IR_VERSION = 1 as const
export const BACKEND_STORAGE_IR_VERSION = 1 as const
export const BACKEND_HTTP_API_IR_VERSION = 1 as const
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

/** A fixed equality predicate, ANDed with its principal; never a caller-controlled filter. */
export interface AuthRowConditionIR {
  fieldId: string
  value: string | number | boolean | null
}

/** Bounded membership lookup. Identity always comes from the verified subject. */
export interface AuthRelatedMemberPrincipalIR {
  kind: 'related-member'
  entityFieldId: string
  membershipEntityId: string
  membershipFieldId: string
  identityFieldId: string
  conditions?: AuthRowConditionIR[]
  roleId?: string
}

export type AuthPrincipalIntent =
  | { kind: 'anonymous' }
  | { kind: 'authenticated' }
  | { kind: 'role'; roleId: string }
  | { kind: 'owner'; ownershipId: string }
  | { kind: 'tenant-member'; tenantId: string; roleId?: string }
  | AuthRelatedMemberPrincipalIR

export interface AuthRowAccessIntentIR {
  id: string
  entityId: string
  effect: 'allow' | 'deny'
  operations: AuthAccessOperation[]
  principal: AuthPrincipalIntent
  conditions?: AuthRowConditionIR[]
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

export type BackendStorageOperation = 'read' | 'create' | 'update' | 'delete' | 'upsert'

/**
 * Storage paths are partitioned immediately after a bounded literal prefix.
 * For example, prefix ["users"] + owner means users/<auth-user-id>/... .
 */
export type BackendStoragePrincipalIntent =
  | { kind: 'owner' }
  | { kind: 'tenant-member'; tenantId: string }

export interface BackendStoragePathRuleIR {
  id: string
  prefix: string[]
  principal: BackendStoragePrincipalIntent
  operations: BackendStorageOperation[]
}

export interface BackendStorageBucketIR {
  id: string
  name: string
  access: 'private' | 'public-read'
  maxObjectBytes: number
  allowedMimeTypes: string[]
  pathRules: BackendStoragePathRuleIR[]
}

export interface BackendStorageIR {
  version: typeof BACKEND_STORAGE_IR_VERSION
  buckets: BackendStorageBucketIR[]
}

export type BackendHttpAPIOperation = 'list' | 'read' | 'create' | 'update' | 'delete'
export type BackendHttpAPIJWTAlgorithm = 'RS256' | 'ES256'

/** References required server environment values; declaring these does not verify a JWT. */
export interface BackendHttpAPIAuthenticationIRV1 {
  kind: 'jwt'
  identityId: string
  issuerEnvironment: string
  audienceEnvironment: string
  jwksUrlEnvironment: string
  algorithms: BackendHttpAPIJWTAlgorithm[]
}

/** Field IDs inherit their types and nullability from the referenced DataModel entity. */
export interface BackendHttpAPIQueryIRV1 {
  filterFields: string[]
  searchFields: string[]
  sortFields: string[]
}

export interface BackendHttpAPIResourceIRV1 {
  id: string
  path: string
  entityId: string
  operations: BackendHttpAPIOperation[]
  readFields: string[]
  /** Optional nonempty subset of existing same-entity allow/select policies; never grants authority. */
  readPolicyIds?: string[]
  createFields?: string[]
  updateFields?: string[]
  maxPageSize?: number
  /** Explicit list-only field allowlists; never row authorization predicates. */
  query?: BackendHttpAPIQueryIRV1
}

/** Explicit authenticated CRUD exposure intent, independent of a server framework or ORM. */
export interface BackendHttpAPIIRV1 {
  version: typeof BACKEND_HTTP_API_IR_VERSION
  authentication: BackendHttpAPIAuthenticationIRV1
  resources: BackendHttpAPIResourceIRV1[]
  /** Optional public browser login and same-origin API mounting configuration. */
  browserClient?: BackendHttpAPIBrowserClientIRV1
}

export const BACKEND_OIDC_CALLBACK_PATH = '/_openpencil/auth/callback' as const

export interface BackendHttpAPIOIDCAuthenticationIRV1 {
  kind: 'oidc-pkce'
  issuer: string
  clientId: string
  scopes: string[]
  callbackPath: string
  resource?: string
}

export interface BackendHttpAPIBrowserClientIRV1 {
  version: 1
  apiBasePath: string
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
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
  /** Optional for backwards-compatible Backend application v1 documents. */
  storage?: BackendStorageIR
  /** Omitted in existing documents so their canonical bytes remain unchanged. */
  httpApi?: BackendHttpAPIIRV1
  /** Omitted in existing documents; explicit bounded server commands are a separate authority. */
  commands?: BackendCommandIRV1
  /** Closed commerce semantics. Omitted from existing documents and their canonical bytes. */
  commerce?: BackendCommerceIRV1
  /** Optional reviewed partition for a modular single-process backend; grants no authority. */
  modules?: BackendModuleIRV1
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
import type { BackendCommandIRV1 } from './commands/types'
import type { BackendCommerceIRV1 } from './commerce/types'
import type { BackendModuleIRV1 } from './modules/types'
