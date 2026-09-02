import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_ARTIFACT_PATHS,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  evaluateSupabaseRowAccess,
  requiredSupabasePolicyOperations,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

const PACKAGE_DIGEST = `app-bundle-sha256:${'A'.repeat(43)}`

function selection(enabled = true): BackendProviderSelection {
  return {
    descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: PACKAGE_DIGEST,
    enabled
  }
}

function supabaseApplication(): BackendApplicationSpecV1 {
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
          operations: ['select', 'insert', 'update', 'delete'],
          principal: { kind: 'owner', ownershipId: 'note-owner' }
        }
      ]
    },
    workflows: {
      version: 1,
      workflows: [
        {
          id: 'mutate-notes',
          name: 'Mutate notes',
          trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
          parameters: ['id', 'title'],
          steps: [
            { id: 'read', kind: 'data.read', entityId: 'notes', resultName: 'rows' },
            {
              id: 'insert',
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
            {
              id: 'update',
              kind: 'data.mutate',
              entityId: 'notes',
              operation: 'update',
              values: [{ field: 'title', value: { kind: 'expression', expression: 'title' } }],
              filters: [
                {
                  field: 'id',
                  operator: 'eq',
                  value: { kind: 'expression', expression: 'id' }
                }
              ]
            },
            {
              id: 'delete',
              kind: 'data.mutate',
              entityId: 'notes',
              operation: 'delete',
              filters: [
                {
                  field: 'id',
                  operator: 'eq',
                  value: { kind: 'expression', expression: 'id' }
                }
              ]
            },
            {
              id: 'upsert',
              kind: 'data.mutate',
              entityId: 'notes',
              operation: 'upsert',
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
      { capability: 'policy.row-level', required: true },
      { capability: 'server.functions', required: true },
      { capability: 'server.http', required: true },
      { capability: 'storage.objects', required: true }
    ],
    secrets: [
      {
        kind: 'environment',
        name: 'BACKEND_PUBLIC_URL',
        exposure: 'client-public',
        required: true
      },
      {
        kind: 'environment',
        name: 'BACKEND_PUBLIC_KEY',
        exposure: 'client-public',
        required: true
      }
    ]
  }
}

function emitApplication(application = supabaseApplication()) {
  const registry = createBuiltinBackendProviderRegistry()
  const plan = createBackendProviderPlan(registry, {
    selection: selection(),
    application,
    target: 'react',
    mode: 'production'
  })
  if (!plan.ok) throw new Error(plan.diagnostics.map((entry) => entry.code).join(', '))
  const emitted = emitBackendProviderPlan(registry, {
    plan: plan.plan,
    selection: selection()
  })
  if (!emitted.ok) throw new Error(emitted.diagnostics.map((entry) => entry.code).join(', '))
  return { plan, emission: emitted.emission }
}

function fileText(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Expected text artifact ${path}`)
  return value
}

describe('built-in Supabase Backend Provider', () => {
  test('publishes the exact Host-bound descriptor and deterministic review-only artifacts', () => {
    expect(SUPABASE_BACKEND_PROVIDER_DESCRIPTOR).toEqual({
      pluginId: 'open-pencil.supabase-backend',
      contributionId: 'supabase.backend',
      providerId: 'supabase',
      adapterId: 'open-pencil.backend.supabase',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: [
        'auth.identity',
        'auth.roles',
        'data.read',
        'data.write',
        'migrations.schema',
        'policy.row-level',
        'server.functions',
        'server.http',
        'storage.objects'
      ],
      outputs: [
        'client-config',
        'database-schema',
        'deployment-manifest',
        'migration-plan',
        'security-policy',
        'server-runtime'
      ]
    })

    const first = emitApplication()
    const second = emitApplication()
    expect(first.plan.plan.planDigest).toBe(second.plan.plan.planDigest)
    expect([...first.emission.files]).toEqual([...second.emission.files])
    expect(first.emission.manifestDigest).toBe(second.emission.manifestDigest)
    expect([...first.emission.files.keys()]).toEqual([
      'backend/supabase/client-config.json',
      'backend/supabase/database-schema.json',
      'backend/supabase/database.types.ts',
      'backend/supabase/deployment-manifest.json',
      'backend/supabase/functions/openpencil-runtime/workflows.json',
      'backend/supabase/migration-plan.json',
      'backend/supabase/rls-policy.json',
      'backend/supabase/rls-policy.sql',
      'openpencil-backend.manifest.json'
    ])
    expect(first.emission.manifest.authority).toMatchObject({
      packageDigest: PACKAGE_DIGEST,
      adapterId: 'open-pencil.backend.supabase'
    })
    expect(() =>
      new Bun.Transpiler({ loader: 'ts' }).transformSync(
        fileText(first.emission.files, SUPABASE_ARTIFACT_PATHS.clientTypes)
      )
    ).not.toThrow()
  })

  test('emits owner-scoped RLS with the complete mutation matrix and no broad policy', () => {
    const { emission } = emitApplication()
    const sql = fileText(emission.files, SUPABASE_ARTIFACT_PATHS.securityPolicy)
    expect(sql).toContain('ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;')
    expect(sql).toContain('ALTER TABLE "public"."notes" FORCE ROW LEVEL SECURITY;')
    expect(sql).toContain('FOR SELECT TO authenticated USING ((select auth.uid()) = "owner_id")')
    expect(sql).toContain(
      'FOR UPDATE TO authenticated USING ((select auth.uid()) = "owner_id") WITH CHECK ((select auth.uid()) = "owner_id")'
    )
    expect(sql).toContain(
      'FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = "owner_id")'
    )
    expect(sql).toContain('FOR DELETE TO authenticated USING ((select auth.uid()) = "owner_id")')
    expect(sql).not.toContain('(true)')
    expect(sql).not.toContain('user_metadata')
    expect(sql).not.toContain('storage.objects')

    const security = JSON.parse(
      fileText(emission.files, SUPABASE_ARTIFACT_PATHS.securityPolicyManifest)
    )
    expect(security.releaseReady).toBe(false)
    expect(security.applyAllowed).toBe(false)
    expect(security.roleClaimsSource).toBe('app_metadata-only')
    expect(security.blockers).toContain(
      'storage.objects:explicit-bucket-and-object-policy-required'
    )
    expect(security.storageUpsertPolicyOperations).toEqual(['select', 'insert', 'update'])
  })

  test('keeps migration, function, environment, and deployment authority review-only', () => {
    const { emission } = emitApplication()
    const migration = JSON.parse(fileText(emission.files, SUPABASE_ARTIFACT_PATHS.migrationPlan))
    expect(migration.currentModel).toBe('remote-inspection-required')
    expect(migration.operations).toEqual([])
    expect(migration.applyAllowed).toBe(false)
    expect(migration.targetModel.entities[0].name).toBe('notes')

    const runtime = fileText(emission.files, SUPABASE_ARTIFACT_PATHS.serverRuntime)
    expect(runtime).toContain('mutate-notes')
    expect(runtime).toContain('caller-user-rls')
    expect(runtime).not.toContain('service_role')
    expect(runtime).not.toContain('SUPABASE_SERVICE_ROLE_KEY')

    const deploymentText = fileText(emission.files, SUPABASE_ARTIFACT_PATHS.deploymentManifest)
    const deployment = JSON.parse(deploymentText)
    expect(deployment.releaseReady).toBe(false)
    expect(deployment.applyAuthority).toBe('host-release-controller-only')
    expect(deployment.commandAuthority).toBe('host-owned-no-command-embedded')
    expect(deployment.dataApiExposure).toBe('explicit-review-required')
    expect(deployment.storageUpsertPolicyOperations).toEqual(['select', 'insert', 'update'])
    expect(deploymentText).not.toContain('supabase functions deploy')
    expect(deploymentText).not.toContain('service_role')
  })

  test('keeps explicit external/legacy tables inspect-only and never synthesizes schema operations', () => {
    const application = supabaseApplication()
    const entity = application.dataModel.entities[0]
    entity.management = 'external'
    entity.fields = []
    delete entity.primaryKey
    delete entity.indexes
    application.auth.ownership = []
    application.auth.rowAccess = [
      {
        id: 'deny-external-authenticated',
        entityId: 'notes',
        effect: 'deny',
        operations: ['select', 'insert', 'update', 'delete'],
        principal: { kind: 'authenticated' }
      }
    ]
    application.workflows.workflows = []
    const { plan, emission } = emitApplication(application)
    expect(plan.diagnostics.map((entry) => entry.code)).toContain(
      'supabase-external-rls-live-review-required'
    )
    const migration = JSON.parse(fileText(emission.files, SUPABASE_ARTIFACT_PATHS.migrationPlan))
    expect(migration.operations).toEqual([])
    expect(migration.targetModel.entities[0].management).toBe('external')
    const sql = fileText(emission.files, SUPABASE_ARTIFACT_PATHS.securityPolicy)
    expect(sql).toContain('External table "public"."notes" is inspect-only')
    expect(sql).not.toContain('ALTER TABLE "public"."notes"')
  })

  test('proves anonymous, owner, second-user, and cross-tenant decisions without a remote database', () => {
    const application = supabaseApplication()
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
      ]
    })
    application.auth.tenants.push({
      id: 'note-tenant',
      entityId: 'notes',
      tenantFieldId: 'tenant_id',
      membershipEntityId: 'memberships',
      membershipIdentityFieldId: 'user_id',
      membershipTenantFieldId: 'tenant_id'
    })
    application.auth.rowAccess.push({
      id: 'tenant-read',
      entityId: 'notes',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'tenant-member', tenantId: 'note-tenant' }
    })
    const owner = { authenticated: true, userId: 'user-1' }
    const secondUser = { authenticated: true, userId: 'user-2' }
    const tenantMember = {
      authenticated: true,
      userId: 'user-2',
      tenantMemberships: { 'note-tenant': ['tenant-1'] }
    }
    const row = { owner_id: 'user-1', tenant_id: 'tenant-1' }
    const otherTenantRow = { owner_id: 'user-3', tenant_id: 'tenant-2' }

    for (const operation of ['select', 'insert', 'update', 'delete'] as const) {
      expect(
        evaluateSupabaseRowAccess(application, {
          entityId: 'notes',
          operation,
          actor: owner,
          row
        })
      ).toBe(true)
    }
    for (const operation of requiredSupabasePolicyOperations({
      id: 'upsert',
      kind: 'data.mutate',
      entityId: 'notes',
      operation: 'upsert'
    })) {
      expect(
        evaluateSupabaseRowAccess(application, {
          entityId: 'notes',
          operation,
          actor: owner,
          row
        })
      ).toBe(true)
    }
    expect(
      evaluateSupabaseRowAccess(application, {
        entityId: 'notes',
        operation: 'select',
        actor: { authenticated: false },
        row
      })
    ).toBe(false)
    for (const operation of ['select', 'insert', 'update', 'delete'] as const) {
      expect(
        evaluateSupabaseRowAccess(application, {
          entityId: 'notes',
          operation,
          actor: secondUser,
          row
        })
      ).toBe(false)
    }
    for (const operation of requiredSupabasePolicyOperations({
      id: 'upsert',
      kind: 'data.mutate',
      entityId: 'notes',
      operation: 'upsert'
    })) {
      expect(
        evaluateSupabaseRowAccess(application, {
          entityId: 'notes',
          operation,
          actor: secondUser,
          row
        })
      ).toBe(false)
    }
    expect(
      evaluateSupabaseRowAccess(application, {
        entityId: 'notes',
        operation: 'select',
        actor: tenantMember,
        row
      })
    ).toBe(true)
    expect(
      evaluateSupabaseRowAccess(application, {
        entityId: 'notes',
        operation: 'update',
        actor: tenantMember,
        row
      })
    ).toBe(false)
    expect(
      evaluateSupabaseRowAccess(application, {
        entityId: 'storage_objects',
        operation: 'insert',
        actor: owner,
        row: { owner_id: 'user-1' }
      })
    ).toBe(false)
    expect(
      evaluateSupabaseRowAccess(application, {
        entityId: 'notes',
        operation: 'select',
        actor: tenantMember,
        row: otherTenantRow
      })
    ).toBe(false)
  })

  test('fails closed for incomplete mutation policy, privileged keys, and unsupported targets', () => {
    const registry = createBuiltinBackendProviderRegistry()
    const incomplete = supabaseApplication()
    incomplete.auth.rowAccess[0].operations = ['update']
    const incompletePlan = createBackendProviderPlan(registry, {
      selection: selection(),
      application: incomplete,
      target: 'react',
      mode: 'production'
    })
    expect(incompletePlan.ok).toBe(false)
    if (!incompletePlan.ok) {
      expect(incompletePlan.diagnostics.map((entry) => entry.code)).toContain(
        'supabase-update-select-policy-required'
      )
      expect(incompletePlan.diagnostics.map((entry) => entry.code)).toContain(
        'supabase-workflow-policy-coverage-required'
      )
    }

    const privileged = supabaseApplication()
    privileged.secrets.push({
      kind: 'environment',
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      exposure: 'server',
      required: true
    })
    const privilegedPlan = createBackendProviderPlan(registry, {
      selection: selection(),
      application: privileged,
      target: 'react',
      mode: 'production'
    })
    expect(privilegedPlan.ok).toBe(false)
    if (!privilegedPlan.ok) {
      expect(privilegedPlan.diagnostics.map((entry) => entry.code)).toContain(
        'supabase-privileged-credential-forbidden'
      )
    }

    const smuggled = supabaseApplication()
    smuggled.workflows.workflows[0].steps.unshift({
      id: 'unsafe-http',
      kind: 'http.request',
      method: 'POST',
      url: { kind: 'environment', name: 'BACKEND_PUBLIC_URL' },
      headers: [
        {
          name: 'Authorization',
          value: { kind: 'expression', expression: 'authorizationValue' }
        }
      ]
    })
    const smuggledPlan = createBackendProviderPlan(registry, {
      selection: selection(),
      application: smuggled,
      target: 'react',
      mode: 'production'
    })
    expect(smuggledPlan.ok).toBe(false)
    if (!smuggledPlan.ok) {
      const codes = smuggledPlan.diagnostics.map((entry) => entry.code)
      expect(codes).toContain('supabase-workflow-sensitive-header-reference-required')
    }

    const unsupported = createBackendProviderPlan(registry, {
      selection: selection(),
      application: supabaseApplication(),
      target: 'mpx',
      mode: 'production'
    })
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) {
      expect(
        unsupported.diagnostics.some((entry) =>
          [
            'backend-target-capability-unsupported',
            'backend-capability-source-only-mode-required',
            'backend-capability-server-bridge-required'
          ].includes(entry.code)
        )
      ).toBe(true)
    }

    const prototype = createBackendProviderPlan(registry, {
      selection: selection(),
      application: supabaseApplication(),
      target: 'expo',
      mode: 'source-only-prototype'
    })
    expect(prototype.ok).toBe(true)
    if (prototype.ok) {
      expect(prototype.plan.capabilities.every((entry) => !entry.included)).toBe(true)
      expect(
        prototype.diagnostics.some((entry) =>
          [
            'backend-capability-source-only-omitted',
            'backend-capability-server-bridge-omitted'
          ].includes(entry.code)
        )
      ).toBe(true)
    }
  })

  test('blocks broad authenticated intent before production emission', () => {
    const application = supabaseApplication()
    application.auth.rowAccess.push({
      id: 'unsafe-authenticated-read',
      entityId: 'notes',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'authenticated' }
    })
    const plan = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection: selection(),
      application,
      target: 'react',
      mode: 'production'
    })
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'supabase-broad-row-policy-blocked', severity: 'error' })
      )
    }
  })

  test('does not count a blocked broad policy as executable workflow coverage', () => {
    const application = supabaseApplication()
    application.auth.rowAccess = [
      {
        id: 'broad-authenticated-read',
        entityId: 'notes',
        effect: 'allow',
        operations: ['select'],
        principal: { kind: 'authenticated' }
      }
    ]
    application.workflows.workflows[0].steps = [
      { id: 'read', kind: 'data.read', entityId: 'notes', resultName: 'rows' },
      { id: 'respond', kind: 'respond', status: 204 }
    ]
    const result = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection: selection(),
      application,
      target: 'react',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toEqual(
        expect.arrayContaining([
          'supabase-broad-row-policy-blocked',
          'supabase-workflow-policy-coverage-required'
        ])
      )
    }
  })

  test('uses app_metadata rather than mutable user_metadata for role authorization', () => {
    const application = supabaseApplication()
    application.capabilities.push({ capability: 'auth.roles', required: true })
    application.auth.roles.push({ id: 'role-editor', name: 'editor' })
    application.auth.rowAccess.push({
      id: 'editor-read',
      entityId: 'notes',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'role', roleId: 'role-editor' }
    })
    const { emission } = emitApplication(application)
    const sql = fileText(emission.files, SUPABASE_ARTIFACT_PATHS.securityPolicy)
    expect(sql).toContain("auth.jwt()) -> 'app_metadata' -> 'roles'")
    expect(sql).toContain("? 'editor'")
    expect(sql).not.toContain("? 'role-editor'")
    expect(sql).not.toContain('user_metadata')
    expect(
      [['editor'], ['role-editor']].map((roleNames) =>
        evaluateSupabaseRowAccess(application, {
          entityId: 'notes',
          operation: 'select',
          actor: { authenticated: true, roleNames },
          row: {}
        })
      )
    ).toEqual([true, false])
  })
})
