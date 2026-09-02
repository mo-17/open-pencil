import {
  canonicalBackendValue,
  digestCanonicalBackendValue,
  freezeBackendValue
} from '#compiler/backend/canonical'

import { digestDataModel, type DataModelIR } from '@open-pencil/lowcode/backend'

import {
  SUPABASE_INSPECTED_SCHEMA_FORMAT,
  SUPABASE_INSPECTED_SCHEMA_VERSION,
  type CreateSupabaseInspectedMigrationSnapshotInputV1,
  type SupabaseInspectedMigrationSnapshotV1,
  type SupabaseInspectionColumnV1,
  type SupabaseInspectionConstraintV1,
  type SupabaseInspectionCoverageV1,
  type SupabaseInspectionDefaultPrivilegeV1,
  type SupabaseInspectionIndexV1,
  type SupabaseInspectionObjectV1,
  type SupabaseInspectionPolicyV1,
  type SupabaseInspectionPrivilegeV1,
  type SupabaseInspectionProvenanceV1,
  type SupabaseInspectionRoleMembershipV1,
  type SupabaseInspectionRoleV1
} from './contract'
import { normalizeSupabaseInspectionInput } from './parser'
import { exactRecord, invalid, schema, validateDigest } from './primitives'

export { SUPABASE_INSPECTED_SCHEMA_FORMAT, SUPABASE_INSPECTED_SCHEMA_VERSION } from './contract'
export {
  formatSupabaseManagedMarker,
  parseSupabaseManagedMarker,
  SUPABASE_MANAGED_MARKER_KINDS,
  SUPABASE_MANAGED_MARKER_PREFIX,
  type SupabaseManagedMarkerKind,
  type SupabaseManagedMarkerV1
} from './marker'
export { deriveSupabaseManagedDataModel, type SupabaseManagedModelInventory } from './managed-model'
export type {
  CreateSupabaseInspectedMigrationSnapshotInputV1,
  SupabaseInspectedMigrationSnapshotV1,
  SupabaseInspectionCheckConstraintV1,
  SupabaseInspectionColumnDefaultV1,
  SupabaseInspectionColumnV1,
  SupabaseInspectionConstraintV1,
  SupabaseInspectionCoverageKey,
  SupabaseInspectionCoverageV1,
  SupabaseInspectionDefaultPrivilegeObjectKind,
  SupabaseInspectionDefaultPrivilegeV1,
  SupabaseInspectionEnumObjectV1,
  SupabaseInspectionForeignKeyConstraintV1,
  SupabaseInspectionFunctionObjectV1,
  SupabaseInspectionIndexV1,
  SupabaseInspectionInventorySource,
  SupabaseInspectionObjectKind,
  SupabaseInspectionObjectManagement,
  SupabaseInspectionObjectV1,
  SupabaseInspectionPolicyV1,
  SupabaseInspectionPrimaryKeyConstraintV1,
  SupabaseInspectionPrivilege,
  SupabaseInspectionPrivilegeObjectKind,
  SupabaseInspectionPrivilegeV1,
  SupabaseInspectionProvenanceV1,
  SupabaseInspectionRoleMembershipV1,
  SupabaseInspectionRoleV1,
  SupabaseInspectionSequenceObjectV1,
  SupabaseInspectionTableObjectV1,
  SupabaseInspectionUniqueConstraintV1,
  SupabaseInspectionViewObjectV1
} from './contract'

export async function createSupabaseInspectedMigrationSnapshot(
  input: CreateSupabaseInspectedMigrationSnapshotInputV1
): Promise<SupabaseInspectedMigrationSnapshotV1> {
  const normalized = normalizeSupabaseInspectionInput(input)
  const currentModelDigest = await digestDataModel(normalized.currentModel)
  const objectPrivilegeDigest = digestCanonicalBackendValue(
    {
      format: 'openpencil.supabase-inspected-inventory.v1',
      version: 1,
      providerId: 'supabase',
      schema: 'public',
      provenance: normalized.provenance,
      coverage: normalized.coverage,
      objects: normalized.objects,
      columns: normalized.columns,
      constraints: normalized.constraints,
      indexes: normalized.indexes,
      roles: normalized.roles,
      roleMemberships: normalized.roleMemberships,
      policies: normalized.policies,
      privileges: normalized.privileges,
      defaultPrivileges: normalized.defaultPrivileges
    },
    '$.supabaseInspectedInventory'
  )
  const inspectedSchemaDigest = digestCanonicalBackendValue(
    {
      format: SUPABASE_INSPECTED_SCHEMA_FORMAT,
      version: SUPABASE_INSPECTED_SCHEMA_VERSION,
      providerId: 'supabase',
      schema: 'public',
      currentModelDigest,
      objectPrivilegeDigest
    },
    '$.supabaseInspectedSchemaDigest'
  )
  return freezeBackendValue({
    format: SUPABASE_INSPECTED_SCHEMA_FORMAT,
    version: SUPABASE_INSPECTED_SCHEMA_VERSION,
    providerId: 'supabase',
    schema: 'public',
    ...normalized,
    currentModelDigest,
    objectPrivilegeDigest,
    inspectedSchemaDigest
  }) as SupabaseInspectedMigrationSnapshotV1
}

export async function parseSupabaseInspectedMigrationSnapshot(
  value: unknown
): Promise<SupabaseInspectedMigrationSnapshotV1> {
  const canonical = canonicalBackendValue(value, '$.supabaseInspectedSchema')
  const source = exactRecord(canonical, '$', [
    'format',
    'version',
    'providerId',
    'schema',
    'provenance',
    'currentModel',
    'coverage',
    'objects',
    'columns',
    'constraints',
    'indexes',
    'roles',
    'roleMemberships',
    'policies',
    'privileges',
    'defaultPrivileges',
    'currentModelDigest',
    'objectPrivilegeDigest',
    'inspectedSchemaDigest'
  ])
  if (source.format !== SUPABASE_INSPECTED_SCHEMA_FORMAT) {
    invalid('$.format', 'unsupported inspected schema format')
  }
  if (source.version !== SUPABASE_INSPECTED_SCHEMA_VERSION) {
    invalid('$.version', 'unsupported inspected schema version')
  }
  if (source.providerId !== 'supabase') invalid('$.providerId', 'provider must be supabase')
  schema(source.schema, '$.schema')
  const declaredCurrent = validateDigest(source.currentModelDigest, '$.currentModelDigest')
  const declaredInventory = validateDigest(source.objectPrivilegeDigest, '$.objectPrivilegeDigest')
  const declaredInspection = validateDigest(source.inspectedSchemaDigest, '$.inspectedSchemaDigest')
  const computed = await createSupabaseInspectedMigrationSnapshot({
    provenance: source.provenance as SupabaseInspectionProvenanceV1,
    currentModel: source.currentModel as DataModelIR,
    coverage: source.coverage as SupabaseInspectionCoverageV1,
    objects: source.objects as SupabaseInspectionObjectV1[],
    columns: source.columns as SupabaseInspectionColumnV1[],
    constraints: source.constraints as SupabaseInspectionConstraintV1[],
    indexes: source.indexes as SupabaseInspectionIndexV1[],
    roles: source.roles as SupabaseInspectionRoleV1[],
    roleMemberships: source.roleMemberships as SupabaseInspectionRoleMembershipV1[],
    policies: source.policies as SupabaseInspectionPolicyV1[],
    privileges: source.privileges as SupabaseInspectionPrivilegeV1[],
    defaultPrivileges: source.defaultPrivileges as SupabaseInspectionDefaultPrivilegeV1[]
  })
  if (declaredCurrent !== computed.currentModelDigest) {
    invalid('$.currentModelDigest', 'digest does not match the normalized current DataModelIR')
  }
  if (declaredInventory !== computed.objectPrivilegeDigest) {
    invalid('$.objectPrivilegeDigest', 'digest does not match the complete live inventory')
  }
  if (declaredInspection !== computed.inspectedSchemaDigest) {
    invalid('$.inspectedSchemaDigest', 'digest does not bind the model and inventory digests')
  }
  return computed
}
