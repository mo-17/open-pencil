/* eslint-disable max-lines -- inspected migration security invariants share one strict snapshot/review fixture */
import { describe, expect, test } from 'bun:test'

import { digestCanonicalBackendValue } from '#compiler/backend/canonical'
import {
  createSupabaseInspectedMigrationSnapshot,
  digestSupabasePhysicalSchema,
  parseSupabaseInspectedMigrationSnapshot,
  type CreateSupabaseInspectedMigrationSnapshotInputV1,
  type SupabaseInspectedMigrationSnapshotV1
} from '#compiler/backend/supabase/inspection'
import {
  createSupabaseInspectedMigrationReview,
  type SupabaseMigrationReviewEnvironmentV1
} from '#compiler/backend/supabase/migration-review'
import { stableSQLName } from '#compiler/backend/supabase/migration-review/common'

import {
  STAGED_MIGRATION_EXECUTION_FORMAT,
  STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
  classifyStagedMigrationOperationRisk,
  planBackendMigration,
  type BackendApplicationSpecV1,
  type DataModelIR,
  type StagedMigrationExecutionPlanV1,
  type StagedMigrationExecutionReceiptV1,
  type StagedMigrationOperationV1
} from '@open-pencil/lowcode/backend'

const digestValue = (character: string): string => `${character.repeat(42)}A`

const COMPLETE_COVERAGE = {
  schemas: 'complete',
  tables: 'complete',
  columns: 'complete',
  enums: 'complete',
  constraints: 'complete',
  indexes: 'complete',
  sequences: 'complete',
  views: 'complete',
  functions: 'complete',
  roles: 'complete',
  roleMemberships: 'complete',
  rls: 'complete',
  policies: 'complete',
  storageBuckets: 'complete',
  storagePolicies: 'complete',
  privileges: 'complete'
} as const

const POSTGRES_INSPECTION_ROLE = {
  roleName: 'postgres',
  superuser: true,
  bypassRls: true,
  inherit: true
} as const

function emptyModel(): DataModelIR {
  return { version: 1, entities: [], enums: [], relations: [] }
}

function emptyInspection(
  overrides: Partial<CreateSupabaseInspectedMigrationSnapshotInputV1> = {}
): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  return {
    provenance: {
      projectRef: 'project-ref-1',
      accountId: 'account-1',
      querySchemaVersion: 'catalog-v1',
      databaseRole: 'postgres',
      observedAt: '2026-08-30T00:00:00.000Z',
      completeness: 'complete',
      truncated: false
    },
    currentModel: emptyModel(),
    coverage: COMPLETE_COVERAGE,
    objects: [],
    columns: [],
    constraints: [],
    indexes: [],
    roles: [
      POSTGRES_INSPECTION_ROLE,
      { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true }
    ],
    roleMemberships: [],
    policies: [],
    storageBuckets: [],
    storagePolicies: [],
    privileges: [],
    defaultPrivileges: [],
    ...overrides
  }
}

function ownerApplication(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'notes-app',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'id', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'title', name: 'title', type: 'string', nullable: true }
          ],
          primaryKey: { fields: ['id'] },
          indexes: [{ id: 'notes_owner_idx', fields: ['owner_id'] }]
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [{ id: 'note-owner', entityId: 'notes', identityFieldId: 'owner_id' }],
      tenants: [],
      rowAccess: [
        {
          id: 'owner-access',
          entityId: 'notes',
          effect: 'allow',
          operations: ['select', 'insert'],
          principal: { kind: 'owner', ownershipId: 'note-owner' }
        }
      ]
    },
    workflows: {
      version: 1,
      workflows: [
        {
          id: 'notes-flow',
          name: 'Notes flow',
          trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
          parameters: ['id', 'title'],
          steps: [
            { id: 'read-notes', kind: 'data.read', entityId: 'notes', resultName: 'notes' },
            {
              id: 'insert-note',
              kind: 'data.mutate',
              entityId: 'notes',
              operation: 'insert',
              values: [
                { field: 'id', value: { kind: 'expression', expression: 'id' } },
                {
                  field: 'owner_id',
                  value: { kind: 'expression', expression: '$currentUser.id' }
                },
                { field: 'title', value: { kind: 'expression', expression: 'title' } }
              ]
            },
            { id: 'respond', kind: 'respond', status: 204 }
          ]
        }
      ]
    },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: []
  }
}

function schemaApplication(dataModel: DataModelIR): BackendApplicationSpecV1 {
  const application = ownerApplication()
  application.dataModel = dataModel
  application.auth.ownership = []
  application.auth.tenants = []
  application.auth.rowAccess = []
  application.workflows.workflows = []
  application.capabilities = [{ capability: 'migrations.schema', required: true }]
  return application
}

function fixtureTypeOid(
  field: DataModelIR['entities'][number]['fields'][number],
  enumOid: string | undefined
): string {
  if (field.type === 'enum') return enumOid ?? '50000'
  return {
    string: '25',
    integer: '20',
    number: '701',
    boolean: '16',
    date: '1082',
    datetime: '1184',
    uuid: '2950',
    json: '3802',
    bytes: '17'
  }[field.type]
}

function requiredOID(values: ReadonlyMap<string, string>, id: string): string {
  const value = values.get(id)
  if (!value) throw new Error(`Missing fixture OID for ${id}`)
  return value
}

function inspectionForModel(
  currentModel: DataModelIR,
  overrides: Partial<CreateSupabaseInspectedMigrationSnapshotInputV1> = {}
): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  const managed = currentModel.entities.filter((entity) => entity.management === 'managed')
  const byId = new Map(currentModel.entities.map((entity) => [entity.id, entity]))
  const enumById = new Map(currentModel.enums.map((dataEnum) => [dataEnum.id, dataEnum]))
  const enumOids = new Map(
    currentModel.enums.map((dataEnum, index) => [dataEnum.id, String(50_000 + index)])
  )
  const tableOids = new Map(managed.map((entity, index) => [entity.id, String(60_000 + index)]))
  let constraintOid = 70_000
  let indexOid = 80_000
  return emptyInspection({
    currentModel,
    objects: [
      ...currentModel.enums.map((dataEnum) => ({
        kind: 'enum' as const,
        schema: 'public' as const,
        name: dataEnum.name,
        management: 'managed' as const,
        openPencilId: dataEnum.id,
        values: dataEnum.values,
        address: { classOid: '1247', objectOid: requiredOID(enumOids, dataEnum.id), subId: 0 }
      })),
      ...managed.map((entity) => ({
        kind: 'table' as const,
        schema: 'public' as const,
        name: entity.name,
        management: 'managed' as const,
        openPencilId: entity.id,
        address: {
          classOid: '1259',
          objectOid: requiredOID(tableOids, entity.id),
          subId: 0
        },
        rlsEnabled: true,
        rlsForced: true
      }))
    ],
    columns: managed.flatMap((entity) =>
      entity.fields.map((field, fieldIndex) => ({
        schema: 'public' as const,
        tableName: entity.name,
        name: field.name,
        columnPrivilegesPresent: false as const,
        management: 'managed' as const,
        openPencilFieldId: field.id,
        type: field.type,
        ...(field.type === 'enum' ? { enumName: enumById.get(field.enumId ?? '')?.name } : {}),
        nullable: field.nullable,
        default: field.default ?? null,
        address: {
          classOid: '1259',
          objectOid: requiredOID(tableOids, entity.id),
          subId: fieldIndex + 1
        },
        typeOid: fixtureTypeOid(field, enumOids.get(field.enumId ?? '')),
        defaultExpressionDigest: field.default ? digestValue('D') : null,
        identityKind:
          field.default?.kind === 'generated' && field.default.generator === 'identity' ? 'd' : '',
        generatedKind: '' as const
      }))
    ),
    constraints: managed.flatMap((entity) => {
      const fieldName = (fieldId: string): string =>
        entity.fields.find((field) => field.id === fieldId)?.name ?? fieldId
      return [
        ...(entity.primaryKey
          ? [
              {
                kind: 'primary-key' as const,
                schema: 'public' as const,
                tableName: entity.name,
                name: `live_pk_${entity.name}`,
                management: 'managed' as const,
                openPencilId: entity.id,
                fields: entity.primaryKey.fields.map(fieldName),
                address: { classOid: '2606', objectOid: String(constraintOid++), subId: 0 },
                definitionDigest: digestValue('C'),
                validated: true
              }
            ]
          : []),
        ...(entity.uniques ?? []).map((unique) => ({
          kind: 'unique' as const,
          schema: 'public' as const,
          tableName: entity.name,
          name: stableSQLName('fixture_uq', unique.id),
          management: 'managed' as const,
          openPencilId: unique.id,
          fields: unique.fields.map(fieldName),
          address: { classOid: '2606', objectOid: String(constraintOid++), subId: 0 },
          definitionDigest: digestValue('C'),
          validated: true
        })),
        ...(entity.foreignKeys ?? []).map((foreignKey) => {
          const target = byId.get(foreignKey.targetEntityId)
          if (!target) throw new Error('Foreign-key test fixture target is missing.')
          return {
            kind: 'foreign-key' as const,
            schema: 'public' as const,
            tableName: entity.name,
            name: stableSQLName('fixture_fk', foreignKey.id),
            management: 'managed' as const,
            openPencilId: foreignKey.id,
            fields: foreignKey.fields.map(fieldName),
            targetTableName: target.name,
            targetFields: foreignKey.targetFields.map(
              (fieldId) => target.fields.find((field) => field.id === fieldId)?.name ?? fieldId
            ),
            onDelete: foreignKey.onDelete,
            address: { classOid: '2606', objectOid: String(constraintOid++), subId: 0 },
            definitionDigest: digestValue('C'),
            validated: true
          }
        })
      ]
    }),
    indexes: managed.flatMap((entity) =>
      (entity.indexes ?? []).map((index) => ({
        schema: 'public' as const,
        tableName: entity.name,
        name: stableSQLName('fixture_idx', index.id),
        management: 'managed' as const,
        openPencilId: index.id,
        address: { classOid: '1259', objectOid: String(indexOid++), subId: 0 },
        definitionDigest: digestValue('I'),
        valid: true,
        ready: true,
        fields: index.fields.map((fieldId) => ({
          name: entity.fields.find((field) => field.id === fieldId)?.name ?? fieldId,
          order: index.order ?? ('asc' as const)
        }))
      }))
    ),
    ...overrides
  })
}

async function stagedPlan(
  current: DataModelIR,
  target: DataModelIR,
  phase: StagedMigrationExecutionPlanV1['phase'],
  operations: StagedMigrationOperationV1[],
  predecessor: StagedMigrationExecutionPlanV1['predecessor'] = null
): Promise<StagedMigrationExecutionPlanV1> {
  const sourcePlan = await planBackendMigration(current, target)
  const wrapped = operations.map((operation) => ({
    operation,
    risk: classifyStagedMigrationOperationRisk(operation)
  }))
  const riskOrder = ['low', 'medium', 'high', 'destructive'] as const
  const highestRisk = wrapped.reduce<(typeof riskOrder)[number]>(
    (highest, entry) =>
      riskOrder.indexOf(entry.risk) > riskOrder.indexOf(highest) ? entry.risk : highest,
    'low'
  )
  return {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: 1,
    executionId: `review-${phase}`,
    changeId: 'review-schema-change',
    sourceMigrationPlan: {
      version: 1,
      planId: sourcePlan.planId,
      planDigest: digestCanonicalBackendValue(sourcePlan, '$.test.sourceMigrationPlan'),
      fromModelDigest: sourcePlan.fromModelDigest ?? null,
      targetModelDigest: sourcePlan.targetModelDigest
    },
    phase,
    predecessor,
    operations: wrapped,
    highestRisk,
    requiresHumanApproval: highestRisk === 'destructive'
  }
}

function predecessorReceipt(
  phase: 'expand' | 'backfill',
  executionPlanDigest: string,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  environment: SupabaseMigrationReviewEnvironmentV1 = 'staging'
): StagedMigrationExecutionReceiptV1 {
  return {
    format: STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
    version: 1,
    receiptId: `receipt-${phase}`,
    executionId: `previous-${phase}`,
    executionPlanDigest,
    phase,
    promotionFrom: environment === 'staging' ? 'dev' : 'staging',
    targetAuthority: {
      providerId: 'supabase',
      providerAuthorityDigest: digestValue('A'),
      projectRef: snapshot.provenance.projectRef,
      accountId: snapshot.provenance.accountId,
      grantGeneration: `grant-${environment}-1`,
      environment
    },
    schemaBeforeDigest: digestValue('B'),
    schemaAfterDigest: snapshot.currentModelDigest,
    outcome: 'succeeded',
    recordedAt: snapshot.provenance.observedAt,
    evidenceDigest: digestValue('E')
  }
}

async function predecessorAuthorityFixture() {
  const currentModel = structuredClone(ownerApplication().dataModel)
  const predecessorDigest = digestValue('P')
  const executionPlan = await stagedPlan(
    currentModel,
    currentModel,
    'backfill',
    [
      {
        id: 'stage-backfill-title',
        kind: 'backfill-field',
        sourceOperationIds: ['source-backfill-title'],
        entityId: 'notes',
        fieldId: 'title',
        predicate: 'is-null',
        value: { kind: 'literal', fieldType: 'string', value: 'migrated' }
      }
    ],
    { phase: 'expand', executionPlanDigest: predecessorDigest, receiptRequired: true }
  )
  const snapshot = await createSupabaseInspectedMigrationSnapshot(inspectionForModel(currentModel))
  return {
    application: schemaApplication(currentModel),
    executionPlan,
    snapshot,
    receipt: predecessorReceipt('expand', predecessorDigest, snapshot)
  }
}

async function reviewPredecessorAuthority(
  mutateReceipt: (receipt: StagedMigrationExecutionReceiptV1) => void,
  environment: SupabaseMigrationReviewEnvironmentV1 = 'staging'
) {
  const fixture = await predecessorAuthorityFixture()
  const receipt = structuredClone(fixture.receipt)
  mutateReceipt(receipt)
  return createSupabaseInspectedMigrationReview({
    application: fixture.application,
    snapshot: fixture.snapshot,
    environment,
    stagedExecution: { executionPlan: fixture.executionPlan, predecessorReceipt: receipt }
  })
}

describe('Supabase inspected migration review', () => {
  test('binds an empty inspected baseline to additive owner policy SQL and least privileges', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot,
      expectedProjectRef: 'project-ref-1',
      expectedAccountId: 'account-1',
      expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest
    })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.manifest.applyAllowed).toBe(false)
    expect(review.manifest.releaseReady).toBe(false)
    expect(review.manifest.migrationPlan.operations).toHaveLength(1)
    expect(review.manifest.migrationPlan.operations[0].operation.kind).toBe('create-entity')
    expect(review.sql).toContain('CREATE TABLE "public"."notes"')
    expect(review.sql).toContain(
      `COMMENT ON TABLE "public"."notes" IS E'openpencil:v1:entity:notes';`
    )
    expect(review.sql).toContain(
      `COMMENT ON COLUMN "public"."notes"."owner_id" IS E'openpencil:v1:field:owner_id';`
    )
    expect(review.sql).toContain(`IS E'openpencil:v1:policy:openpencil_policy_`)
    expect(review.sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(review.sql).toContain('FOR SELECT TO "authenticated" USING ((select auth.uid())')
    expect(review.sql).toContain('FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid())')
    expect(review.sql).toContain(
      'GRANT SELECT, INSERT ON TABLE "public"."notes" TO "authenticated";'
    )
    expect(review.sql.indexOf('ENABLE ROW LEVEL SECURITY')).toBeLessThan(
      review.sql.indexOf('GRANT SELECT, INSERT')
    )
    expect(review.sql).not.toContain('service_role')
    expect(review.sql).not.toContain('GRANT ALL')
    expect(review.sql).not.toContain('ALTER DEFAULT PRIVILEGES')
  })

  test('guards the inspected baseline and verifies created RLS policy state before any grant', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const first = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })
    const second = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })
    const sql = first.sql
    const serializable = sql.indexOf('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;')
    const baseline = sql.indexOf('-- OpenPencil transaction-local inspected baseline precondition')
    const createTable = sql.indexOf('CREATE TABLE "public"."notes"')
    const createPolicy = sql.indexOf('CREATE POLICY "openpencil_policy_')
    const preGrant = sql.indexOf('-- OpenPencil transaction-local pre-grant verification')
    const rlsGuard = sql.indexOf('OR relation_rls IS DISTINCT FROM TRUE', preGrant)
    const policyGuard = sql.indexOf(
      'FROM pg_catalog.jsonb_array_elements(actual_policy_shapes)',
      preGrant
    )
    const policyExpressionGuard = sql.indexOf(
      'IF actual_using_digest IS DISTINCT FROM expected_using_digest',
      preGrant
    )
    const grant = sql.indexOf('GRANT SELECT, INSERT ON TABLE "public"."notes" TO "authenticated";')
    const commit = sql.lastIndexOf('COMMIT;')

    expect(first).toEqual(second)
    expect(first.manifest.baselinePreconditionVersion).toBe(1)
    expect(first.manifest.baselinePreconditionTableNames).toEqual([])
    expect(first.manifest.preGrantPreconditionTableNames).toEqual(['notes'])
    expect(serializable).toBeGreaterThan(sql.indexOf("SET LOCAL statement_timeout = '15s';"))
    expect(serializable).toBeLessThan(baseline)
    expect(baseline).toBeLessThan(createTable)
    expect(createTable).toBeLessThan(createPolicy)
    expect(createPolicy).toBeLessThan(preGrant)
    expect(preGrant).toBeLessThan(rlsGuard)
    expect(rlsGuard).toBeLessThan(policyGuard)
    expect(policyGuard).toBeLessThan(policyExpressionGuard)
    expect(policyExpressionGuard).toBeLessThan(grant)
    expect(grant).toBeLessThan(commit)
    for (const inventory of [
      'actual_schema_acl',
      'actual_runtime_roles',
      'actual_runtime_memberships',
      'actual_default_acl',
      'actual_table_acl',
      'actual_policy_shapes',
      'actual_roles'
    ]) {
      expect(sql).toContain(`FROM pg_catalog.jsonb_array_elements(${inventory})`)
      expect(sql).not.toContain(`${inventory} IS DISTINCT FROM`)
    }
    expect(sql).toContain('FULL JOIN (')
    expect(sql).toContain('SELECT entry, pg_catalog.count(*) AS copies')
    expect(sql).toContain(
      'WHERE actual_inventory.copies IS DISTINCT FROM expected_inventory.copies'
    )
    expect(sql).toContain('ORDER BY pg_catalog.convert_to(')
    expect(sql).toContain("ERRCODE = 'P0001';")
    expect(sql).not.toContain("EXCEPTION WHEN SQLSTATE 'P0001'")
    expect(/(^|[^A-Za-z])DROP([^A-Za-z]|$)/iu.test(sql)).toBe(false)
  })

  test('revokes PostgreSQL implicit PUBLIC usage from a newly created enum', async () => {
    const application = ownerApplication()
    application.dataModel.entities = []
    application.dataModel.enums = [
      { id: 'note-status', name: 'note_status', values: ['draft', 'published'] }
    ]
    application.auth.ownership = []
    application.auth.rowAccess = []
    application.workflows.workflows = []
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const review = await createSupabaseInspectedMigrationReview({ application, snapshot })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain(
      `CREATE TYPE "public"."note_status" AS ENUM (E'draft', E'published');`
    )
    expect(review.sql).toContain('REVOKE USAGE ON TYPE "public"."note_status" FROM PUBLIC;')
    expect(review.sql.indexOf('CREATE TYPE')).toBeLessThan(review.sql.indexOf('REVOKE USAGE'))
    expect(review.sql.indexOf('REVOKE USAGE')).toBeLessThan(review.sql.indexOf('COMMENT ON TYPE'))
  })

  test('keeps authenticated table DML behind RLS when a managed table uses a new enum', async () => {
    const application = ownerApplication()
    application.dataModel.enums = [
      { id: 'note-status', name: 'note_status', values: ['draft', 'published'] }
    ]
    application.dataModel.entities[0].fields.push({
      id: 'status',
      name: 'status',
      type: 'enum',
      enumId: 'note-status',
      nullable: true
    })
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const review = await createSupabaseInspectedMigrationReview({ application, snapshot })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain('REVOKE USAGE ON TYPE "public"."note_status" FROM PUBLIC;')
    expect(review.sql).toContain('ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;')
    expect(review.sql).toContain('ALTER TABLE "public"."notes" FORCE ROW LEVEL SECURITY;')
    expect(review.sql).toContain('FOR SELECT TO "authenticated" USING ((select auth.uid())')
    expect(review.sql).toContain('FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid())')
    expect(review.sql).toContain(
      'GRANT SELECT, INSERT ON TABLE "public"."notes" TO "authenticated";'
    )
    expect(review.sql).not.toContain('GRANT USAGE ON TYPE')
  })

  test('reviews a standalone enum extension but blocks mixed operations in its transaction', async () => {
    const current = ownerApplication()
    current.auth.rowAccess = []
    current.workflows.workflows = []
    current.dataModel.enums = [{ id: 'note-status', name: 'note_status', values: ['draft'] }]
    current.dataModel.entities[0].fields.push({
      id: 'status',
      name: 'status',
      type: 'enum',
      enumId: 'note-status',
      nullable: true
    })
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        currentModel: current.dataModel,
        objects: [
          {
            kind: 'enum',
            schema: 'public',
            name: 'note_status',
            management: 'managed',
            openPencilId: 'note-status',
            values: ['draft'],
            address: { classOid: '1247', objectOid: '50000', subId: 0 }
          },
          {
            kind: 'table',
            schema: 'public',
            name: 'notes',
            management: 'managed',
            openPencilId: 'notes',
            address: { classOid: '1259', objectOid: '60000', subId: 0 },
            rlsEnabled: true,
            rlsForced: true
          }
        ],
        columns: current.dataModel.entities[0].fields.map((field, fieldIndex) => ({
          schema: 'public' as const,
          tableName: 'notes',
          name: field.name,
          columnPrivilegesPresent: false as const,
          management: 'managed' as const,
          openPencilFieldId: field.id,
          type: field.type,
          ...(field.type === 'enum' ? { enumName: 'note_status' } : {}),
          nullable: field.nullable,
          default: null,
          address: { classOid: '1259', objectOid: '60000', subId: fieldIndex + 1 },
          typeOid: fixtureTypeOid(field, field.type === 'enum' ? '50000' : undefined),
          defaultExpressionDigest: null,
          identityKind: '' as const,
          generatedKind: '' as const
        })),
        constraints: [
          {
            kind: 'primary-key',
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_pk_notes',
            management: 'managed',
            openPencilId: 'notes',
            fields: ['id'],
            address: { classOid: '2606', objectOid: '70000', subId: 0 },
            definitionDigest: digestValue('C'),
            validated: true
          }
        ],
        indexes: [
          {
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_idx_owner',
            management: 'managed',
            openPencilId: 'notes_owner_idx',
            address: { classOid: '1259', objectOid: '80000', subId: 0 },
            definitionDigest: digestValue('I'),
            valid: true,
            ready: true,
            fields: [{ name: 'owner_id', order: 'asc' }]
          }
        ]
      })
    )
    const enumOnlyTarget = structuredClone(current)
    enumOnlyTarget.dataModel.enums[0].values.push('published')
    const enumOnlyFirst = await createSupabaseInspectedMigrationReview({
      application: enumOnlyTarget,
      snapshot
    })
    const enumOnlySecond = await createSupabaseInspectedMigrationReview({
      application: enumOnlyTarget,
      snapshot
    })

    expect(enumOnlyFirst.manifest.reviewReady).toBe(true)
    expect(
      enumOnlyFirst.manifest.migrationPlan.operations.map((entry) => entry.operation.kind)
    ).toEqual(['add-enum-value'])
    expect(enumOnlyFirst.manifest.renderedMigrationOperationIds).toEqual(['op-0001'])
    expect(enumOnlyFirst.sql).toContain('BEGIN;')
    expect(enumOnlyFirst.sql).toContain(`ALTER TYPE "public"."note_status" ADD VALUE E'published';`)
    expect(enumOnlySecond.sql).toBe(enumOnlyFirst.sql)
    expect(enumOnlySecond.manifestDigest).toBe(enumOnlyFirst.manifestDigest)

    const target = structuredClone(enumOnlyTarget)
    target.dataModel.entities[0].fields.push({
      id: 'summary',
      name: 'summary',
      type: 'string',
      nullable: true
    })
    target.dataModel.entities[0].indexes?.push({ id: 'notes_summary_idx', fields: ['summary'] })

    const first = await createSupabaseInspectedMigrationReview({ application: target, snapshot })
    const second = await createSupabaseInspectedMigrationReview({ application: target, snapshot })

    expect(first.manifest.reviewReady).toBe(false)
    expect(first.manifest.migrationPlan.operations.map((entry) => entry.operation.kind)).toEqual([
      'add-enum-value',
      'add-field',
      'add-index'
    ])
    expect(first.manifest.renderedMigrationOperationIds).toEqual([])
    expect(first.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-migration-enum-value-transaction-boundary-required'
    )
    expect(first.sql).not.toContain('BEGIN;')
    expect(first.sql).not.toContain('ALTER TYPE')
    expect(first.sql).not.toContain('ALTER TABLE')
    expect(first.sql).not.toContain('CREATE INDEX')
    expect(second.sql).toBe(first.sql)
    expect(second.manifestDigest).toBe(first.manifestDigest)

    const missingColumnPrivilegeEvidence = structuredClone(snapshot)
    Reflect.deleteProperty(
      missingColumnPrivilegeEvidence.columns[0] ?? {},
      'columnPrivilegesPresent'
    )
    await expect(
      parseSupabaseInspectedMigrationSnapshot(missingColumnPrivilegeEvidence)
    ).rejects.toThrow('columnPrivilegesPresent')
  })

  test('replaces marked policies and reuses exact inspected runtime grants on a later review', async () => {
    const application = ownerApplication()
    const initialSnapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const initial = await createSupabaseInspectedMigrationReview({
      application,
      snapshot: initialSnapshot
    })
    const selectPolicy = initial.sql.match(/CREATE POLICY "([^"]+)"[^\n]+ FOR SELECT /u)?.[1]
    const insertPolicy = initial.sql.match(/CREATE POLICY "([^"]+)"[^\n]+ FOR INSERT /u)?.[1]
    expect(selectPolicy).toBeTruthy()
    expect(insertPolicy).toBeTruthy()
    if (!selectPolicy || !insertPolicy) throw new Error('Expected deterministic policy names')

    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        currentModel: application.dataModel,
        objects: [
          {
            kind: 'table',
            schema: 'public',
            name: 'notes',
            management: 'managed',
            openPencilId: 'notes',
            address: { classOid: '1259', objectOid: '60000', subId: 0 },
            rlsEnabled: true,
            rlsForced: true
          }
        ],
        columns: application.dataModel.entities[0].fields.map((field, fieldIndex) => ({
          schema: 'public' as const,
          tableName: 'notes',
          name: field.name,
          columnPrivilegesPresent: false as const,
          management: 'managed' as const,
          openPencilFieldId: field.id,
          type: field.type,
          nullable: field.nullable,
          default: null,
          address: { classOid: '1259', objectOid: '60000', subId: fieldIndex + 1 },
          typeOid: fixtureTypeOid(field, undefined),
          defaultExpressionDigest: null,
          identityKind: '' as const,
          generatedKind: '' as const
        })),
        constraints: [
          {
            kind: 'primary-key',
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_pk_notes',
            management: 'managed',
            openPencilId: 'notes',
            fields: ['id'],
            address: { classOid: '2606', objectOid: '70000', subId: 0 },
            definitionDigest: digestValue('C'),
            validated: true
          }
        ],
        indexes: [
          {
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_idx_owner',
            management: 'managed',
            openPencilId: 'notes_owner_idx',
            address: { classOid: '1259', objectOid: '80000', subId: 0 },
            definitionDigest: digestValue('I'),
            valid: true,
            ready: true,
            fields: [{ name: 'owner_id', order: 'asc' }]
          }
        ],
        policies: [
          {
            schema: 'public',
            tableName: 'notes',
            name: selectPolicy,
            command: 'select',
            mode: 'permissive',
            roles: ['authenticated'],
            source: 'openpencil',
            usingExpressionDigest: digestValue('A'),
            withCheckExpressionDigest: null
          },
          {
            schema: 'public',
            tableName: 'notes',
            name: insertPolicy,
            command: 'insert',
            mode: 'permissive',
            roles: ['authenticated'],
            source: 'openpencil',
            usingExpressionDigest: null,
            withCheckExpressionDigest: digestValue('B')
          }
        ],
        privileges: [
          {
            objectKind: 'schema',
            schema: 'public',
            objectName: 'public',
            grantor: 'postgres',
            grantee: 'authenticated',
            privilege: 'USAGE',
            isGrantable: false,
            source: 'unknown'
          },
          ...(['SELECT', 'INSERT'] as const).map((privilege) => ({
            objectKind: 'table' as const,
            schema: 'public' as const,
            objectName: 'notes',
            grantor: 'postgres',
            grantee: 'authenticated',
            privilege,
            isGrantable: false,
            source: 'unknown' as const
          }))
        ]
      })
    )
    const target = structuredClone(application)
    target.dataModel.entities[0].fields.push({
      id: 'summary',
      name: 'summary',
      type: 'string',
      nullable: true
    })
    const review = await createSupabaseInspectedMigrationReview({ application: target, snapshot })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain(`DROP POLICY "${selectPolicy}" ON "public"."notes";`)
    expect(review.sql).toContain(`DROP POLICY "${insertPolicy}" ON "public"."notes";`)
    expect(review.sql).toContain(`COMMENT ON POLICY "${selectPolicy}"`)
    expect(review.manifest.baselinePreconditionTableNames).toEqual(['notes'])
    expect(review.sql.indexOf('LOCK TABLE ONLY "public"."notes"')).toBeLessThan(
      review.sql.indexOf('ALTER TABLE "public"."notes" ADD COLUMN')
    )
    expect(review.sql.indexOf('LOCK TABLE ONLY "public"."notes"')).toBeLessThan(
      review.sql.indexOf(`DROP POLICY "${selectPolicy}"`)
    )
    expect(review.sql).toContain('FROM pg_catalog.jsonb_array_elements(actual_policies)')
    expect(review.sql).not.toContain('actual_policies IS DISTINCT FROM')
    expect(review.sql).not.toContain('GRANT SELECT, INSERT')
    expect(review.sql).not.toContain('GRANT USAGE ON SCHEMA')
  })

  test('rejects missing sections, digest tampering, structural baseline claims, and target drift', async () => {
    const missing = { ...emptyInspection() }
    Reflect.deleteProperty(missing, 'constraints')
    await expect(createSupabaseInspectedMigrationSnapshot(missing)).rejects.toThrow('constraints')

    const missingRoleMemberships = { ...emptyInspection() }
    Reflect.deleteProperty(missingRoleMemberships, 'roleMemberships')
    await expect(createSupabaseInspectedMigrationSnapshot(missingRoleMemberships)).rejects.toThrow(
      'roleMemberships'
    )

    await expect(
      createSupabaseInspectedMigrationSnapshot(
        emptyInspection({
          roles: [
            { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
            { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true }
          ]
        })
      )
    ).rejects.toThrow('inspection database role lacks complete role evidence')

    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const laterSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        provenance: {
          ...emptyInspection().provenance,
          observedAt: '2026-08-30T00:00:01.000Z'
        }
      })
    )
    expect(laterSnapshot.provenance.observedAt).not.toBe(snapshot.provenance.observedAt)
    expect(laterSnapshot.objectPrivilegeDigest).toBe(snapshot.objectPrivilegeDigest)
    expect(laterSnapshot.inspectedSchemaDigest).toBe(snapshot.inspectedSchemaDigest)
    expect(laterSnapshot.captureDigest).not.toBe(snapshot.captureDigest)

    const firstApproval = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })
    const laterApproval = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: laterSnapshot
    })
    expect(laterApproval.manifest.inspectionCaptureDigest).not.toBe(
      firstApproval.manifest.inspectionCaptureDigest
    )
    expect(laterApproval.manifestDigest).toBe(firstApproval.manifestDigest)
    expect(laterApproval.sql).toBe(firstApproval.sql)

    const observationTamper = structuredClone(snapshot)
    Reflect.set(observationTamper.provenance, 'observedAt', '2026-08-30T00:00:01.000Z')
    await expect(parseSupabaseInspectedMigrationSnapshot(observationTamper)).rejects.toThrow(
      'captureDigest'
    )

    const databaseRoleTamper = structuredClone(snapshot)
    Reflect.set(databaseRoleTamper.provenance, 'databaseRole', 'anon')
    await expect(parseSupabaseInspectedMigrationSnapshot(databaseRoleTamper)).rejects.toThrow(
      'objectPrivilegeDigest'
    )

    const tampered = structuredClone(snapshot)
    Reflect.set(tampered, 'currentModelDigest', digestValue('A'))
    await expect(parseSupabaseInspectedMigrationSnapshot(tampered)).rejects.toThrow(
      'currentModelDigest'
    )

    const structural = ownerApplication().dataModel
    await expect(
      createSupabaseInspectedMigrationSnapshot(emptyInspection({ currentModel: structural }))
    ).rejects.toThrow('must exactly match the address-validated managed catalog markers')

    await expect(
      createSupabaseInspectedMigrationReview({
        application: ownerApplication(),
        snapshot,
        expectedTargetModelDigest: digestValue('A')
      })
    ).rejects.toThrow('target DataModelIR drifted')

    await expect(
      createSupabaseInspectedMigrationReview({
        application: ownerApplication(),
        snapshot,
        expectedProjectRef: 'different-project'
      })
    ).rejects.toThrow('different project authority')

    await expect(
      createSupabaseInspectedMigrationReview({
        application: ownerApplication(),
        snapshot,
        expectedAccountId: 'different-account'
      })
    ).rejects.toThrow('different account authority')

    const viewWithMissingEvidence = emptyInspection({
      objects: [
        {
          kind: 'view',
          schema: 'public',
          name: 'missing_evidence',
          management: 'unbound',
          securityInvoker: true
        }
      ]
    })
    Reflect.deleteProperty(viewWithMissingEvidence.objects[0] ?? {}, 'securityInvoker')
    await expect(createSupabaseInspectedMigrationSnapshot(viewWithMissingEvidence)).rejects.toThrow(
      'securityInvoker'
    )

    const viewWithNullEvidence = structuredClone(viewWithMissingEvidence)
    Reflect.set(viewWithNullEvidence.objects[0] ?? {}, 'securityInvoker', null)
    await expect(createSupabaseInspectedMigrationSnapshot(viewWithNullEvidence)).rejects.toThrow(
      'securityInvoker'
    )

    const viewWithStringEvidence = structuredClone(viewWithMissingEvidence)
    Reflect.set(viewWithStringEvidence.objects[0] ?? {}, 'securityInvoker', 'true')
    await expect(createSupabaseInspectedMigrationSnapshot(viewWithStringEvidence)).rejects.toThrow(
      'securityInvoker'
    )
  })

  test('requires complete runtime role evidence and binds role, membership, and grant options to the inventory digest', async () => {
    await expect(
      createSupabaseInspectedMigrationSnapshot(
        emptyInspection({
          roles: [
            POSTGRES_INSPECTION_ROLE,
            { roleName: 'anon', superuser: false, bypassRls: false, inherit: true }
          ]
        })
      )
    ).rejects.toThrow('referenced grantee authenticated lacks complete role evidence')

    await expect(
      createSupabaseInspectedMigrationSnapshot(
        emptyInspection({
          privileges: [
            {
              objectKind: 'schema',
              schema: 'public',
              objectName: 'public',
              grantor: 'postgres',
              grantee: 'custom_runtime',
              privilege: 'USAGE',
              isGrantable: false,
              source: 'third-party'
            }
          ]
        })
      )
    ).rejects.toThrow('referenced grantee custom_runtime lacks complete role evidence')

    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        roles: [
          POSTGRES_INSPECTION_ROLE,
          { roleName: 'member_role', superuser: false, bypassRls: false, inherit: true },
          { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true },
          { roleName: 'parent_role', superuser: false, bypassRls: false, inherit: true },
          { roleName: 'anon', superuser: false, bypassRls: false, inherit: true }
        ],
        roleMemberships: [
          {
            roleName: 'parent_role',
            memberName: 'member_role',
            grantorName: 'postgres',
            adminOption: false,
            inheritOption: true,
            setOption: true
          }
        ],
        privileges: [
          {
            objectKind: 'schema',
            schema: 'public',
            objectName: 'public',
            grantor: 'postgres',
            grantee: 'PUBLIC',
            privilege: 'USAGE',
            isGrantable: false,
            source: 'openpencil'
          }
        ]
      })
    )

    const roleTamper = structuredClone(snapshot)
    Reflect.set(roleTamper.roles[0], 'bypassRls', true)
    await expect(parseSupabaseInspectedMigrationSnapshot(roleTamper)).rejects.toThrow(
      'objectPrivilegeDigest'
    )

    const membershipTamper = structuredClone(snapshot)
    Reflect.set(membershipTamper.roleMemberships[0], 'inheritOption', false)
    await expect(parseSupabaseInspectedMigrationSnapshot(membershipTamper)).rejects.toThrow(
      'objectPrivilegeDigest'
    )

    const grantTamper = structuredClone(snapshot)
    Reflect.set(grantTamper.privileges[0], 'isGrantable', true)
    await expect(parseSupabaseInspectedMigrationSnapshot(grantTamper)).rejects.toThrow(
      'objectPrivilegeDigest'
    )
  })

  test('blocks privileged runtime roles, transitive memberships, and grant options without repair SQL', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        roles: [
          POSTGRES_INSPECTION_ROLE,
          { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
          { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true },
          { roleName: 'inherited_admin', superuser: true, bypassRls: false, inherit: true },
          { roleName: 'rls_bypass_parent', superuser: false, bypassRls: true, inherit: true }
        ],
        roleMemberships: [
          {
            roleName: 'inherited_admin',
            memberName: 'authenticated',
            grantorName: 'postgres',
            adminOption: false,
            inheritOption: true,
            setOption: true
          },
          {
            roleName: 'rls_bypass_parent',
            memberName: 'inherited_admin',
            grantorName: 'postgres',
            adminOption: true,
            inheritOption: true,
            setOption: true
          }
        ],
        privileges: [
          {
            objectKind: 'schema',
            schema: 'public',
            objectName: 'public',
            grantor: 'postgres',
            grantee: 'authenticated',
            privilege: 'USAGE',
            isGrantable: true,
            source: 'openpencil'
          }
        ]
      })
    )
    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })
    const codes = review.manifest.blockers.map((entry) => entry.code)
    expect(codes).toContain('supabase-superuser-runtime-role-blocked')
    expect(codes).toContain('supabase-bypassrls-runtime-role-blocked')
    expect(codes).toContain('supabase-runtime-role-membership-blocked')
    expect(codes).toContain('supabase-privilege-grant-option-blocked')
    expect(review.manifest.reviewReady).toBe(false)
    expect(review.sql).not.toContain('BEGIN;')
    expect(review.sql).not.toContain('ALTER ROLE')
    expect(review.sql).not.toContain('REVOKE')
    expect(review.sql).not.toContain('GRANT OPTION')
  })

  test('turns broad allow, deny-only, and external workflow access into non-executable blockers', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())

    const broad = ownerApplication()
    broad.auth.ownership = []
    broad.auth.rowAccess = [
      {
        id: 'broad-read',
        entityId: 'notes',
        effect: 'allow',
        operations: ['select', 'insert'],
        principal: { kind: 'authenticated' }
      }
    ]
    const broadReview = await createSupabaseInspectedMigrationReview({
      application: broad,
      snapshot
    })
    expect(broadReview.manifest.reviewReady).toBe(false)
    expect(broadReview.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-grant-policy-coverage-required'
    )
    expect(broadReview.sql).not.toContain('CREATE TABLE')
    expect(broadReview.sql).not.toContain('GRANT SELECT')

    const denied = ownerApplication()
    denied.auth.ownership = []
    denied.auth.rowAccess = [
      {
        id: 'deny-auth',
        entityId: 'notes',
        effect: 'deny',
        operations: ['select', 'insert'],
        principal: { kind: 'authenticated' }
      }
    ]
    const deniedReview = await createSupabaseInspectedMigrationReview({
      application: denied,
      snapshot
    })
    expect(deniedReview.manifest.reviewReady).toBe(false)
    expect(deniedReview.sql).not.toContain('GRANT SELECT')

    const external = ownerApplication()
    external.dataModel.entities[0].management = 'external'
    external.dataModel.entities[0].fields = []
    delete external.dataModel.entities[0].primaryKey
    delete external.dataModel.entities[0].indexes
    external.auth.ownership = []
    external.auth.rowAccess = []
    const externalReview = await createSupabaseInspectedMigrationReview({
      application: external,
      snapshot
    })
    expect(externalReview.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-external-workflow-grant-blocked'
    )
    expect(externalReview.sql).not.toContain('GRANT')
  })

  test('fails closed for unknown permissive policy, PUBLIC ACL, and third-party ACL', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        objects: [
          {
            kind: 'table',
            schema: 'public',
            name: 'legacy',
            management: 'external',
            rlsEnabled: true,
            rlsForced: true
          }
        ],
        policies: [
          {
            schema: 'public',
            tableName: 'legacy',
            name: 'legacy_read',
            command: 'select',
            mode: 'permissive',
            roles: ['PUBLIC'],
            source: 'unknown',
            usingExpressionDigest: null,
            withCheckExpressionDigest: null
          }
        ],
        privileges: [
          {
            objectKind: 'table',
            schema: 'public',
            objectName: 'legacy',
            grantor: 'postgres',
            grantee: 'PUBLIC',
            privilege: 'SELECT',
            isGrantable: false,
            source: 'third-party'
          }
        ]
      })
    )
    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })
    const codes = review.manifest.blockers.map((entry) => entry.code)
    expect(codes).toContain('supabase-unknown-permissive-policy-blocked')
    expect(codes).toContain('supabase-public-acl-blocked')
    expect(codes).toContain('supabase-third-party-acl-blocked')
    expect(review.sql).not.toContain('BEGIN;')
    expect(review.sql).not.toContain('CREATE TABLE')
  })

  test('represents public schema ACL and fails closed for PUBLIC CREATE', async () => {
    await expect(
      createSupabaseInspectedMigrationSnapshot(
        emptyInspection({
          privileges: [
            {
              objectKind: 'schema',
              schema: 'public',
              objectName: 'private',
              grantor: 'postgres',
              grantee: 'PUBLIC',
              privilege: 'CREATE',
              isGrantable: false,
              source: 'openpencil'
            }
          ]
        })
      )
    ).rejects.toThrow('schema privileges must reference exactly public')

    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        privileges: [
          {
            objectKind: 'schema',
            schema: 'public',
            objectName: 'public',
            grantor: 'postgres',
            grantee: 'PUBLIC',
            privilege: 'CREATE',
            isGrantable: false,
            source: 'openpencil'
          }
        ]
      })
    )
    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })

    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-public-acl-blocked'
    )
    expect(
      review.sql
        .split('\n')
        .filter(Boolean)
        .every((line) => line.startsWith('--'))
    ).toBe(true)
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('accepts only the non-grantable Supabase public-schema USAGE baseline', async () => {
    const baselineGrantees = [
      'PUBLIC',
      'anon',
      'authenticated',
      'postgres',
      'service_role'
    ] as const
    const managementAPIProvenance = {
      ...emptyInspection().provenance,
      databaseRole: 'supabase_read_only_user'
    }
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        provenance: managementAPIProvenance,
        roles: [
          {
            roleName: 'supabase_read_only_user',
            superuser: false,
            bypassRls: true,
            inherit: true
          },
          { roleName: 'postgres', superuser: false, bypassRls: true, inherit: true },
          { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
          { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true },
          { roleName: 'service_role', superuser: false, bypassRls: true, inherit: true }
        ],
        privileges: baselineGrantees.map((grantee) => ({
          objectKind: 'schema' as const,
          schema: 'public' as const,
          objectName: 'public' as const,
          grantor: 'postgres',
          grantee,
          privilege: 'USAGE' as const,
          isGrantable: false,
          source: 'unknown' as const
        }))
      })
    )
    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.manifest.blockers).toEqual([])
    expect(review.sql).toContain(
      'GRANT SELECT, INSERT ON TABLE "public"."notes" TO "authenticated";'
    )
    expect(review.sql).not.toContain('GRANT USAGE ON SCHEMA "public" TO "authenticated";')
    expect(review.sql).not.toContain('TO "service_role"')
    expect(review.sql).toContain('AND owner.rolname = current_user')
    expect(review.sql).toContain('OR relation_owner <> current_user')
    expect(review.sql).not.toContain("OR relation_owner <> E'supabase_read_only_user'")

    const postgresUsage = snapshot.privileges.find((entry) => entry.grantee === 'postgres')
    if (!postgresUsage) throw new Error('Missing postgres schema USAGE fixture')
    const thirdPartyUsageSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        provenance: managementAPIProvenance,
        roles: snapshot.roles,
        privileges: [{ ...postgresUsage, source: 'third-party' }]
      })
    )
    const thirdPartyUsage = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: thirdPartyUsageSnapshot
    })
    expect(thirdPartyUsage.manifest.reviewReady).toBe(false)
    expect(thirdPartyUsage.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-third-party-acl-blocked'
    )

    const grantableUsageSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        provenance: managementAPIProvenance,
        roles: snapshot.roles,
        privileges: [{ ...postgresUsage, isGrantable: true }]
      })
    )
    const grantableUsage = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: grantableUsageSnapshot
    })
    expect(grantableUsage.manifest.reviewReady).toBe(false)
    expect(grantableUsage.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-privilege-grant-option-blocked'
    )

    const postgresCreateSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        provenance: managementAPIProvenance,
        roles: snapshot.roles,
        privileges: [{ ...postgresUsage, privilege: 'CREATE' }]
      })
    )
    const postgresCreate = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: postgresCreateSnapshot
    })
    expect(postgresCreate.manifest.reviewReady).toBe(false)
    expect(postgresCreate.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-privileged-grantee-blocked'
    )
  })

  test('keeps the inspection role schema authority outside the runtime role graph', async () => {
    const platformRole = (
      roleName: string,
      options: Readonly<{ superuser?: boolean; bypassRls?: boolean }> = {}
    ) => ({
      roleName,
      superuser: options.superuser ?? false,
      bypassRls: options.bypassRls ?? false,
      inherit: true
    })
    const platformMembership = (roleName: string, memberName: string) => ({
      roleName,
      memberName,
      grantorName: 'supabase_admin',
      adminOption: false,
      inheritOption: true,
      setOption: true
    })
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        roles: [
          platformRole('postgres', { bypassRls: true }),
          platformRole('anon'),
          platformRole('authenticated'),
          platformRole('authenticator'),
          platformRole('service_role', { bypassRls: true }),
          platformRole('supabase_admin', { superuser: true, bypassRls: true }),
          platformRole('pg_database_owner'),
          platformRole('pg_monitor'),
          platformRole('pg_read_all_settings'),
          platformRole('pg_read_all_stats'),
          platformRole('pg_stat_scan_tables')
        ],
        roleMemberships: [
          platformMembership('anon', 'authenticator'),
          platformMembership('authenticated', 'authenticator'),
          platformMembership('service_role', 'authenticator'),
          platformMembership('supabase_admin', 'authenticator'),
          platformMembership('authenticated', 'postgres'),
          platformMembership('service_role', 'postgres'),
          platformMembership('supabase_admin', 'postgres'),
          platformMembership('pg_monitor', 'postgres'),
          platformMembership('pg_read_all_settings', 'pg_monitor'),
          platformMembership('pg_read_all_stats', 'pg_monitor'),
          platformMembership('pg_stat_scan_tables', 'pg_monitor')
        ],
        privileges: [
          {
            objectKind: 'schema',
            schema: 'public',
            objectName: 'public',
            grantor: 'pg_database_owner',
            grantee: 'postgres',
            privilege: 'CREATE',
            isGrantable: false,
            source: 'unknown'
          }
        ]
      })
    )
    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.manifest.blockers).toEqual([])
    expect(review.sql).not.toContain('ALTER ROLE')

    const grantableSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        roles: snapshot.roles,
        roleMemberships: snapshot.roleMemberships,
        privileges: [{ ...snapshot.privileges[0], isGrantable: true }]
      })
    )
    const blocked = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: grantableSnapshot
    })
    expect(blocked.manifest.reviewReady).toBe(false)
    expect(blocked.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-privilege-grant-option-blocked'
    )
    expect(blocked.sql).not.toContain('BEGIN;')

    const thirdPartySnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        roles: snapshot.roles,
        roleMemberships: snapshot.roleMemberships,
        privileges: [{ ...snapshot.privileges[0], source: 'third-party' }]
      })
    )
    const thirdPartyBlocked = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: thirdPartySnapshot
    })
    expect(thirdPartyBlocked.manifest.reviewReady).toBe(false)
    expect(thirdPartyBlocked.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-third-party-acl-blocked'
    )

    const serviceRoleCreateSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        roles: snapshot.roles,
        roleMemberships: snapshot.roleMemberships,
        privileges: [{ ...snapshot.privileges[0], grantee: 'service_role' }]
      })
    )
    const serviceRoleCreateBlocked = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: serviceRoleCreateSnapshot
    })
    const serviceRoleCreateCodes = serviceRoleCreateBlocked.manifest.blockers.map(
      (entry) => entry.code
    )
    expect(serviceRoleCreateCodes).toContain('supabase-privileged-grantee-blocked')
    expect(serviceRoleCreateCodes).toContain('supabase-bypassrls-runtime-role-blocked')

    const tableAclSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        roles: snapshot.roles,
        roleMemberships: snapshot.roleMemberships,
        objects: [
          {
            kind: 'table',
            schema: 'public',
            name: 'external_notes',
            management: 'external',
            rlsEnabled: true,
            rlsForced: false
          }
        ],
        privileges: [
          {
            objectKind: 'table',
            schema: 'public',
            objectName: 'external_notes',
            grantor: 'supabase_admin',
            grantee: 'postgres',
            privilege: 'SELECT',
            isGrantable: false,
            source: 'unknown'
          }
        ]
      })
    )
    const tableAclBlocked = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: tableAclSnapshot
    })
    const tableAclCodes = tableAclBlocked.manifest.blockers.map((entry) => entry.code)
    expect(tableAclCodes).toContain('supabase-privileged-grantee-blocked')
    expect(tableAclCodes).toContain('supabase-bypassrls-runtime-role-blocked')
    expect(tableAclBlocked.sql).not.toContain('BEGIN;')
  })

  test('reuses exact managed schema USAGE while still emitting the missing table grant', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        privileges: [
          {
            objectKind: 'schema',
            schema: 'public',
            objectName: 'public',
            grantor: 'postgres',
            grantee: 'authenticated',
            privilege: 'USAGE',
            isGrantable: false,
            source: 'openpencil'
          }
        ]
      })
    )
    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).not.toContain('GRANT USAGE ON SCHEMA')
    expect(review.sql).toContain(
      'GRANT SELECT, INSERT ON TABLE "public"."notes" TO "authenticated";'
    )
    expect(
      review.manifest.privilegeOperations.some((entry) => entry.kind === 'grant-schema-usage')
    ).toBe(false)
  })

  test('represents type and schema default privileges but never emits default ACL SQL', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        defaultPrivileges: [
          {
            schema: 'public',
            objectKind: 'type',
            grantor: 'postgres',
            grantee: 'authenticated',
            privilege: 'USAGE',
            isGrantable: true,
            source: 'openpencil'
          },
          {
            schema: 'public',
            objectKind: 'schema',
            grantor: 'postgres',
            grantee: 'authenticated',
            privilege: 'USAGE',
            isGrantable: false,
            source: 'openpencil'
          }
        ]
      })
    )
    expect(snapshot.defaultPrivileges.map((entry) => entry.objectKind)).toEqual(['schema', 'type'])

    const review = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot
    })
    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-default-privileges-blocked'
    )
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-default-privilege-grant-option-blocked'
    )
    expect(review.sql).not.toContain('ALTER DEFAULT PRIVILEGES')
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('rejects identifier injection and normalizes inventory order deterministically', async () => {
    await expect(
      createSupabaseInspectedMigrationSnapshot(
        emptyInspection({
          objects: [
            {
              kind: 'view',
              schema: 'public',
              name: 'notes";DROP_TABLE',
              management: 'unbound',
              securityInvoker: true
            }
          ]
        })
      )
    ).rejects.toThrow('identifier')

    const alpha = {
      kind: 'view',
      schema: 'public',
      name: 'alpha_view',
      management: 'unbound',
      securityInvoker: true
    } as const
    const zeta = {
      kind: 'view',
      schema: 'public',
      name: 'zeta_view',
      management: 'unbound',
      securityInvoker: true
    } as const
    const roles = [
      POSTGRES_INSPECTION_ROLE,
      { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'group_a', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'group_b', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'member_a', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'member_b', superuser: false, bypassRls: false, inherit: true }
    ] as const
    const memberships = [
      {
        roleName: 'group_a',
        memberName: 'member_a',
        grantorName: 'postgres',
        adminOption: false,
        inheritOption: true,
        setOption: true
      },
      {
        roleName: 'group_b',
        memberName: 'member_b',
        grantorName: 'postgres',
        adminOption: false,
        inheritOption: true,
        setOption: true
      }
    ] as const
    const first = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        objects: [zeta, alpha],
        roles: [...roles].reverse(),
        roleMemberships: [...memberships].reverse()
      })
    )
    const second = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({ objects: [alpha, zeta], roles, roleMemberships: memberships })
    )
    expect(first).toEqual(second)
    const firstReview = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: first
    })
    const secondReview = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: second
    })
    expect(firstReview).toEqual(secondReview)
  })

  test('rejects enum injection and escapes backslash plus quote payloads in defaults', async () => {
    const malicious = "\\'; COMMIT; GRANT SELECT ON TABLE public.notes TO PUBLIC;--"
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const enumApplication = ownerApplication()
    enumApplication.dataModel.enums = [
      { id: 'unsafe-enum', name: 'unsafe_enum', values: [malicious] }
    ]
    await expect(
      createSupabaseInspectedMigrationReview({ application: enumApplication, snapshot })
    ).rejects.toThrow('backend-identifier-invalid')

    const application = ownerApplication()
    const titleField = application.dataModel.entities[0].fields.find(
      (field) => field.id === 'title'
    )
    if (!titleField) throw new Error('Missing title fixture field.')
    titleField.default = {
      kind: 'literal',
      value: malicious
    }
    application.dataModel.entities[0].fields.push({
      id: 'payload',
      name: 'payload',
      type: 'json',
      nullable: true,
      default: { kind: 'literal', value: malicious }
    })
    const review = await createSupabaseInspectedMigrationReview({ application, snapshot })
    const escaped = "E'\\\\''; COMMIT; GRANT SELECT ON TABLE public.notes TO PUBLIC;--'"
    const escapedJSON =
      "E'\"\\\\\\\\''; COMMIT; GRANT SELECT ON TABLE public.notes TO PUBLIC;--\"'::jsonb"

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain(`"title" text DEFAULT ${escaped}`)
    expect(review.sql).toContain(`"payload" jsonb DEFAULT ${escapedJSON}`)
    expect(review.sql).not.toContain(
      `"title" text DEFAULT '\\'; COMMIT; GRANT SELECT ON TABLE public.notes TO PUBLIC;--'`
    )
  })

  test('blocks public security-definer views and accepts security-invoker evidence', async () => {
    const unsafeSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        objects: [
          {
            kind: 'view',
            schema: 'public',
            name: 'unsafe_notes',
            management: 'unbound',
            securityInvoker: false
          }
        ]
      })
    )
    const unsafeReview = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: unsafeSnapshot
    })
    expect(unsafeReview.manifest.reviewReady).toBe(false)
    expect(unsafeReview.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-public-security-definer-view-blocked'
    )
    expect(unsafeReview.sql).not.toContain('BEGIN;')

    const safeSnapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection({
        objects: [
          {
            kind: 'view',
            schema: 'public',
            name: 'safe_notes',
            management: 'unbound',
            securityInvoker: true
          }
        ]
      })
    )
    const safeReview = await createSupabaseInspectedMigrationReview({
      application: ownerApplication(),
      snapshot: safeSnapshot
    })
    expect(safeReview.manifest.reviewReady).toBe(true)
    expect(safeReview.manifest.blockers.map((entry) => entry.code)).not.toContain(
      'supabase-public-security-definer-view-blocked'
    )
    expect(safeSnapshot.objectPrivilegeDigest).not.toBe(unsafeSnapshot.objectPrivilegeDigest)

    const tamperedInvokerEvidence = structuredClone(safeSnapshot)
    Reflect.set(tamperedInvokerEvidence.objects[0] ?? {}, 'securityInvoker', false)
    await expect(parseSupabaseInspectedMigrationSnapshot(tamperedInvokerEvidence)).rejects.toThrow(
      'objectPrivilegeDigest'
    )
  })

  test('enables forced RLS even for a created table with no workflow grants', async () => {
    const application = ownerApplication()
    application.workflows.workflows = []
    application.auth.ownership = []
    application.auth.rowAccess = []
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const review = await createSupabaseInspectedMigrationReview({ application, snapshot })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain('ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;')
    expect(review.sql).toContain('ALTER TABLE "public"."notes" FORCE ROW LEVEL SECURITY;')
    expect(review.sql).not.toContain('GRANT SELECT')
    expect(review.sql).not.toContain('CREATE POLICY')
  })

  test('emits declared owner policies and grants without backend workflows', async () => {
    const application = ownerApplication()
    application.workflows.workflows = []
    application.auth.rowAccess[0].operations = ['select', 'insert', 'update', 'delete']
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const review = await createSupabaseInspectedMigrationReview({ application, snapshot })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain('FOR SELECT TO "authenticated" USING ((select auth.uid())')
    expect(review.sql).toContain('FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid())')
    expect(review.sql).toContain('FOR UPDATE TO "authenticated" USING ((select auth.uid())')
    expect(review.sql).toContain('FOR DELETE TO "authenticated" USING ((select auth.uid())')
    expect(review.sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."notes" TO "authenticated";'
    )
  })

  test('blocks update or delete policy intents without select even when no workflow references them', async () => {
    for (const [operation, code] of [
      ['update', 'supabase-update-select-policy-required'],
      ['delete', 'supabase-delete-select-policy-required']
    ] as const) {
      const application = ownerApplication()
      application.workflows.workflows = []
      application.auth.rowAccess[0].operations = [operation]
      const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
      const review = await createSupabaseInspectedMigrationReview({ application, snapshot })

      expect(review.manifest.reviewReady).toBe(false)
      expect(review.manifest.blockers.map((entry) => entry.code)).toContain(code)
      expect(review.sql).not.toContain('BEGIN;')
      expect(review.sql).not.toContain('GRANT UPDATE')
      expect(review.sql).not.toContain('GRANT DELETE')
    }
  })

  test('uses an explicit physical schema digest so FK-backed relation metadata can converge', async () => {
    const relationless: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'user-logical-id',
          name: 'users',
          management: 'managed',
          fields: [{ id: 'user-key-id', name: 'id', type: 'uuid', nullable: false }],
          primaryKey: { fields: ['user-key-id'] }
        },
        {
          id: 'note-logical-id',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'note-key-id', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner-logical-field', name: 'owner_id', type: 'uuid', nullable: false }
          ],
          primaryKey: { fields: ['note-key-id'] },
          foreignKeys: [
            {
              id: 'owner-logical-fk',
              fields: ['owner-logical-field'],
              targetEntityId: 'user-logical-id',
              targetFields: ['user-key-id'],
              onDelete: 'cascade'
            }
          ],
          indexes: [{ id: 'owner-logical-index', fields: ['owner-logical-field'] }]
        }
      ],
      enums: [],
      relations: []
    }
    const target = structuredClone(relationless)
    target.relations = [
      {
        id: 'authored-owner-relation',
        kind: 'one-to-many',
        sourceEntityId: 'note-logical-id',
        targetEntityId: 'user-logical-id',
        sourceForeignKeyId: 'owner-logical-fk'
      }
    ]
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      inspectionForModel(relationless)
    )
    const review = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(target),
      snapshot
    })

    expect(review.manifest.migrationPlan.operations).toEqual([])
    expect(review.manifest.authoredCurrentModelDigest).not.toBe(
      review.manifest.authoredTargetModelDigest
    )
    expect(review.manifest.currentModelDigest).toBe(review.manifest.targetModelDigest)
    expect(review.manifest.currentModelDigest).toBe(digestSupabasePhysicalSchema(relationless))
    expect(digestSupabasePhysicalSchema(target)).toBe(digestSupabasePhysicalSchema(relationless))

    const changedAction = structuredClone(target)
    const changedForeignKey = changedAction.entities[1].foreignKeys?.[0]
    if (!changedForeignKey) throw new Error('Missing foreign-key digest fixture.')
    changedForeignKey.onDelete = 'restrict'
    expect(digestSupabasePhysicalSchema(changedAction)).not.toBe(
      digestSupabasePhysicalSchema(target)
    )
  })

  test('creates physical-name FK constraints only after tables and their explicit index exist', async () => {
    const target: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'users-logical',
          name: 'users',
          management: 'managed',
          fields: [{ id: 'user-primary-logical', name: 'id', type: 'uuid', nullable: false }],
          primaryKey: { fields: ['user-primary-logical'] }
        },
        {
          id: 'notes-logical',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'note-primary-logical', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner-field-logical', name: 'owner_id', type: 'uuid', nullable: false }
          ],
          primaryKey: { fields: ['note-primary-logical'] },
          foreignKeys: [
            {
              id: 'owner-fk-logical',
              fields: ['owner-field-logical'],
              targetEntityId: 'users-logical',
              targetFields: ['user-primary-logical'],
              onDelete: 'cascade'
            }
          ],
          indexes: [{ id: 'owner-index-logical', fields: ['owner-field-logical'] }]
        }
      ],
      enums: [],
      relations: []
    }
    const review = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(target),
      snapshot: await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    })
    const indexName = stableSQLName('openpencil_idx', 'notes:owner_id:asc')
    const foreignKeyName = stableSQLName('openpencil_fk', 'notes:owner_id->users:id:cascade')

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain(`CREATE INDEX "${indexName}" ON "public"."notes" ("owner_id")`)
    expect(review.sql).toContain(
      `ADD CONSTRAINT "${foreignKeyName}" FOREIGN KEY ("owner_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE;`
    )
    expect(review.sql.indexOf('CREATE TABLE "public"."users"')).toBeLessThan(
      review.sql.indexOf(`ADD CONSTRAINT "${foreignKeyName}"`)
    )
    expect(review.sql.indexOf(`CREATE INDEX "${indexName}"`)).toBeLessThan(
      review.sql.indexOf(`ADD CONSTRAINT "${foreignKeyName}"`)
    )
  })

  test('reviews staged FK and unique expansion while keeping live Apply ids empty', async () => {
    const current: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'users-logical',
          name: 'users',
          management: 'managed',
          fields: [{ id: 'user-primary-logical', name: 'id', type: 'uuid', nullable: false }],
          primaryKey: { fields: ['user-primary-logical'] }
        },
        {
          id: 'notes-logical',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'note-primary-logical', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner-field-logical', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'slug-field-logical', name: 'slug', type: 'string', nullable: false }
          ],
          primaryKey: { fields: ['note-primary-logical'] }
        }
      ],
      enums: [],
      relations: []
    }
    const target = structuredClone(current)
    target.entities[1].foreignKeys = [
      {
        id: 'owner-fk-logical',
        fields: ['owner-field-logical'],
        targetEntityId: 'users-logical',
        targetFields: ['user-primary-logical'],
        onDelete: 'cascade'
      }
    ]
    target.entities[1].indexes = [{ id: 'owner-index-logical', fields: ['owner-field-logical'] }]
    target.entities[1].uniques = [{ id: 'slug-unique-logical', fields: ['slug-field-logical'] }]
    const executionPlan = await stagedPlan(current, target, 'expand', [
      {
        id: 'stage-add-fk',
        kind: 'add-foreign-key',
        sourceOperationIds: ['source-add-fk'],
        entityId: 'notes-logical',
        foreignKey: target.entities[1].foreignKeys[0],
        validation: 'deferred'
      },
      {
        id: 'stage-add-unique',
        kind: 'add-unique',
        sourceOperationIds: ['source-add-unique'],
        entityId: 'notes-logical',
        unique: target.entities[1].uniques[0],
        validation: 'deferred'
      }
    ])
    const review = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(target),
      snapshot: await createSupabaseInspectedMigrationSnapshot(inspectionForModel(current)),
      stagedExecution: { executionPlan }
    })
    const indexName = stableSQLName('openpencil_idx', 'notes:owner_id:asc')
    const foreignKeyName = stableSQLName('openpencil_fk', 'notes:owner_id->users:id:cascade')
    const uniqueName = stableSQLName('openpencil_uq', 'notes:slug')

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.manifest.renderedMigrationOperationIds).toEqual([])
    expect(review.manifest.renderedStagedMigrationOperationIds).toEqual([
      'stage-add-fk',
      'stage-add-unique'
    ])
    expect(review.manifest.renderedMigrationPhases).toEqual(['expand'])
    expect(review.sql).toContain(`ADD CONSTRAINT "${uniqueName}" UNIQUE ("slug")`)
    expect(review.sql).toContain(`CREATE INDEX "${indexName}"`)
    expect(review.sql).toContain(`ADD CONSTRAINT "${foreignKeyName}" FOREIGN KEY ("owner_id")`)
    expect(review.sql).toContain('ON DELETE CASCADE NOT VALID;')
    expect(review.sql.indexOf(`CREATE INDEX "${indexName}"`)).toBeLessThan(
      review.sql.indexOf(`ADD CONSTRAINT "${foreignKeyName}"`)
    )
  })

  test('validates exact inspected FK and unique constraints by physical name', async () => {
    const model: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'users-logical',
          name: 'users',
          management: 'managed',
          fields: [{ id: 'user-primary-logical', name: 'id', type: 'uuid', nullable: false }],
          primaryKey: { fields: ['user-primary-logical'] }
        },
        {
          id: 'notes-logical',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'note-primary-logical', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner-field-logical', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'slug-field-logical', name: 'slug', type: 'string', nullable: false }
          ],
          primaryKey: { fields: ['note-primary-logical'] },
          foreignKeys: [
            {
              id: 'owner-fk-logical',
              fields: ['owner-field-logical'],
              targetEntityId: 'users-logical',
              targetFields: ['user-primary-logical'],
              onDelete: 'cascade'
            }
          ],
          indexes: [{ id: 'owner-index-logical', fields: ['owner-field-logical'] }],
          uniques: [{ id: 'slug-unique-logical', fields: ['slug-field-logical'] }]
        }
      ],
      enums: [],
      relations: []
    }
    const predecessorDigest = digestValue('V')
    const executionPlan = await stagedPlan(
      model,
      model,
      'backfill',
      [
        {
          id: 'stage-validate-fk',
          kind: 'validate-foreign-key',
          sourceOperationIds: ['source-add-fk'],
          entityId: 'notes-logical',
          foreignKeyId: 'owner-fk-logical',
          validation: 'existing-and-concurrent-data'
        },
        {
          id: 'stage-validate-unique',
          kind: 'validate-unique',
          sourceOperationIds: ['source-add-unique'],
          entityId: 'notes-logical',
          uniqueId: 'slug-unique-logical',
          validation: 'existing-and-concurrent-data'
        }
      ],
      { phase: 'expand', executionPlanDigest: predecessorDigest, receiptRequired: true }
    )
    const snapshot = await createSupabaseInspectedMigrationSnapshot(inspectionForModel(model))
    const review = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(model),
      snapshot,
      stagedExecution: {
        executionPlan,
        predecessorReceipt: predecessorReceipt('expand', predecessorDigest, snapshot)
      }
    })
    const liveForeignKeyName = stableSQLName('fixture_fk', 'owner-fk-logical')
    const liveUniqueName = stableSQLName('fixture_uq', 'slug-unique-logical')

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain(
      `ALTER TABLE "public"."notes" VALIDATE CONSTRAINT "${liveForeignKeyName}";`
    )
    expect(review.sql).toContain(`constraint_record.conname = E'${liveUniqueName}'`)
    expect(review.sql).toContain('constraint_record.convalidated')
    expect(review.sql).not.toContain('VALIDATE CONSTRAINT "owner-fk-logical"')
  })

  test('requires predecessor evidence for typed backfill and contracts non-null afterward', async () => {
    const nullable: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'jobs-logical',
          name: 'jobs',
          management: 'managed',
          fields: [
            { id: 'job-primary-logical', name: 'id', type: 'uuid', nullable: false },
            { id: 'retry-logical', name: 'retry_count', type: 'integer', nullable: true }
          ],
          primaryKey: { fields: ['job-primary-logical'] }
        }
      ],
      enums: [],
      relations: []
    }
    const predecessorDigest = digestValue('P')
    const backfillPlan = await stagedPlan(
      nullable,
      nullable,
      'backfill',
      [
        {
          id: 'stage-backfill-retry',
          kind: 'backfill-field',
          sourceOperationIds: ['source-add-retry'],
          entityId: 'jobs-logical',
          fieldId: 'retry-logical',
          predicate: 'is-null',
          value: { kind: 'literal', fieldType: 'integer', value: 0 }
        }
      ],
      { phase: 'expand', executionPlanDigest: predecessorDigest, receiptRequired: true }
    )
    const snapshot = await createSupabaseInspectedMigrationSnapshot(inspectionForModel(nullable))
    const missingReceipt = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(nullable),
      snapshot,
      stagedExecution: { executionPlan: backfillPlan }
    })
    expect(missingReceipt.manifest.reviewReady).toBe(false)
    expect(missingReceipt.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-required'
    )
    expect(missingReceipt.sql).not.toContain('BEGIN;')

    const backfill = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(nullable),
      snapshot,
      stagedExecution: {
        executionPlan: backfillPlan,
        predecessorReceipt: predecessorReceipt('expand', predecessorDigest, snapshot)
      }
    })
    expect(backfill.manifest.reviewReady).toBe(true)
    expect(backfill.sql).toContain(
      'UPDATE "public"."jobs" SET "retry_count" = 0::bigint WHERE "retry_count" IS NULL;'
    )

    const nonNull = structuredClone(nullable)
    nonNull.entities[0].fields[1].nullable = false
    const contractPlan = await stagedPlan(
      nullable,
      nonNull,
      'contract',
      [
        {
          id: 'stage-set-retry-not-null',
          kind: 'set-not-null',
          sourceOperationIds: ['source-set-not-null'],
          entityId: 'jobs-logical',
          fieldId: 'retry-logical'
        }
      ],
      { phase: 'backfill', executionPlanDigest: predecessorDigest, receiptRequired: true }
    )
    const contract = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(nonNull),
      snapshot,
      stagedExecution: {
        executionPlan: contractPlan,
        predecessorReceipt: predecessorReceipt('backfill', predecessorDigest, snapshot)
      }
    })
    expect(contract.manifest.reviewReady).toBe(true)
    expect(contract.sql).toContain('WHERE "retry_count" IS NULL')
    expect(contract.sql).toContain(
      'ALTER TABLE "public"."jobs" ALTER COLUMN "retry_count" SET NOT NULL;'
    )
  })

  test('blocks a predecessor receipt promoted into a different environment', async () => {
    const review = await reviewPredecessorAuthority((receipt) => {
      receipt.promotionFrom = 'staging'
      receipt.targetAuthority.environment = 'production'
    })

    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-environment-mismatch'
    )
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-promotion-mismatch'
    )
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('accepts staging-to-production receipt binding while keeping production review blocked', async () => {
    const review = await reviewPredecessorAuthority((receipt) => {
      receipt.promotionFrom = 'staging'
      receipt.targetAuthority.environment = 'production'
      receipt.targetAuthority.grantGeneration = 'grant-production-1'
    }, 'production')
    const codes = review.manifest.blockers.map((entry) => entry.code)

    expect(codes).toContain('supabase-production-migration-approval-required')
    expect(codes).not.toContain('supabase-staged-predecessor-receipt-environment-mismatch')
    expect(codes).not.toContain('supabase-staged-predecessor-receipt-promotion-mismatch')
    expect(review.manifest.applyAllowed).toBe(false)
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('blocks a predecessor receipt from another Supabase project', async () => {
    const review = await reviewPredecessorAuthority((receipt) => {
      receipt.targetAuthority.projectRef = 'project-ref-attacker'
    })

    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-project-mismatch'
    )
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('blocks a predecessor receipt from another Supabase account', async () => {
    const review = await reviewPredecessorAuthority((receipt) => {
      receipt.targetAuthority.accountId = 'account-attacker'
    })

    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-account-mismatch'
    )
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('blocks predecessor schema replay against a different inspected logical model', async () => {
    const review = await reviewPredecessorAuthority((receipt) => {
      receipt.schemaAfterDigest = digestValue('S')
    })

    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-schema-mismatch'
    )
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('blocks a predecessor receipt recorded after the inspected snapshot', async () => {
    const review = await reviewPredecessorAuthority((receipt) => {
      receipt.recordedAt = '2026-08-30T00:00:00.001Z'
    })

    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-future'
    )
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('blocks a predecessor receipt issued by another Backend Provider', async () => {
    const review = await reviewPredecessorAuthority((receipt) => {
      receipt.targetAuthority.providerId = 'attacker-provider'
    })

    expect(review.manifest.reviewReady).toBe(false)
    expect(review.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-predecessor-receipt-provider-mismatch'
    )
    expect(review.sql).not.toContain('BEGIN;')
  })

  test('binds contract renames to inspected and target physical names', async () => {
    const current: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'notes-logical',
          name: 'old_notes',
          management: 'managed',
          fields: [
            { id: 'note-primary-logical', name: 'id', type: 'uuid', nullable: false },
            { id: 'title-logical', name: 'old_title', type: 'string', nullable: true }
          ],
          primaryKey: { fields: ['note-primary-logical'] }
        }
      ],
      enums: [],
      relations: []
    }
    const target = structuredClone(current)
    target.entities[0].name = 'notes'
    target.entities[0].fields[1].name = 'title'
    const predecessorDigest = digestValue('Q')
    const executionPlan = await stagedPlan(
      current,
      target,
      'contract',
      [
        {
          id: 'stage-rename-table',
          kind: 'rename-entity',
          sourceOperationIds: ['source-rename-table'],
          entityId: 'notes-logical',
          fromName: 'old_notes',
          toName: 'notes',
          compatibility: {
            mode: 'expand-contract',
            applicationEvidenceDigest: digestValue('A')
          }
        },
        {
          id: 'stage-rename-column',
          kind: 'rename-field',
          sourceOperationIds: ['source-rename-column'],
          entityId: 'notes-logical',
          fieldId: 'title-logical',
          fromName: 'old_title',
          toName: 'title',
          compatibility: {
            mode: 'expand-contract',
            applicationEvidenceDigest: digestValue('B')
          }
        }
      ],
      { phase: 'backfill', executionPlanDigest: predecessorDigest, receiptRequired: true }
    )
    const snapshot = await createSupabaseInspectedMigrationSnapshot(inspectionForModel(current))
    const review = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(target),
      snapshot,
      stagedExecution: {
        executionPlan,
        predecessorReceipt: predecessorReceipt('backfill', predecessorDigest, snapshot)
      }
    })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain('ALTER TABLE "public"."old_notes" RENAME TO "notes";')
    expect(review.sql).toContain(
      'ALTER TABLE "public"."notes" RENAME COLUMN "old_title" TO "title";'
    )
    expect(review.sql.indexOf('RENAME TO "notes"')).toBeLessThan(
      review.sql.indexOf('RENAME COLUMN "old_title"')
    )
  })

  test('keeps production and destructive staged SQL behind explicit blockers', async () => {
    const current: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'notes-logical',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'note-primary-logical', name: 'id', type: 'uuid', nullable: false },
            { id: 'legacy-logical', name: 'legacy', type: 'string', nullable: true }
          ],
          primaryKey: { fields: ['note-primary-logical'] }
        }
      ],
      enums: [],
      relations: []
    }
    const expanded = structuredClone(current)
    expanded.entities[0].fields.push({
      id: 'summary-logical',
      name: 'summary',
      type: 'string',
      nullable: true
    })
    const productionPlan = await stagedPlan(current, expanded, 'expand', [
      {
        id: 'stage-add-summary',
        kind: 'add-nullable-field',
        sourceOperationIds: ['source-add-summary'],
        entityId: 'notes-logical',
        field: expanded.entities[0].fields[2]
      }
    ])
    const snapshot = await createSupabaseInspectedMigrationSnapshot(inspectionForModel(current))
    const production = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(expanded),
      snapshot,
      environment: 'production',
      stagedExecution: { executionPlan: productionPlan }
    })
    expect(production.manifest.reviewReady).toBe(false)
    expect(production.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-production-migration-approval-required'
    )

    const contracted = structuredClone(current)
    contracted.entities[0].fields.pop()
    const predecessorDigest = digestValue('R')
    const destructivePlan = await stagedPlan(
      current,
      contracted,
      'contract',
      [
        {
          id: 'stage-retire-legacy',
          kind: 'retire-field',
          sourceOperationIds: ['source-drop-legacy'],
          entityId: 'notes-logical',
          fieldId: 'legacy-logical',
          compatibilityEvidenceDigest: digestValue('C')
        }
      ],
      { phase: 'backfill', executionPlanDigest: predecessorDigest, receiptRequired: true }
    )
    const destructive = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(contracted),
      snapshot,
      stagedExecution: {
        executionPlan: destructivePlan,
        predecessorReceipt: predecessorReceipt('backfill', predecessorDigest, snapshot)
      }
    })
    expect(destructive.manifest.reviewReady).toBe(false)
    expect(destructive.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-destructive-approval-required'
    )
    expect(destructive.sql).not.toContain('DROP COLUMN')
    expect(destructive.sql).not.toContain('BEGIN;')
  })

  test('emits reviewed UUID and identity default intent without arbitrary expressions', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const application = ownerApplication()
    application.dataModel.entities[0].fields[0].default = {
      kind: 'generated',
      generator: 'uuid'
    }
    const uuidReview = await createSupabaseInspectedMigrationReview({ application, snapshot })
    expect(uuidReview.manifest.reviewReady).toBe(true)
    expect(uuidReview.sql).toContain('uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL')

    application.dataModel.entities[0].fields[0] = {
      id: 'id',
      name: 'id',
      type: 'integer',
      nullable: false,
      default: { kind: 'generated', generator: 'identity' }
    }
    application.auth.rowAccess = []
    application.workflows.workflows = []
    const identityReview = await createSupabaseInspectedMigrationReview({
      application,
      snapshot
    })
    expect(identityReview.manifest.reviewReady).toBe(true)
    expect(identityReview.sql).toContain('bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL')
    expect(identityReview.sql).not.toMatch(/DEFAULT\s+[^;]*(?:select|execute|do)\b/iu)
  })

  test('adds identity only to an inspected NOT NULL column and resynchronizes its sequence', async () => {
    const current: DataModelIR = {
      version: 1,
      entities: [
        {
          id: 'jobs',
          name: 'jobs',
          management: 'managed',
          fields: [
            { id: 'id', name: 'id', type: 'uuid', nullable: false },
            { id: 'counter', name: 'counter', type: 'integer', nullable: false }
          ],
          primaryKey: { fields: ['id'] }
        }
      ],
      enums: [],
      relations: []
    }
    const target = structuredClone(current)
    target.entities[0].fields[1].default = { kind: 'generated', generator: 'identity' }
    const executionPlan = await stagedPlan(current, target, 'expand', [
      {
        id: 'stage-identity-counter',
        kind: 'set-generated-default',
        sourceOperationIds: ['source-identity-counter'],
        entityId: 'jobs',
        fieldId: 'counter',
        fieldType: 'integer',
        generator: 'identity',
        appliesTo: 'future-writes'
      }
    ])
    const review = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(target),
      snapshot: await createSupabaseInspectedMigrationSnapshot(inspectionForModel(current)),
      stagedExecution: { executionPlan }
    })

    expect(review.manifest.reviewReady).toBe(true)
    expect(review.sql).toContain(
      'ALTER TABLE "public"."jobs" ALTER COLUMN "counter" ADD GENERATED BY DEFAULT AS IDENTITY;'
    )
    expect(review.sql).toContain('pg_catalog.pg_get_serial_sequence')
    expect(review.sql).toContain(
      'PERFORM pg_catalog.setval(identity_sequence, next_identity::bigint, false);'
    )
    expect(review.sql.indexOf('ADD GENERATED BY DEFAULT AS IDENTITY')).toBeLessThan(
      review.sql.indexOf('pg_catalog.setval')
    )

    const nullableTarget = structuredClone(current)
    nullableTarget.entities[0].fields.push({
      id: 'next_counter',
      name: 'next_counter',
      type: 'integer',
      nullable: true,
      default: { kind: 'generated', generator: 'identity' }
    })
    const blockedPlan = await stagedPlan(current, nullableTarget, 'expand', [
      {
        id: 'stage-add-next-counter',
        kind: 'add-nullable-field',
        sourceOperationIds: ['source-add-next-counter'],
        entityId: 'jobs',
        field: nullableTarget.entities[0].fields[2]
      },
      {
        id: 'stage-identity-next-counter',
        kind: 'set-generated-default',
        sourceOperationIds: ['source-add-next-counter'],
        entityId: 'jobs',
        fieldId: 'next_counter',
        fieldType: 'integer',
        generator: 'identity',
        appliesTo: 'future-writes'
      }
    ])
    const blocked = await createSupabaseInspectedMigrationReview({
      application: schemaApplication(nullableTarget),
      snapshot: await createSupabaseInspectedMigrationSnapshot(inspectionForModel(current)),
      stagedExecution: { executionPlan: blockedPlan }
    })
    expect(blocked.manifest.reviewReady).toBe(false)
    expect(blocked.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-staged-identity-non-null-source-required'
    )
    expect(blocked.sql).not.toContain('ADD GENERATED BY DEFAULT AS IDENTITY')
  })
})
