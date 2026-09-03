import { describe, expect, test } from 'bun:test'

import {
  createSupabaseInspectedMigrationSnapshot,
  type CreateSupabaseInspectedMigrationSnapshotInputV1,
  type SupabaseInspectionStorageBucketV1,
  type SupabaseInspectionStoragePolicyV1
} from '#compiler/backend/supabase/inspection'

import {
  SUPABASE_ARTIFACT_PATHS,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  evaluateSupabaseStorageAccess,
  renderSupabaseInspectedStorageMigrationSQL,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'
import type { BackendApplicationSpecV1, DataModelIR } from '@open-pencil/lowcode/backend'

const selection: BackendProviderSelection = {
  descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  packageDigest: `app-bundle-sha256:${'A'.repeat(43)}`,
  enabled: true
}

const EMPTY_MODEL: DataModelIR = { version: 1, entities: [], enums: [], relations: [] }
const STORAGE_COVERAGE = {
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

async function storageSnapshot(input: {
  buckets?: readonly SupabaseInspectionStorageBucketV1[]
  policies?: readonly SupabaseInspectionStoragePolicyV1[]
}) {
  return createSupabaseInspectedMigrationSnapshot({
    provenance: {
      projectRef: 'abcdefghijklmnopqrst',
      accountId: 'storage-account',
      querySchemaVersion: 'storage-test-v1',
      databaseRole: 'postgres',
      observedAt: '2026-09-04T00:00:00.000Z',
      completeness: 'complete',
      truncated: false
    },
    currentModel: EMPTY_MODEL,
    coverage: STORAGE_COVERAGE,
    objects: [],
    columns: [],
    constraints: [],
    indexes: [],
    roles: [
      { roleName: 'postgres', superuser: true, bypassRls: true, inherit: true },
      { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true }
    ],
    roleMemberships: [],
    policies: [],
    storageBuckets: input.buckets ?? [],
    storagePolicies: input.policies ?? [],
    privileges: [],
    defaultPrivileges: []
  } satisfies CreateSupabaseInspectedMigrationSnapshotInputV1)
}

function inspectedPoliciesFromSQL(sql: string): SupabaseInspectionStoragePolicyV1[] {
  return [
    ...sql.matchAll(
      /CREATE POLICY "([^"]+)" ON storage\.objects FOR (SELECT|INSERT|UPDATE|DELETE)/gu
    )
  ].map((match, index) => {
    const command = match[2].toLowerCase() as SupabaseInspectionStoragePolicyV1['command']
    return {
      address: { classOid: '3256', objectOid: String(80_000 + index), subId: 0 },
      name: match[1],
      command,
      mode: 'permissive',
      roles: ['authenticated'],
      source: 'openpencil',
      usingExpressionDigest: command === 'insert' ? null : 'U'.repeat(43),
      withCheckExpressionDigest:
        command === 'insert' || command === 'update' ? 'W'.repeat(43) : null
    }
  })
}

function storageApplication(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'storage-app',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
          primaryKey: { fields: ['id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    storage: {
      version: 1,
      buckets: [
        {
          id: 'user-assets',
          name: 'user-assets',
          access: 'private',
          maxObjectBytes: 5_000_000,
          allowedMimeTypes: ['image/jpeg', 'image/png'],
          pathRules: [
            {
              id: 'owner-files',
              prefix: ['users'],
              principal: { kind: 'owner' },
              operations: ['read', 'create', 'update', 'delete', 'upsert']
            }
          ]
        }
      ]
    },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true },
      { capability: 'storage.objects', required: true }
    ],
    secrets: []
  }
}

function requiredStorageBucket(application: BackendApplicationSpecV1) {
  const bucket = application.storage?.buckets[0]
  if (!bucket) throw new Error('expected a Storage bucket fixture')
  return bucket
}

function requiredStorageRule(application: BackendApplicationSpecV1) {
  const rule = requiredStorageBucket(application).pathRules[0]
  return rule
}

function tenantStorageApplication(): BackendApplicationSpecV1 {
  const application = storageApplication()
  application.dataModel.entities[0].fields.push({
    id: 'tenant_id',
    name: 'tenant_id',
    type: 'uuid',
    nullable: false
  })
  application.dataModel.entities.push({
    id: 'memberships',
    name: 'memberships',
    management: 'managed',
    fields: [
      { id: 'user_id', name: 'user_id', type: 'uuid', nullable: false },
      { id: 'tenant_id', name: 'tenant_id', type: 'uuid', nullable: false }
    ],
    primaryKey: { fields: ['user_id', 'tenant_id'] },
    indexes: [{ id: 'memberships_tenant_idx', fields: ['tenant_id'] }]
  })
  application.auth.ownership = [
    { id: 'membership-owner', entityId: 'memberships', identityFieldId: 'user_id' }
  ]
  application.auth.tenants = [
    {
      id: 'note-tenant',
      entityId: 'notes',
      tenantFieldId: 'tenant_id',
      membershipEntityId: 'memberships',
      membershipIdentityFieldId: 'user_id',
      membershipTenantFieldId: 'tenant_id'
    }
  ]
  application.auth.rowAccess = [
    {
      id: 'membership-owner-read',
      entityId: 'memberships',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: 'membership-owner' }
    }
  ]
  requiredStorageRule(application).principal = {
    kind: 'tenant-member',
    tenantId: 'note-tenant'
  }
  return application
}

function emitStorage(application = storageApplication()) {
  const registry = createBuiltinBackendProviderRegistry()
  const planned = createBackendProviderPlan(registry, {
    selection,
    application,
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(planned.diagnostics.map((entry) => entry.code).join(', '))
  const emitted = emitBackendProviderPlan(registry, { plan: planned.plan, selection })
  if (!emitted.ok) throw new Error(emitted.diagnostics.map((entry) => entry.code).join(', '))
  return emitted.emission
}

function text(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Expected text artifact ${path}`)
  return value
}

describe('Supabase first-class Storage artifacts', () => {
  test('renders an inspected, incremental, safely repeatable Storage policy delta', async () => {
    const application = storageApplication()
    const empty = await storageSnapshot({})
    const first = renderSupabaseInspectedStorageMigrationSQL(application, empty)
    if (!first) throw new Error('expected an inspected Storage migration')
    expect(first).toContain('ON CONFLICT (id) DO NOTHING;')
    expect(first).toContain(
      'A second execution is accepted only from the complete target inventory'
    )

    const policies = inspectedPoliciesFromSQL(first)
    expect(policies).toHaveLength(4)
    const live = await storageSnapshot({
      buckets: [
        {
          id: 'user-assets',
          name: 'user-assets',
          public: false,
          fileSizeLimit: 5_000_000,
          allowedMimeTypes: ['image/jpeg', 'image/png']
        }
      ],
      policies
    })
    const repeated = renderSupabaseInspectedStorageMigrationSQL(application, live)
    if (!repeated) throw new Error('expected repeat-safe policy reconciliation')
    expect(repeated).not.toContain('INSERT INTO storage.buckets')
    for (const policy of policies) {
      expect(repeated).toContain(`DROP POLICY IF EXISTS "${policy.name}" ON storage.objects;`)
      expect(repeated.match(new RegExp(`CREATE POLICY "${policy.name}"`, 'gu'))).toHaveLength(1)
    }

    const narrowed = structuredClone(application)
    requiredStorageRule(narrowed).operations = ['read']
    const narrowedSQL = renderSupabaseInspectedStorageMigrationSQL(narrowed, live)
    if (!narrowedSQL) throw new Error('expected narrowed Storage migration')
    expect(narrowedSQL.match(/DROP POLICY IF EXISTS/gu)).toHaveLength(4)
    expect(narrowedSQL.match(/CREATE POLICY/gu)).toHaveLength(1)

    const removed: BackendApplicationSpecV1 = {
      ...application,
      storage: { version: 1, buckets: [] }
    }
    const removedSQL = renderSupabaseInspectedStorageMigrationSQL(removed, live)
    if (!removedSQL) throw new Error('expected removed Storage policy migration')
    expect(removedSQL.match(/DROP POLICY IF EXISTS/gu)).toHaveLength(4)
    expect(removedSQL).not.toContain('CREATE POLICY')
  })

  test('fails closed on unmanaged policies or mismatched existing bucket configuration', async () => {
    const application = storageApplication()
    const empty = await storageSnapshot({})
    const proposed = renderSupabaseInspectedStorageMigrationSQL(application, empty)
    if (!proposed) throw new Error('expected a proposed Storage migration')
    const [policy] = inspectedPoliciesFromSQL(proposed)
    if (!policy) throw new Error('expected a proposed Storage policy')
    const unmanaged = await storageSnapshot({
      policies: [{ ...policy, source: 'third-party' }]
    })
    expect(() => renderSupabaseInspectedStorageMigrationSQL(application, unmanaged)).toThrow(
      'refused non-OpenPencil policy'
    )

    const mismatched = await storageSnapshot({
      buckets: [
        {
          id: 'user-assets',
          name: 'user-assets',
          public: true,
          fileSizeLimit: 5_000_000,
          allowedMimeTypes: ['image/jpeg', 'image/png']
        }
      ]
    })
    expect(() => renderSupabaseInspectedStorageMigrationSQL(application, mismatched)).toThrow(
      'refused to adopt or alter bucket'
    )
  })

  test('emits bounded bucket configuration and owner-path CRUD/upsert RLS', () => {
    const emission = emitStorage()
    const sql = text(emission.files, SUPABASE_ARTIFACT_PATHS.storagePolicy)
    expect(sql).toContain('INSERT INTO storage.buckets')
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING')
    expect(sql).not.toContain('DO UPDATE SET')
    expect(sql).toContain('OpenPencil refused to adopt or alter Storage bucket user-assets')
    expect(sql).toContain('BEGIN;')
    expect(sql).toContain('COMMIT;')
    expect(sql).toContain("E'user-assets'")
    expect(sql).toContain('5000000')
    expect(sql).toContain("ARRAY[E'image/jpeg', E'image/png']::text[]")
    expect(sql).toContain("(storage.foldername(name))[1] = E'users'")
    expect(sql).toContain('(storage.foldername(name))[2] = (select auth.uid())::text')
    expect(sql).toContain('FOR SELECT TO authenticated USING')
    expect(sql).toContain('FOR INSERT TO authenticated WITH CHECK')
    expect(sql).toContain('FOR UPDATE TO authenticated USING')
    expect(sql).toContain('FOR DELETE TO authenticated USING')
    expect(sql).not.toContain('service_role')
    expect(sql).not.toContain('USING (true)')

    const manifest = JSON.parse(text(emission.files, SUPABASE_ARTIFACT_PATHS.storagePolicyManifest))
    expect(manifest.defaultAccess).toBe('deny')
    expect(manifest.operationExpansions).toEqual({
      delete: ['select', 'delete'],
      update: ['select', 'update'],
      upsert: ['select', 'insert', 'update']
    })
    expect(manifest.upsertExpandsTo).toEqual(['select', 'insert', 'update'])
    expect(manifest.blockers).toEqual([])
    expect(manifest.requiredLiveChecks).toContain('second-user-read-update-delete-denied')
    expect(manifest.requiredLiveChecks).toContain(
      'existing-bucket-config-exact-or-explicit-adoption'
    )
  })

  test('proves owner and second-user/path/MIME/size isolation in the pure policy mirror', () => {
    const application = storageApplication()
    const base = {
      bucketId: 'user-assets',
      objectPath: 'users/user-a/avatar.png',
      mimeType: 'image/png',
      objectBytes: 1024
    } as const
    expect(
      evaluateSupabaseStorageAccess(application, {
        ...base,
        operation: 'upsert',
        actor: { authenticated: true, userId: 'user-a' }
      })
    ).toBe(true)
    for (const operation of ['read', 'update', 'delete'] as const) {
      expect(
        evaluateSupabaseStorageAccess(application, {
          ...base,
          operation,
          actor: { authenticated: true, userId: 'user-b' }
        })
      ).toBe(false)
    }
    expect(
      evaluateSupabaseStorageAccess(application, {
        ...base,
        operation: 'read',
        objectPath: '../user-a/avatar.png',
        actor: { authenticated: true, userId: 'user-a' }
      })
    ).toBe(false)
    expect(
      evaluateSupabaseStorageAccess(application, {
        ...base,
        operation: 'create',
        mimeType: 'text/html',
        actor: { authenticated: true, userId: 'user-a' }
      })
    ).toBe(false)
    expect(
      evaluateSupabaseStorageAccess(application, {
        ...base,
        operation: 'create',
        objectBytes: 5_000_001,
        actor: { authenticated: true, userId: 'user-a' }
      })
    ).toBe(false)
  })

  test('blocks public-read storage during production planning', () => {
    const application = storageApplication()
    requiredStorageBucket(application).access = 'public-read'
    const result = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection,
      application,
      target: 'react',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'supabase-public-storage-production-review-required',
          severity: 'error'
        })
      )
    }
  })

  test('requires and emits RLS-readable membership authority for tenant paths', () => {
    const application = tenantStorageApplication()
    const sql = text(emitStorage(application).files, SUPABASE_ARTIFACT_PATHS.storagePolicy)
    expect(sql).toContain(
      'from "public"."memberships" as "membership" where "membership"."user_id" = (select auth.uid())'
    )

    application.auth.rowAccess = []
    const result = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection,
      application,
      target: 'react',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'supabase-tenant-membership-select-policy-required',
          severity: 'error'
        })
      )
    }
  })

  test('requires explicit read/create/update intent for Storage mutation dependencies', () => {
    for (const operations of [['update'], ['delete'], ['upsert']] as const) {
      const application = storageApplication()
      requiredStorageRule(application).operations = [...operations]
      const result = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
        selection,
        application,
        target: 'react',
        mode: 'production'
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'supabase-storage-operation-dependency-required',
            severity: 'error'
          })
        )
      }
    }
  })

  test('hashes Storage policy identifiers below the PostgreSQL identifier limit', () => {
    const application = storageApplication()
    requiredStorageBucket(application).id = 'b'.repeat(60)
    requiredStorageRule(application).id = 'r'.repeat(60)
    requiredStorageRule(application).operations = ['read', 'create']
    const sql = text(emitStorage(application).files, SUPABASE_ARTIFACT_PATHS.storagePolicy)
    const names = [...sql.matchAll(/CREATE POLICY "([^"]+)"/gu)].map((match) => match[1])

    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    expect(names.every((name) => new TextEncoder().encode(name).byteLength <= 63)).toBe(true)
  })
})
