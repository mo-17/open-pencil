/* eslint-disable max-lines -- Staged, ordinary, Storage, ledger, and tamper cases share one source-bundle trust fixture. */
import { describe, expect, test } from 'bun:test'

import { digestCanonicalBackendValue } from '#compiler/backend/canonical'
import {
  SUPABASE_ARTIFACT_PATHS,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  type BackendProviderEmission,
  type BackendProviderSelection
} from '#compiler/backend/index'
import {
  createSupabaseInspectedMigrationSnapshot,
  type CreateSupabaseInspectedMigrationSnapshotInputV1
} from '#compiler/backend/supabase/inspection'
import {
  createSupabaseInspectedMigrationReview,
  digestSupabaseInspectedMigrationReviewManifest
} from '#compiler/backend/supabase/migration-review'
import {
  canonicalSupabaseInspectedSourceMigrationLedgerJSON,
  createSupabaseInspectedSourceMigrationLedger,
  createSupabaseSourceMigrationBundle,
  verifySupabaseInspectedSourceMigrationLedgerIntegrity
} from '#compiler/backend/supabase/source-migration'
import { composeAtomicSupabaseSourceMigrationSQL } from '#compiler/backend/supabase/source-migration-sql'

import {
  STAGED_MIGRATION_EXECUTION_FORMAT,
  createSourceMigrationLedger,
  planBackendMigration,
  verifySourceMigrationLedgerIntegrity,
  type BackendApplicationSpecV1,
  type DataFieldIR,
  type DataModelIR,
  type StagedMigrationExecutionPlanV1
} from '@open-pencil/lowcode/backend'

const NOW = '2026-09-03T12:34:56.000Z'
const PACKAGE_DIGEST = `app-bundle-sha256:${'A'.repeat(43)}`
const PROJECT_REF = 'abcdefghijklmnopqrst'
const PROMOTION_LEDGER_ID = `supabase:${PROJECT_REF}:promotion`
const INSPECTED_LEDGER_ID = `supabase:${PROJECT_REF}:inspected`

const COVERAGE = {
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

const titleField: DataFieldIR = {
  id: 'title',
  name: 'title',
  type: 'string',
  nullable: true
}

function model(withTitle: boolean): DataModelIR {
  return {
    version: 1,
    entities: [
      {
        id: 'notes',
        name: 'notes',
        management: 'managed',
        fields: [
          { id: 'id', name: 'id', type: 'uuid', nullable: false },
          ...(withTitle ? [titleField] : [])
        ],
        primaryKey: { fields: ['id'] },
        indexes: []
      }
    ],
    enums: [],
    relations: []
  }
}

function application(withStorage = false): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'source-migration-test',
    dataModel: model(true),
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    ...(withStorage
      ? {
          storage: {
            version: 1 as const,
            buckets: [
              {
                id: 'user-assets',
                name: 'user-assets',
                access: 'private' as const,
                maxObjectBytes: 5_000_000,
                allowedMimeTypes: ['image/png'],
                pathRules: [
                  {
                    id: 'owner-files',
                    prefix: ['users'],
                    principal: { kind: 'owner' as const },
                    operations: ['read', 'create', 'update', 'delete', 'upsert'] as const
                  }
                ]
              }
            ]
          }
        }
      : {}),
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true },
      ...(withStorage ? ([{ capability: 'storage.objects', required: true }] as const) : [])
    ],
    secrets: []
  }
}

const selection: BackendProviderSelection = {
  descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  packageDigest: PACKAGE_DIGEST,
  enabled: true
}

function emission(application: BackendApplicationSpecV1): BackendProviderEmission {
  const registry = createBuiltinBackendProviderRegistry()
  const planned = createBackendProviderPlan(registry, {
    selection,
    application,
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(planned.diagnostics.map((entry) => entry.code).join(', '))
  const emitted = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
  if (!emitted.ok) throw new Error(emitted.diagnostics.map((entry) => entry.code).join(', '))
  return emitted.emission
}

function inspection(
  current: DataModelIR = model(false)
): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  const hasNotes = current.entities.some((entity) => entity.id === 'notes')
  return {
    provenance: {
      projectRef: PROJECT_REF,
      accountId: 'account-1',
      querySchemaVersion: 'catalog-v1',
      databaseRole: 'postgres',
      observedAt: '2026-09-03T12:30:00.000Z',
      completeness: 'complete',
      truncated: false
    },
    currentModel: current,
    coverage: COVERAGE,
    objects: hasNotes
      ? [
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
        ]
      : [],
    columns: hasNotes
      ? [
          {
            schema: 'public',
            tableName: 'notes',
            name: 'id',
            columnPrivilegesPresent: false,
            management: 'managed',
            openPencilFieldId: 'id',
            type: 'uuid',
            nullable: false,
            default: null,
            address: { classOid: '1259', objectOid: '60000', subId: 1 },
            typeOid: '2950',
            defaultExpressionDigest: null,
            identityKind: '',
            generatedKind: ''
          }
        ]
      : [],
    constraints: hasNotes
      ? [
          {
            kind: 'primary-key',
            schema: 'public',
            tableName: 'notes',
            name: 'live_pk_notes',
            management: 'managed',
            openPencilId: 'notes',
            fields: ['id'],
            address: { classOid: '2606', objectOid: '70000', subId: 0 },
            definitionDigest: 'C'.repeat(43),
            validated: true
          }
        ]
      : [],
    indexes: [],
    roles: [
      { roleName: 'postgres', superuser: true, bypassRls: true, inherit: true },
      { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true }
    ],
    roleMemberships: [],
    policies: [],
    storageBuckets: [],
    storagePolicies: [],
    privileges: [],
    defaultPrivileges: []
  }
}

async function reviewedFixture(
  options: { staged?: boolean; storage?: boolean; create?: boolean } = {}
) {
  const current = options.create
    ? { version: 1 as const, entities: [], enums: [], relations: [] }
    : model(false)
  const target = model(true)
  const app = application(options.storage)
  // The staged fixture is intentionally independent from the inspected-current variant below.
  const sourcePlan = await planBackendMigration(model(false), target)
  const sourceOperation = sourcePlan.operations.find(
    (entry) => entry.operation.kind === 'add-field'
  )
  if (!sourceOperation) throw new Error('expected an add-field source operation')
  const executionPlan: StagedMigrationExecutionPlanV1 = {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: 1,
    executionId: 'expand-title-v1',
    changeId: 'notes-title-v1',
    sourceMigrationPlan: {
      version: 1,
      planId: sourcePlan.planId,
      planDigest: digestCanonicalBackendValue(sourcePlan, '$.test.sourcePlan'),
      fromModelDigest: sourcePlan.fromModelDigest ?? null,
      targetModelDigest: sourcePlan.targetModelDigest
    },
    phase: 'expand',
    predecessor: null,
    operations: [
      {
        operation: {
          id: 'expand-add-title',
          kind: 'add-nullable-field',
          sourceOperationIds: [sourceOperation.operation.id],
          entityId: 'notes',
          field: titleField
        },
        risk: 'low'
      }
    ],
    highestRisk: 'low',
    requiresHumanApproval: false
  }
  const snapshot = await createSupabaseInspectedMigrationSnapshot(inspection(current))
  const reviewed = await createSupabaseInspectedMigrationReview({
    application: app,
    snapshot,
    expectedProjectRef: PROJECT_REF,
    expectedAccountId: 'account-1',
    environment: 'staging',
    ...(options.staged === false ? {} : { stagedExecution: { executionPlan } })
  })
  return { application: app, emission: emission(app), executionPlan, reviewed }
}

describe('Supabase source migration bundle', () => {
  test('strictly rejects malformed or nested transaction wrappers before composing SQL', () => {
    const review = '-- review\nBEGIN;\nSELECT 1;\nCOMMIT;\n'
    const storage = '-- storage\nBEGIN;\nSELECT 2;\nCOMMIT;\n'
    const composed = composeAtomicSupabaseSourceMigrationSQL(review, storage)
    expect(composed.split('\n').filter((line) => line === 'BEGIN;')).toHaveLength(1)
    expect(composed.split('\n').filter((line) => line === 'COMMIT;')).toHaveLength(1)
    expect(composed.indexOf('SELECT 1;')).toBeLessThan(composed.indexOf('SELECT 2;'))
    expect(composed.indexOf('SELECT 2;')).toBeLessThan(composed.indexOf('COMMIT;'))

    for (const malformed of [
      '-- storage\nSELECT 2;\nCOMMIT;\n',
      '-- storage\nBEGIN;\nCOMMIT;\nSELECT 2;\n',
      '-- storage\nBEGIN;\nROLLBACK;\nCOMMIT;\n',
      '-- storage\r\nBEGIN;\r\nSELECT 2;\r\nCOMMIT;\r\n',
      'SET ROLE postgres;\nBEGIN;\nSELECT 2;\nCOMMIT;\n'
    ]) {
      expect(() => composeAtomicSupabaseSourceMigrationSQL(review, malformed)).toThrow(
        'source migration bundle is invalid'
      )
    }
  })

  test('emits digest-bound SQL and an updated source ledger without filesystem authority', async () => {
    const fixture = await reviewedFixture()
    expect(fixture.reviewed.manifest.reviewReady).toBe(true)
    const initialLedger = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const sourceLedger = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const bundle = await createSupabaseSourceMigrationBundle({
      reviewed: fixture.reviewed,
      executionPlan: fixture.executionPlan,
      ledger: initialLedger,
      sourceLedger,
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'notes-title-expand-v1',
      name: 'notes-title-expand',
      registeredAt: NOW
    })
    expect(bundle.manifest.sourceMigration.path).toBe(
      'supabase/migrations/20260903123456_notes-title-expand.sql'
    )
    expect(bundle.files[0].content).toBe(fixture.reviewed.sql)
    expect(bundle.files[0].digest).toBe(fixture.reviewed.manifest.sqlDigest)
    expect(bundle.files.map((file) => file.path)).toContain(
      'supabase/openpencil-inspected-source-ledger.json'
    )
    expect(bundle.files.map((file) => file.path)).toContain(
      'supabase/openpencil-migration-ledger.json'
    )
    const inspectedLedgerFile = bundle.files.find(
      (file) => file.path === 'supabase/openpencil-inspected-source-ledger.json'
    )
    expect(inspectedLedgerFile?.content).toBe(
      canonicalSupabaseInspectedSourceMigrationLedgerJSON(bundle.sourceLedger)
    )
    expect(bundle.ledger.entries).toHaveLength(1)
    expect(bundle.sourceLedger.entries).toHaveLength(1)
    expect(bundle.sourceLedger.entries[0]).toMatchObject({
      reviewManifestDigest: fixture.reviewed.manifestDigest,
      migrationPlanDigest: fixture.reviewed.manifest.migrationPlanDigest,
      stagedExecutionPlanDigest: bundle.manifest.executionPlanDigest,
      storagePolicyArtifactDigest: null
    })
    expect(bundle.ledger.entries[0]?.executionPlanDigest).toBe(bundle.manifest.executionPlanDigest)
    expect(await verifySourceMigrationLedgerIntegrity(bundle.ledger)).toMatchObject({ ok: true })
    expect(
      verifySupabaseInspectedSourceMigrationLedgerIntegrity(bundle.sourceLedger)
    ).toMatchObject({
      ok: true
    })
    expect(Object.isFrozen(bundle)).toBe(true)
  })

  test('exports a real staged review with exact non-empty rendered operation coverage', async () => {
    const fixture = await reviewedFixture()
    expect(fixture.reviewed.manifest.renderedStagedMigrationOperationIds).toEqual([
      'expand-add-title'
    ])
    expect(fixture.reviewed.manifest.renderedMigrationOperationIds).toEqual([])

    const bundle = await createSupabaseSourceMigrationBundle({
      reviewed: fixture.reviewed,
      executionPlan: fixture.executionPlan,
      ledger: createSourceMigrationLedger({
        ledgerId: PROMOTION_LEDGER_ID,
        createdAt: '2026-09-03T12:00:00.000Z'
      }),
      sourceLedger: createSupabaseInspectedSourceMigrationLedger({
        ledgerId: INSPECTED_LEDGER_ID,
        createdAt: '2026-09-03T12:00:00.000Z'
      }),
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'exact-staged-coverage-v1',
      name: 'exact-staged-coverage',
      registeredAt: NOW
    })

    expect(bundle.manifest.executionPlanDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(bundle.ledger.entries[0]?.executionPlan.operations[0]?.operation.id).toBe(
      'expand-add-title'
    )
  })

  test('rejects missing, foreign, or source-unbound staged operation ids', async () => {
    const fixture = await reviewedFixture()
    const promotionLedger = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const sourceLedger = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const input = {
      executionPlan: fixture.executionPlan,
      ledger: promotionLedger,
      sourceLedger,
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'staged-id-tamper-v1',
      name: 'staged-id-tamper',
      registeredAt: NOW
    } as const
    for (const renderedStagedMigrationOperationIds of [[], ['foreign-staged-operation']]) {
      const manifest = {
        ...fixture.reviewed.manifest,
        renderedStagedMigrationOperationIds
      }
      const reviewed = {
        ...fixture.reviewed,
        manifest,
        manifestDigest: digestSupabaseInspectedMigrationReviewManifest(manifest)
      }
      await expect(createSupabaseSourceMigrationBundle({ ...input, reviewed })).rejects.toThrow(
        'exact staged operation id set'
      )
    }

    const firstOperation = fixture.executionPlan.operations[0]
    const foreignSourceExecutionPlan: StagedMigrationExecutionPlanV1 = {
      ...fixture.executionPlan,
      operations: [
        {
          ...firstOperation,
          operation: {
            ...firstOperation.operation,
            sourceOperationIds: ['foreign-source-operation']
          }
        }
      ]
    }
    const foreignSourceReview = await createSupabaseInspectedMigrationReview({
      application: fixture.application,
      snapshot: fixture.reviewed.snapshot,
      expectedProjectRef: PROJECT_REF,
      expectedAccountId: 'account-1',
      environment: 'staging',
      stagedExecution: { executionPlan: foreignSourceExecutionPlan }
    })
    expect(foreignSourceReview.manifest.reviewReady).toBe(true)
    await expect(
      createSupabaseSourceMigrationBundle({
        ...input,
        reviewed: foreignSourceReview,
        executionPlan: foreignSourceExecutionPlan
      })
    ).rejects.toThrow('not bound to the reviewed source operations')
  })

  test('normalizes an ordinary additive review into exact source and promotion authority', async () => {
    const fixture = await reviewedFixture({ staged: false })
    expect(fixture.reviewed.manifest.reviewReady).toBe(true)
    expect(fixture.reviewed.manifest.stagedExecutionPlan).toBeNull()
    const promotionLedger = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const sourceLedger = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })

    const bundle = await createSupabaseSourceMigrationBundle({
      reviewed: fixture.reviewed,
      ledger: promotionLedger,
      sourceLedger,
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'notes-title-additive-v1',
      name: 'notes-title-additive',
      registeredAt: NOW
    })

    expect(bundle.manifest.executionPlanDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(bundle.manifest.promotionLedger).not.toBeNull()
    expect(bundle.ledger.entries).toHaveLength(1)
    expect(bundle.sourceLedger.entries).toHaveLength(1)
    expect(bundle.sourceLedger.entries[0]?.stagedExecutionPlanDigest).toBe(
      bundle.manifest.executionPlanDigest
    )
    expect(bundle.files[0]?.content).toBe(fixture.reviewed.sql)
    const authority = bundle.ledger.entries[0]?.executionPlan.operations[0]?.operation
    expect(authority?.kind).toBe('apply-reviewed-migration')
    if (authority?.kind !== 'apply-reviewed-migration') {
      throw new Error('expected compiler-derived reviewed SQL authority')
    }
    expect(authority.sourceOperationIds).toEqual(
      fixture.reviewed.manifest.renderedMigrationOperationIds
    )
    expect(authority.reviewManifestDigest).toBe(fixture.reviewed.manifestDigest)
    expect(authority.migrationPlanDigest).toBe(fixture.reviewed.manifest.migrationPlanDigest)
    expect(authority.sqlDigest).toBe(bundle.files[0]?.digest)
    expect(bundle.files.map((file) => file.kind)).toContain('promotion-ledger')
    expect(await verifySourceMigrationLedgerIntegrity(bundle.ledger)).toMatchObject({ ok: true })
    expect(
      verifySupabaseInspectedSourceMigrationLedgerIntegrity(bundle.sourceLedger)
    ).toMatchObject({
      ok: true
    })
  })

  test('registers an ordinary create-entity review in the promotion ledger', async () => {
    const fixture = await reviewedFixture({ staged: false, create: true })
    expect(fixture.reviewed.manifest.blockers).toEqual([])
    expect(fixture.reviewed.manifest.reviewReady).toBe(true)
    expect(
      fixture.reviewed.manifest.migrationPlan.operations.map(({ operation }) => operation.kind)
    ).toEqual(['create-entity'])
    const bundle = await createSupabaseSourceMigrationBundle({
      reviewed: fixture.reviewed,
      ledger: createSourceMigrationLedger({
        ledgerId: PROMOTION_LEDGER_ID,
        createdAt: '2026-09-03T12:00:00.000Z'
      }),
      sourceLedger: createSupabaseInspectedSourceMigrationLedger({
        ledgerId: INSPECTED_LEDGER_ID,
        createdAt: '2026-09-03T12:00:00.000Z'
      }),
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'create-notes-v1',
      name: 'create-notes',
      registeredAt: NOW
    })
    expect(bundle.manifest.executionPlanDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(bundle.files[0]?.content).toContain('CREATE TABLE "public"."notes"')
    expect(bundle.sourceLedger.entries[0]?.migrationPlanDigest).toBe(
      fixture.reviewed.manifest.migrationPlanDigest
    )
    const operation = bundle.ledger.entries[0]?.executionPlan.operations[0]?.operation
    expect(operation?.kind).toBe('apply-reviewed-migration')
    if (operation?.kind === 'apply-reviewed-migration') {
      expect(operation.sourceOperationIds).toEqual(
        fixture.reviewed.manifest.renderedMigrationOperationIds
      )
      expect(operation.sqlDigest).toBe(bundle.files[0]?.digest)
    }
  })

  test('appends only the exact trusted emission Storage SQL and binds both provider plan digests', async () => {
    const fixture = await reviewedFixture({ staged: false, storage: true })
    const storageSQL = fixture.emission.files.get(SUPABASE_ARTIFACT_PATHS.storagePolicy)
    if (typeof storageSQL !== 'string') throw new Error('expected Storage SQL')
    const promotionLedger = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const sourceLedger = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const bundle = await createSupabaseSourceMigrationBundle({
      reviewed: fixture.reviewed,
      ledger: promotionLedger,
      sourceLedger,
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'notes-storage-v1',
      name: 'notes-storage',
      registeredAt: NOW
    })

    const migrationSQL = bundle.files[0]?.content ?? ''
    expect(migrationSQL.split('\n').filter((line) => line === 'BEGIN;')).toHaveLength(1)
    expect(migrationSQL.split('\n').filter((line) => line === 'COMMIT;')).toHaveLength(1)
    expect(migrationSQL).not.toContain('COMMIT;\n-- OpenPencil Supabase Storage proposal v1.')
    const beginIndex = migrationSQL.indexOf('BEGIN;')
    const storageIndex = migrationSQL.indexOf('INSERT INTO storage.buckets')
    const commitIndex = migrationSQL.lastIndexOf('COMMIT;')
    expect(beginIndex).toBeGreaterThan(-1)
    expect(storageIndex).toBeGreaterThan(beginIndex)
    expect(commitIndex).toBeGreaterThan(storageIndex)
    // A PostgreSQL error in the Storage segment now occurs before the only COMMIT, so the schema
    // segment cannot become durable independently of the Storage segment.
    const simulatedFailingSQL = migrationSQL.replace(
      'INSERT INTO storage.buckets',
      'SELECT pg_catalog.raise_forbidden_storage_failure();\nINSERT INTO storage.buckets'
    )
    const schemaMutationIndex = simulatedFailingSQL.indexOf('ADD COLUMN "title"')
    const simulatedFailureIndex = simulatedFailingSQL.indexOf('raise_forbidden_storage_failure')
    expect(schemaMutationIndex).toBeGreaterThan(simulatedFailingSQL.indexOf('BEGIN;'))
    expect(simulatedFailureIndex).toBeGreaterThan(schemaMutationIndex)
    expect(simulatedFailureIndex).toBeLessThan(simulatedFailingSQL.indexOf('COMMIT;'))
    expect(bundle.manifest.applicationDigest).toBe(fixture.reviewed.manifest.applicationDigest)
    expect(bundle.manifest.migrationPlanDigest).toBe(fixture.reviewed.manifest.migrationPlanDigest)
    expect(bundle.manifest.emissionManifestDigest).toBe(fixture.emission.manifestDigest)
    expect(bundle.manifest.emissionPlanDigest).toBe(fixture.emission.manifest.planDigest)
    expect(bundle.manifest.storagePolicyArtifactDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(bundle.sourceLedger.entries[0]?.storagePolicyArtifactDigest).toBe(
      bundle.manifest.storagePolicyArtifactDigest
    )

    const tamperedFiles = new Map(fixture.emission.files)
    tamperedFiles.set(SUPABASE_ARTIFACT_PATHS.storagePolicy, `${storageSQL}\n-- caller SQL`)
    await expect(
      createSupabaseSourceMigrationBundle({
        reviewed: fixture.reviewed,
        ledger: promotionLedger,
        sourceLedger,
        application: fixture.application,
        emission: { ...fixture.emission, files: tamperedFiles },
        migrationId: 'notes-storage-tampered-v1',
        name: 'notes-storage-tampered',
        registeredAt: NOW
      })
    ).rejects.toThrow('emission')
  })

  test('binds a Storage-only source migration with an exact composed SQL digest', async () => {
    const emptyModel: DataModelIR = { version: 1, entities: [], enums: [], relations: [] }
    const storageOnlyApplication: BackendApplicationSpecV1 = {
      ...application(true),
      dataModel: emptyModel
    }
    const snapshot = await createSupabaseInspectedMigrationSnapshot(inspection(emptyModel))
    const reviewed = await createSupabaseInspectedMigrationReview({
      application: storageOnlyApplication,
      snapshot,
      expectedProjectRef: PROJECT_REF,
      expectedAccountId: 'account-1',
      environment: 'staging'
    })
    expect(reviewed.manifest.reviewReady).toBe(true)
    expect(reviewed.manifest.renderedMigrationOperationIds).toEqual([])
    const bundle = await createSupabaseSourceMigrationBundle({
      reviewed,
      ledger: createSourceMigrationLedger({
        ledgerId: PROMOTION_LEDGER_ID,
        createdAt: '2026-09-03T12:00:00.000Z'
      }),
      sourceLedger: createSupabaseInspectedSourceMigrationLedger({
        ledgerId: INSPECTED_LEDGER_ID,
        createdAt: '2026-09-03T12:00:00.000Z'
      }),
      application: storageOnlyApplication,
      emission: emission(storageOnlyApplication),
      migrationId: 'storage-only-v1',
      name: 'storage-only',
      registeredAt: NOW
    })
    const authority = bundle.ledger.entries[0]?.executionPlan.operations[0]?.operation
    expect(authority?.kind).toBe('apply-reviewed-migration')
    if (authority?.kind !== 'apply-reviewed-migration') {
      throw new Error('expected compiler-derived reviewed Storage authority')
    }
    expect(authority.sourceOperationIds).toEqual([])
    expect(authority.sqlDigest).toBe(bundle.files[0]?.digest)
    expect(bundle.files[0]?.content).toContain('INSERT INTO storage.buckets')
    expect(bundle.files[0]?.content).toContain('OpenPencil Supabase inspected Storage migration')
  })

  test('source ledger is deterministic and rejects a digest-chain tamper', async () => {
    const fixture = await reviewedFixture({ staged: false })
    const promotionLedger = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const sourceLedger = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const input = {
      reviewed: fixture.reviewed,
      ledger: promotionLedger,
      sourceLedger,
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'deterministic-v1',
      name: 'deterministic',
      registeredAt: NOW
    } as const
    const first = await createSupabaseSourceMigrationBundle(input)
    const second = await createSupabaseSourceMigrationBundle(input)
    expect(second).toEqual(first)

    const tampered = structuredClone(first.sourceLedger)
    tampered.entries[0].migrationPlanDigest = 'B'.repeat(43)
    expect(verifySupabaseInspectedSourceMigrationLedgerIntegrity(tampered)).toMatchObject({
      ok: false
    })
    await expect(
      createSupabaseSourceMigrationBundle({
        ...input,
        sourceLedger: tampered,
        migrationId: 'deterministic-v2',
        name: 'deterministic-two',
        registeredAt: '2026-09-03T12:35:56.000Z'
      })
    ).rejects.toThrow('inspected source ledger')
  })

  test('rejects cross-project source and promotion ledgers at the compiler boundary', async () => {
    const fixture = await reviewedFixture({ staged: false })
    const validPromotion = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const validSource = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const input = {
      reviewed: fixture.reviewed,
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'foreign-ledger-v1',
      name: 'foreign-ledger',
      registeredAt: NOW
    } as const

    await expect(
      createSupabaseSourceMigrationBundle({
        ...input,
        ledger: validPromotion,
        sourceLedger: createSupabaseInspectedSourceMigrationLedger({
          ledgerId: 'supabase:foreignprojectref123:inspected',
          createdAt: '2026-09-03T12:00:00.000Z'
        })
      })
    ).rejects.toThrow('different Supabase project')
    await expect(
      createSupabaseSourceMigrationBundle({
        ...input,
        ledger: createSourceMigrationLedger({
          ledgerId: 'supabase:foreignprojectref123:promotion',
          createdAt: '2026-09-03T12:00:00.000Z'
        }),
        sourceLedger: validSource
      })
    ).rejects.toThrow('different Supabase project')
  })

  test('rejects review or execution-plan drift before producing source artifacts', async () => {
    const fixture = await reviewedFixture()
    const ledger = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const sourceLedger = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    await expect(
      createSupabaseSourceMigrationBundle({
        reviewed: { ...fixture.reviewed, sql: `${fixture.reviewed.sql}\n-- drift` },
        executionPlan: fixture.executionPlan,
        ledger,
        sourceLedger,
        application: fixture.application,
        emission: fixture.emission,
        migrationId: 'notes-title-expand-v1',
        name: 'notes-title-expand',
        registeredAt: NOW
      })
    ).rejects.toThrow('integrity')
    await expect(
      createSupabaseSourceMigrationBundle({
        reviewed: fixture.reviewed,
        executionPlan: { ...fixture.executionPlan, executionId: 'tampered' },
        ledger,
        sourceLedger,
        application: fixture.application,
        emission: fixture.emission,
        migrationId: 'notes-title-expand-v1',
        name: 'notes-title-expand',
        registeredAt: NOW
      })
    ).rejects.toThrow('execution plan differs')
  })

  test('rejects a second Supabase migration version within the same UTC second', async () => {
    const fixture = await reviewedFixture()
    const initialLedger = createSourceMigrationLedger({
      ledgerId: PROMOTION_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const sourceLedger = createSupabaseInspectedSourceMigrationLedger({
      ledgerId: INSPECTED_LEDGER_ID,
      createdAt: '2026-09-03T12:00:00.000Z'
    })
    const first = await createSupabaseSourceMigrationBundle({
      reviewed: fixture.reviewed,
      executionPlan: fixture.executionPlan,
      ledger: initialLedger,
      sourceLedger,
      application: fixture.application,
      emission: fixture.emission,
      migrationId: 'notes-title-expand-v1',
      name: 'notes-title-expand',
      registeredAt: NOW
    })

    await expect(
      createSupabaseSourceMigrationBundle({
        reviewed: fixture.reviewed,
        executionPlan: fixture.executionPlan,
        ledger: first.ledger,
        sourceLedger: first.sourceLedger,
        application: fixture.application,
        emission: fixture.emission,
        migrationId: 'notes-title-expand-v2',
        name: 'notes-title-expand-again',
        registeredAt: '2026-09-03T12:34:56.999Z'
      })
    ).rejects.toThrow('migration source version already exists')
  })
})
