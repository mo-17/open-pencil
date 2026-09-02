/* eslint-disable max-lines -- inspected migration security invariants share one strict snapshot/review fixture */
import { describe, expect, test } from 'bun:test'

import {
  createSupabaseInspectedMigrationSnapshot,
  parseSupabaseInspectedMigrationSnapshot,
  type CreateSupabaseInspectedMigrationSnapshotInputV1
} from '#compiler/backend/supabase/inspection'
import { createSupabaseInspectedMigrationReview } from '#compiler/backend/supabase/migration-review'

import type { BackendApplicationSpecV1, DataModelIR } from '@open-pencil/lowcode/backend'

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
      `COMMENT ON TABLE "public"."notes" IS 'openpencil:v1:entity:notes';`
    )
    expect(review.sql).toContain(
      `COMMENT ON COLUMN "public"."notes"."owner_id" IS 'openpencil:v1:field:owner_id';`
    )
    expect(review.sql).toContain(`IS 'openpencil:v1:policy:openpencil_policy_`)
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
      `CREATE TYPE "public"."note_status" AS ENUM ('draft', 'published');`
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
            values: ['draft']
          },
          {
            kind: 'table',
            schema: 'public',
            name: 'notes',
            management: 'managed',
            openPencilId: 'notes',
            rlsEnabled: true,
            rlsForced: true
          }
        ],
        columns: current.dataModel.entities[0].fields.map((field) => ({
          schema: 'public' as const,
          tableName: 'notes',
          name: field.name,
          columnPrivilegesPresent: false as const,
          management: 'managed' as const,
          openPencilFieldId: field.id,
          type: field.type,
          ...(field.type === 'enum' ? { enumName: 'note_status' } : {}),
          nullable: field.nullable,
          default: null
        })),
        constraints: [
          {
            kind: 'primary-key',
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_pk_notes',
            management: 'managed',
            openPencilId: 'notes',
            fields: ['id']
          }
        ],
        indexes: [
          {
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_idx_owner',
            management: 'managed',
            openPencilId: 'notes_owner_idx',
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
    expect(enumOnlyFirst.sql).toContain(`ALTER TYPE "public"."note_status" ADD VALUE 'published';`)
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
            rlsEnabled: true,
            rlsForced: true
          }
        ],
        columns: application.dataModel.entities[0].fields.map((field) => ({
          schema: 'public' as const,
          tableName: 'notes',
          name: field.name,
          columnPrivilegesPresent: false as const,
          management: 'managed' as const,
          openPencilFieldId: field.id,
          type: field.type,
          nullable: field.nullable,
          default: null
        })),
        constraints: [
          {
            kind: 'primary-key',
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_pk_notes',
            management: 'managed',
            openPencilId: 'notes',
            fields: ['id']
          }
        ],
        indexes: [
          {
            schema: 'public',
            tableName: 'notes',
            name: 'openpencil_idx_owner',
            management: 'managed',
            openPencilId: 'notes_owner_idx',
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
            usingExpressionDigest: 'A'.repeat(43),
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
            withCheckExpressionDigest: 'B'.repeat(43)
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
    const databaseRoleTamper = structuredClone(snapshot)
    Reflect.set(databaseRoleTamper.provenance, 'databaseRole', 'anon')
    await expect(parseSupabaseInspectedMigrationSnapshot(databaseRoleTamper)).rejects.toThrow(
      'objectPrivilegeDigest'
    )

    const tampered = structuredClone(snapshot)
    Reflect.set(tampered, 'currentModelDigest', 'A'.repeat(43))
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
        expectedTargetModelDigest: 'A'.repeat(43)
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
    expect(review.sql).not.toContain('service_role')

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

  test('blocks generated defaults whose function or sequence authority is not inspected', async () => {
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const application = ownerApplication()
    application.dataModel.entities[0].fields[0].default = {
      kind: 'generated',
      generator: 'uuid'
    }
    const uuidReview = await createSupabaseInspectedMigrationReview({ application, snapshot })
    expect(uuidReview.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-migration-uuid-generator-inspection-required'
    )
    expect(uuidReview.sql).not.toContain('gen_random_uuid')
    expect(uuidReview.sql).not.toContain('BEGIN;')

    application.dataModel.entities[0].fields[0] = {
      id: 'id',
      name: 'id',
      type: 'integer',
      nullable: false,
      default: { kind: 'generated', generator: 'identity' }
    }
    const identityReview = await createSupabaseInspectedMigrationReview({
      application,
      snapshot
    })
    expect(identityReview.manifest.blockers.map((entry) => entry.code)).toContain(
      'supabase-migration-identity-sequence-review-required'
    )
    expect(identityReview.sql).not.toContain('GENERATED BY DEFAULT AS IDENTITY')
  })
})
