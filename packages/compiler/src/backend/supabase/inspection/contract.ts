import type {
  BackendFieldDefault,
  BackendFieldScalarType,
  DataModelIR
} from '@open-pencil/lowcode/backend'

export const SUPABASE_INSPECTED_SCHEMA_FORMAT = 'openpencil.supabase-inspected-schema.v1' as const
export const SUPABASE_INSPECTED_SCHEMA_VERSION = 1 as const

export const INSPECTION_COVERAGE_KEYS = [
  'schemas',
  'tables',
  'columns',
  'enums',
  'constraints',
  'indexes',
  'sequences',
  'views',
  'functions',
  'roles',
  'roleMemberships',
  'rls',
  'policies',
  'privileges'
] as const

export const INSPECTION_OBJECT_KINDS = ['table', 'enum', 'sequence', 'view', 'function'] as const
export const INSPECTION_PRIVILEGE_OBJECT_KINDS = ['schema', ...INSPECTION_OBJECT_KINDS] as const
export const INSPECTION_DEFAULT_PRIVILEGE_OBJECT_KINDS = [
  'table',
  'sequence',
  'function',
  'type',
  'schema'
] as const
export const INSPECTION_OBJECT_MANAGEMENT = ['managed', 'external', 'unbound'] as const
export const INSPECTION_POLICY_COMMANDS = ['all', 'select', 'insert', 'update', 'delete'] as const
export const INSPECTION_POLICY_MODES = ['permissive', 'restrictive'] as const
export const INSPECTION_INVENTORY_SOURCES = ['openpencil', 'third-party', 'unknown'] as const
export const INSPECTION_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'USAGE',
  'EXECUTE',
  'CREATE',
  'CONNECT',
  'TEMPORARY'
] as const
export const INSPECTION_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'uuid',
  'json',
  'bytes',
  'enum'
] as const
export const INSPECTION_GENERATED_DEFAULTS = [
  'uuid',
  'identity',
  'created-at',
  'updated-at'
] as const
export const INSPECTION_CONSTRAINT_KINDS = [
  'primary-key',
  'unique',
  'foreign-key',
  'check'
] as const
export const INSPECTION_FK_ACTIONS = ['restrict', 'cascade', 'set-null', 'no-action'] as const

export type SupabaseInspectionCoverageKey = (typeof INSPECTION_COVERAGE_KEYS)[number]
export type SupabaseInspectionObjectKind = (typeof INSPECTION_OBJECT_KINDS)[number]
export type SupabaseInspectionPrivilegeObjectKind =
  (typeof INSPECTION_PRIVILEGE_OBJECT_KINDS)[number]
export type SupabaseInspectionDefaultPrivilegeObjectKind =
  (typeof INSPECTION_DEFAULT_PRIVILEGE_OBJECT_KINDS)[number]
export type SupabaseInspectionObjectManagement = (typeof INSPECTION_OBJECT_MANAGEMENT)[number]
export type SupabaseInspectionInventorySource = (typeof INSPECTION_INVENTORY_SOURCES)[number]
export type SupabaseInspectionPrivilege = (typeof INSPECTION_PRIVILEGES)[number]

export type SupabaseInspectionCoverageV1 = Readonly<
  Record<SupabaseInspectionCoverageKey, 'complete'>
>

interface SupabaseInspectionObjectBaseV1 {
  readonly kind: SupabaseInspectionObjectKind
  readonly schema: 'public'
  readonly name: string
  readonly management: SupabaseInspectionObjectManagement
}

export interface SupabaseInspectionTableObjectV1 extends SupabaseInspectionObjectBaseV1 {
  readonly kind: 'table'
  readonly openPencilId?: string
  readonly rlsEnabled: boolean
  readonly rlsForced: boolean
}

export interface SupabaseInspectionEnumObjectV1 extends SupabaseInspectionObjectBaseV1 {
  readonly kind: 'enum'
  readonly openPencilId?: string
  readonly values: readonly string[]
}

export interface SupabaseInspectionSequenceObjectV1 extends SupabaseInspectionObjectBaseV1 {
  readonly kind: 'sequence'
  readonly ownedBy?: Readonly<{ entityId: string; fieldId: string }>
}

export interface SupabaseInspectionViewObjectV1 extends SupabaseInspectionObjectBaseV1 {
  readonly kind: 'view'
  readonly management: 'external' | 'unbound'
  readonly securityInvoker: boolean
}

export interface SupabaseInspectionFunctionObjectV1 extends SupabaseInspectionObjectBaseV1 {
  readonly kind: 'function'
  readonly management: 'external' | 'unbound'
  readonly securityDefiner: boolean
}

export type SupabaseInspectionObjectV1 =
  | SupabaseInspectionTableObjectV1
  | SupabaseInspectionEnumObjectV1
  | SupabaseInspectionSequenceObjectV1
  | SupabaseInspectionViewObjectV1
  | SupabaseInspectionFunctionObjectV1

export interface SupabaseInspectionPolicyV1 {
  readonly schema: 'public'
  readonly tableName: string
  readonly name: string
  readonly command: (typeof INSPECTION_POLICY_COMMANDS)[number]
  readonly mode: (typeof INSPECTION_POLICY_MODES)[number]
  readonly roles: readonly string[]
  readonly source: SupabaseInspectionInventorySource
  readonly usingExpressionDigest: string | null
  readonly withCheckExpressionDigest: string | null
}

export interface SupabaseInspectionRoleV1 {
  readonly roleName: string
  readonly superuser: boolean
  readonly bypassRls: boolean
  readonly inherit: boolean
}

export interface SupabaseInspectionRoleMembershipV1 {
  readonly roleName: string
  readonly memberName: string
  readonly grantorName: string
  readonly adminOption: boolean
  readonly inheritOption: boolean
  readonly setOption: boolean
}

interface SupabaseInspectionPrivilegeBaseV1 {
  readonly schema: 'public'
  readonly grantor: string
  readonly grantee: string
  readonly privilege: SupabaseInspectionPrivilege
  readonly isGrantable: boolean
  readonly source: SupabaseInspectionInventorySource
}

export type SupabaseInspectionPrivilegeV1 =
  | (SupabaseInspectionPrivilegeBaseV1 & Readonly<{ objectKind: 'schema'; objectName: 'public' }>)
  | (SupabaseInspectionPrivilegeBaseV1 &
      Readonly<{ objectKind: SupabaseInspectionObjectKind; objectName: string }>)

export interface SupabaseInspectionProvenanceV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly querySchemaVersion: string
  readonly databaseRole: string
  readonly observedAt: string
  readonly completeness: 'complete'
  readonly truncated: false
}

export type SupabaseInspectionColumnDefaultV1 =
  | BackendFieldDefault
  | Readonly<{ kind: 'unbound'; expressionDigest: string }>
  | null

export interface SupabaseInspectionColumnV1 {
  readonly schema: 'public'
  readonly tableName: string
  readonly name: string
  /** Digest-bound negative evidence from pg_attribute.attacl; any positive value is rejected. */
  readonly columnPrivilegesPresent: false
  readonly management: SupabaseInspectionObjectManagement
  readonly openPencilFieldId?: string
  readonly type: BackendFieldScalarType | 'enum'
  readonly enumName?: string
  readonly nullable: boolean
  readonly default: SupabaseInspectionColumnDefaultV1
}

interface SupabaseInspectionConstraintBaseV1 {
  readonly schema: 'public'
  readonly tableName: string
  readonly name: string
  readonly management: SupabaseInspectionObjectManagement
  readonly openPencilId?: string
  readonly kind: (typeof INSPECTION_CONSTRAINT_KINDS)[number]
}

export interface SupabaseInspectionPrimaryKeyConstraintV1 extends SupabaseInspectionConstraintBaseV1 {
  readonly kind: 'primary-key'
  readonly fields: readonly string[]
}

export interface SupabaseInspectionUniqueConstraintV1 extends SupabaseInspectionConstraintBaseV1 {
  readonly kind: 'unique'
  readonly fields: readonly string[]
}

export interface SupabaseInspectionForeignKeyConstraintV1 extends SupabaseInspectionConstraintBaseV1 {
  readonly kind: 'foreign-key'
  readonly fields: readonly string[]
  readonly targetTableName: string
  readonly targetFields: readonly string[]
  readonly onDelete: (typeof INSPECTION_FK_ACTIONS)[number]
}

export interface SupabaseInspectionCheckConstraintV1 extends SupabaseInspectionConstraintBaseV1 {
  readonly kind: 'check'
  readonly management: 'external' | 'unbound'
  readonly expressionDigest: string
}

export type SupabaseInspectionConstraintV1 =
  | SupabaseInspectionPrimaryKeyConstraintV1
  | SupabaseInspectionUniqueConstraintV1
  | SupabaseInspectionForeignKeyConstraintV1
  | SupabaseInspectionCheckConstraintV1

export interface SupabaseInspectionIndexV1 {
  readonly schema: 'public'
  readonly tableName: string
  readonly name: string
  readonly management: SupabaseInspectionObjectManagement
  readonly openPencilId?: string
  readonly fields: readonly Readonly<{ name: string; order: 'asc' | 'desc' }>[]
}

export interface SupabaseInspectionDefaultPrivilegeV1 {
  readonly schema: 'public'
  readonly objectKind: SupabaseInspectionDefaultPrivilegeObjectKind
  readonly grantor: string
  readonly grantee: string
  readonly privilege: SupabaseInspectionPrivilege
  readonly isGrantable: boolean
  readonly source: SupabaseInspectionInventorySource
}

export interface CreateSupabaseInspectedMigrationSnapshotInputV1 {
  readonly provenance: SupabaseInspectionProvenanceV1
  readonly currentModel: DataModelIR
  readonly coverage: SupabaseInspectionCoverageV1
  readonly objects: readonly SupabaseInspectionObjectV1[]
  readonly columns: readonly SupabaseInspectionColumnV1[]
  readonly constraints: readonly SupabaseInspectionConstraintV1[]
  readonly indexes: readonly SupabaseInspectionIndexV1[]
  readonly roles: readonly SupabaseInspectionRoleV1[]
  readonly roleMemberships: readonly SupabaseInspectionRoleMembershipV1[]
  readonly policies: readonly SupabaseInspectionPolicyV1[]
  readonly privileges: readonly SupabaseInspectionPrivilegeV1[]
  readonly defaultPrivileges: readonly SupabaseInspectionDefaultPrivilegeV1[]
}

export interface SupabaseInspectedMigrationSnapshotV1 extends CreateSupabaseInspectedMigrationSnapshotInputV1 {
  readonly format: typeof SUPABASE_INSPECTED_SCHEMA_FORMAT
  readonly version: typeof SUPABASE_INSPECTED_SCHEMA_VERSION
  readonly providerId: 'supabase'
  readonly schema: 'public'
  readonly currentModelDigest: string
  readonly objectPrivilegeDigest: string
  readonly inspectedSchemaDigest: string
}
