// Supabase deployment-domain acceptance tests.
import { describe, expect, test } from 'bun:test'

import {
  createSupabaseInspectedMigrationSnapshot,
  type CreateSupabaseInspectedMigrationSnapshotInputV1
} from '@open-pencil/compiler/backend'
import type {
  BackendApplicationSpecV1,
  BackendCredentialRef,
  BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppBundlePluginCatalogEntry
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderBuild,
  resolveAppBackendProviderReleaseAuthority
} from '@/app/plugins/host/backend-provider'
import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  createSupabaseBackendRelease,
  type SupabaseBackendReleaseReviewArtifactV1,
  type SupabaseBackendReleaseSnapshotRequest
} from '@/app/plugins/host/deployment/supabase/backend-release'

const NOW = '2026-08-30T09:00:00.000Z'
const CREDENTIAL_REF = 'credential.123e4567-e89b-42d3-a456-426614174000' as BackendCredentialRef

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

function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') throw new Error('Missing bundled Supabase provider')
  return entry
}

function ownerApplication(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'supabase-release-review',
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
    workflows: { version: 1, workflows: [] },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: [
      {
        kind: 'environment',
        name: 'SUPABASE_URL',
        exposure: 'client-public',
        required: true
      },
      {
        kind: 'credential',
        credentialRef: CREDENTIAL_REF,
        name: 'SUPABASE_DEPLOY_AUTHORITY',
        exposure: 'host',
        required: true
      }
    ]
  }
}

function emptyInspection(
  projectRef = 'project-ref-1'
): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  return {
    provenance: {
      projectRef,
      accountId: 'account-1',
      querySchemaVersion: 'catalog-v1',
      databaseRole: 'postgres',
      observedAt: NOW,
      completeness: 'complete',
      truncated: false
    },
    currentModel: { version: 1, entities: [], enums: [], relations: [] },
    coverage: COMPLETE_COVERAGE,
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
    privileges: [],
    defaultPrivileges: []
  }
}

async function prepared(application: BackendApplicationSpecV1) {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  const snapshot = await store.load()
  if (snapshot.error) throw snapshot.error
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active Supabase provider')
  const build = prepareAppBackendProviderBuild(
    store,
    {
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application
    },
    { target: 'react', mode: 'production' }
  )
  const backendProvider = resolveAppBackendProviderReleaseAuthority(store, descriptor)
  if (!backendProvider) throw new Error('Missing exact Supabase release authority')
  return { build, backendProvider }
}

async function documentDigest(): Promise<string> {
  return digestCanonicalManifest({ document: 'supabase-host-review' })
}

function baseOptions(
  build: Awaited<ReturnType<typeof prepared>>['build'],
  backendProvider: BackendReleaseProviderAuthorityV1,
  snapshot: Awaited<ReturnType<typeof createSupabaseInspectedMigrationSnapshot>>
) {
  return {
    build,
    backendProvider,
    compilerVersion: '0.15.0',
    environment: 'staging' as const,
    projectRef: 'project-ref-1',
    accountId: 'account-1',
    grantGeneration: 'grant-1',
    dispatchJournal: createMemoryBackendHostReleaseDispatchJournal(),
    revalidateLocalAuthority: async () => undefined,
    snapshotProvider: async (_input: SupabaseBackendReleaseSnapshotRequest) => ({
      snapshot,
      expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest
    }),
    now: () => NOW
  }
}

describe('Supabase Backend Host Release review bridge', () => {
  test('exposes an independent review artifact then fails closed before dispatch', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const calls: string[] = []
    const transitions: string[] = []
    let visibleArtifact!: SupabaseBackendReleaseReviewArtifactV1
    let snapshotRequest!: SupabaseBackendReleaseSnapshotRequest
    const options = baseOptions(build, backendProvider, snapshot)
    const bridge = createSupabaseBackendRelease({
      ...options,
      documentDigest: await documentDigest(),
      async revalidateLocalAuthority({ stage }) {
        calls.push(`local-authority:${stage}`)
      },
      async snapshotProvider(input) {
        calls.push('snapshot')
        snapshotRequest = input
        return options.snapshotProvider(input)
      },
      reviewBackendRelease({ artifact }) {
        calls.push('backend-review')
        visibleArtifact = artifact
        return true
      },
      confirmBackendRelease({ artifact }) {
        calls.push('backend-confirm')
        expect(artifact).toBe(visibleArtifact)
        return []
      }
    })

    const state = await bridge.run({
      releaseId: 'supabase-release-1',
      planId: 'supabase-plan-1',
      receiptId: 'supabase-receipt-1',
      onTransition: (transition) => transitions.push(transition.phase)
    })

    expect(calls).toEqual([
      'local-authority:initial',
      'snapshot',
      'backend-review',
      'backend-confirm'
    ])
    expect(snapshotRequest?.requiredCredentialRefs).toEqual([CREDENTIAL_REF])
    expect(visibleArtifact?.inspectedReview.manifest.reviewReady).toBe(true)
    expect(visibleArtifact?.inspectedReview.sql).toContain('CREATE TABLE "public"."notes"')
    expect(visibleArtifact?.manifest).toMatchObject({
      compiler: {
        planDigest: build.plan.planDigest,
        emissionManifestDigest: build.emission.manifestDigest
      },
      backendProvider,
      remoteAuthority: {
        projectRef: 'project-ref-1',
        accountId: 'account-1',
        grantGeneration: 'grant-1',
        inspectedSchemaDigest: snapshot.inspectedSchemaDigest
      },
      inspectedReview: { manifestDigest: visibleArtifact?.inspectedReview.manifestDigest }
    })
    expect(state.artifacts?.schemaArtifactDigest).toBe(visibleArtifact?.manifestDigest)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'failed',
      dispatch: 'not-dispatched',
      automaticRetryAllowed: false,
      releaseReady: false
    })
    expect(state.receipt).toMatchObject({
      receiptId: 'supabase-receipt-1',
      outcome: 'failed',
      requiredEnvironmentNames: ['SUPABASE_URL'],
      requiredCredentialRefs: [CREDENTIAL_REF],
      remoteOperationIds: [],
      failure: { code: 'supabase-live-apply-unavailable', outcomeUnknown: false }
    })
    expect(transitions).not.toContain('verify')
    expect(JSON.stringify({ artifact: visibleArtifact, receipt: state.receipt })).not.toContain(
      'supabase-service-role-secret'
    )
  })

  test('automatically cancels a blocked inspected review even when the callback approves', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot({
      ...emptyInspection(),
      defaultPrivileges: [
        {
          schema: 'public',
          objectKind: 'table',
          grantor: 'postgres',
          grantee: 'authenticated',
          privilege: 'SELECT',
          isGrantable: false,
          source: 'openpencil'
        }
      ]
    })
    let reviewCalls = 0
    let confirmCalls = 0
    const bridge = createSupabaseBackendRelease({
      ...baseOptions(build, backendProvider, snapshot),
      documentDigest: await documentDigest(),
      reviewBackendRelease({ artifact }) {
        reviewCalls += 1
        expect(artifact.inspectedReview.manifest.reviewReady).toBe(false)
        return true
      },
      confirmBackendRelease() {
        confirmCalls += 1
        return []
      }
    })

    const state = await bridge.run({
      releaseId: 'supabase-release-blocked',
      planId: 'supabase-plan-blocked',
      receiptId: 'supabase-receipt-blocked'
    })

    expect(reviewCalls).toBe(1)
    expect(confirmCalls).toBe(0)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'cancelled',
      dispatch: 'not-dispatched',
      failureCode: 'review-denied'
    })
    expect(state.receipt).toMatchObject({
      outcome: 'cancelled',
      failure: { code: 'review-denied', outcomeUnknown: false }
    })
  })

  test('revalidates live local authority before inspection and fails before remote snapshot use', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    let snapshotCalls = 0
    let reviewCalls = 0
    const options = baseOptions(build, backendProvider, snapshot)
    const bridge = createSupabaseBackendRelease({
      ...options,
      documentDigest: await documentDigest(),
      revalidateLocalAuthority({ stage }) {
        expect(stage).toBe('initial')
        throw new Error('live-local-authority-stale')
      },
      async snapshotProvider(input) {
        snapshotCalls += 1
        return options.snapshotProvider(input)
      },
      reviewBackendRelease() {
        reviewCalls += 1
        return true
      },
      confirmBackendRelease() {
        return []
      }
    })

    await expect(
      bridge.run({
        releaseId: 'supabase-release-local-stale',
        planId: 'supabase-plan-local-stale',
        receiptId: 'supabase-receipt-local-stale'
      })
    ).rejects.toThrow('live-local-authority-stale')
    expect(snapshotCalls).toBe(0)
    expect(reviewCalls).toBe(0)
  })

  test('rejects a snapshot from a different Supabase project before review', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot(
      emptyInspection('different-project')
    )
    let reviewCalls = 0
    const bridge = createSupabaseBackendRelease({
      ...baseOptions(build, backendProvider, snapshot),
      documentDigest: await documentDigest(),
      reviewBackendRelease() {
        reviewCalls += 1
        return true
      },
      confirmBackendRelease() {
        return []
      }
    })

    await expect(
      bridge.run({
        releaseId: 'supabase-release-mismatch',
        planId: 'supabase-plan-mismatch',
        receiptId: 'supabase-receipt-mismatch'
      })
    ).rejects.toThrow('different project authority')
    expect(reviewCalls).toBe(0)
  })

  test('rejects forged Host publisher and permission authority without echoing input', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const publisherCanary = 'forged-publisher-secret-canary'
    const permissionCanary = 'supabase-service-role-secret'
    const forgedPublisher = structuredClone(backendProvider)
    Reflect.set(forgedPublisher, 'publisherId', publisherCanary)
    const forgedSelection = structuredClone(build.request.selection)
    Reflect.set(forgedSelection, 'permissions', [permissionCanary])
    const forgedPermissionBuild = {
      ...build,
      request: { ...build.request, selection: forgedSelection }
    }
    const common = {
      ...baseOptions(build, backendProvider, snapshot),
      documentDigest: await documentDigest(),
      reviewBackendRelease: () => true,
      confirmBackendRelease: () => []
    }

    const constructionErrors: Error[] = []
    for (const candidate of [
      { ...common, backendProvider: forgedPublisher },
      { ...common, build: forgedPermissionBuild }
    ]) {
      try {
        createSupabaseBackendRelease(candidate)
      } catch (cause) {
        if (cause instanceof Error) constructionErrors.push(cause)
      }
    }

    expect(constructionErrors).toHaveLength(2)
    expect(constructionErrors.every((error) => error instanceof TypeError)).toBe(true)
    expect(constructionErrors[0]?.message).toContain('Host selection')
    expect(constructionErrors[1]?.message).toContain('Host selection')
    expect(JSON.stringify(constructionErrors.map((error) => error.message))).not.toContain(
      publisherCanary
    )
    expect(JSON.stringify(constructionErrors.map((error) => error.message))).not.toContain(
      permissionCanary
    )
  })

  test('snapshots mutable options and callbacks before any asynchronous release work', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const originalDocumentDigest = await documentDigest()
    const originalCalls: string[] = []
    const replacementCalls: string[] = []
    let snapshotRequest!: SupabaseBackendReleaseSnapshotRequest
    let visibleArtifact!: SupabaseBackendReleaseReviewArtifactV1
    const mutableOptions = {
      ...baseOptions(build, backendProvider, snapshot),
      documentDigest: originalDocumentDigest,
      snapshotProvider(input: SupabaseBackendReleaseSnapshotRequest) {
        originalCalls.push('snapshot')
        snapshotRequest = input
        return {
          snapshot,
          expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest
        }
      },
      reviewBackendRelease({ artifact }: { artifact: SupabaseBackendReleaseReviewArtifactV1 }) {
        originalCalls.push('review')
        visibleArtifact = artifact
        return true
      },
      confirmBackendRelease() {
        originalCalls.push('confirm')
        return []
      }
    }
    const bridge = createSupabaseBackendRelease(mutableOptions)

    Reflect.set(mutableOptions, 'build', null)
    Reflect.set(mutableOptions, 'documentDigest', await digestCanonicalManifest({ mutated: true }))
    Reflect.set(mutableOptions, 'compilerVersion', 'mutated-compiler')
    Reflect.set(mutableOptions, 'environment', 'production')
    Reflect.set(mutableOptions, 'projectRef', 'mutated-project')
    Reflect.set(mutableOptions, 'accountId', 'mutated-account')
    Reflect.set(mutableOptions, 'grantGeneration', 'mutated-grant')
    Reflect.set(mutableOptions, 'snapshotProvider', () => {
      replacementCalls.push('snapshot')
      throw new Error('replacement snapshot callback must remain unreachable')
    })
    Reflect.set(mutableOptions, 'reviewBackendRelease', () => {
      replacementCalls.push('review')
      return false
    })
    Reflect.set(mutableOptions, 'confirmBackendRelease', () => {
      replacementCalls.push('confirm')
      return null
    })
    Reflect.set(mutableOptions, 'now', () => '2099-01-01T00:00:00.000Z')

    const state = await bridge.run({
      releaseId: 'supabase-release-option-snapshot',
      planId: 'supabase-plan-option-snapshot',
      receiptId: 'supabase-receipt-option-snapshot'
    })

    expect(originalCalls).toEqual(['snapshot', 'review', 'confirm'])
    expect(replacementCalls).toEqual([])
    expect(snapshotRequest).toMatchObject({
      projectRef: 'project-ref-1',
      accountId: 'account-1'
    })
    expect(visibleArtifact?.manifest).toMatchObject({
      documentDigest: originalDocumentDigest,
      compilerVersion: '0.15.0',
      environment: 'staging',
      compiler: {
        planDigest: build.plan.planDigest,
        emissionManifestDigest: build.emission.manifestDigest
      },
      remoteAuthority: {
        projectRef: 'project-ref-1',
        accountId: 'account-1',
        grantGeneration: 'grant-1'
      }
    })
    expect(state.plan?.authority).toMatchObject({
      documentDigest: originalDocumentDigest,
      compilerVersion: '0.15.0',
      environment: 'staging',
      projectId: 'project-ref-1',
      accountId: 'account-1',
      grantGeneration: 'grant-1'
    })
    expect(state.review?.reviewedAt).toBe(NOW)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'failed',
      dispatch: 'not-dispatched'
    })
  })

  test('accepts only a literal true review decision', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    let confirmCalls = 0
    const truthyOptions = {
      ...baseOptions(build, backendProvider, snapshot),
      documentDigest: await documentDigest(),
      reviewBackendRelease: () => true,
      confirmBackendRelease() {
        confirmCalls += 1
        return []
      }
    }
    Reflect.set(truthyOptions, 'reviewBackendRelease', () => 1)
    const bridge = createSupabaseBackendRelease(truthyOptions)

    const state = await bridge.run({
      releaseId: 'supabase-release-truthy-review',
      planId: 'supabase-plan-truthy-review',
      receiptId: 'supabase-receipt-truthy-review'
    })

    expect(confirmCalls).toBe(0)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'cancelled',
      dispatch: 'not-dispatched',
      failureCode: 'review-denied'
    })
  })

  test('rejects concurrent runs and releases the active lifecycle in finally', async () => {
    const { build, backendProvider } = await prepared(ownerApplication())
    const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
    const options = baseOptions(build, backendProvider, snapshot)
    let releaseSnapshot: (() => void) | undefined
    const snapshotBarrier = new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    let markSnapshotStarted: (() => void) | undefined
    const snapshotStarted = new Promise<void>((resolve) => {
      markSnapshotStarted = resolve
    })
    let snapshotCalls = 0
    const bridge = createSupabaseBackendRelease({
      ...options,
      documentDigest: await documentDigest(),
      async snapshotProvider(input) {
        snapshotCalls += 1
        if (snapshotCalls === 1) {
          markSnapshotStarted?.()
          await snapshotBarrier
        }
        return options.snapshotProvider(input)
      },
      reviewBackendRelease: () => true,
      confirmBackendRelease: () => []
    })
    const first = bridge.run({
      releaseId: 'supabase-release-active-1',
      planId: 'supabase-plan-active-1',
      receiptId: 'supabase-receipt-active-1'
    })
    await snapshotStarted

    await expect(
      bridge.run({
        releaseId: 'supabase-release-active-2',
        planId: 'supabase-plan-active-2',
        receiptId: 'supabase-receipt-active-2'
      })
    ).rejects.toThrow('already active')
    releaseSnapshot?.()
    await first

    const afterCleanup = await bridge.run({
      releaseId: 'supabase-release-active-3',
      planId: 'supabase-plan-active-3',
      receiptId: 'supabase-receipt-active-3'
    })
    expect(afterCleanup.failureCode).toBe('supabase-live-apply-unavailable')
    expect(snapshotCalls).toBe(2)
  })
})
