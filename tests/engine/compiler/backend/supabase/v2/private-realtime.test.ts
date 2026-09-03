/* oxlint-disable max-lines -- Generated-client lifecycle tests stay beside the exact Provider artifact contract. */
import { describe, expect, test } from 'bun:test'

import {
  backendProviderPlanDigestV2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  emitBackendProviderPlanV2,
  lowerSupabaseBackendApplicationV2ToV1,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  SUPABASE_COMMON_ARTIFACT_PATHS_V2,
  SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2,
  type BackendProviderPlanV2
} from '@open-pencil/compiler'

import { supabasePrivateRealtimeApplicationV2, supabasePrivateRealtimeSelectionV2 } from './helpers'

function createPlan(application = supabasePrivateRealtimeApplicationV2()) {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
  const result = createBackendProviderPlanV2(registry, {
    selection,
    application,
    target: 'react',
    mode: 'production'
  })
  return { registry, selection, result }
}

function emittedArtifacts(application = supabasePrivateRealtimeApplicationV2()) {
  const planned = createPlan(application)
  expect(planned.result.ok).toBe(true)
  if (!planned.result.ok) throw new Error(JSON.stringify(planned.result.diagnostics))
  const emitted = emitBackendProviderPlanV2(planned.registry, {
    plan: planned.result.plan,
    selection: planned.selection
  })
  expect(emitted.ok).toBe(true)
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))
  const artifact = (path: string): string => {
    const content = emitted.emission.files.get(path)
    if (typeof content !== 'string') throw new Error(`Missing text artifact: ${path}`)
    return content
  }
  return { ...planned, plan: planned.result.plan, emission: emitted.emission, artifact }
}

type GeneratedRealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
type GeneratedRealtimeStatusCallback = (status: GeneratedRealtimeStatus, error?: Error) => void
type GeneratedRealtimeHandle = {
  readonly topic: string
  refreshAuth(): Promise<void>
  dispose(): Promise<void>
}
type GeneratedRealtimeSubscribe = (
  args: Record<string, unknown>
) => Promise<GeneratedRealtimeHandle>

function generatedRealtimeClient() {
  const client = emittedArtifacts().artifact(SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.client)
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    client.replaceAll('export ', '')
  )
  const subscribe = new Function(
    `${javascript}\nreturn subscribeOpenPencilInvalidation`
  )() as GeneratedRealtimeSubscribe
  return { client, subscribe }
}

describe('Supabase Backend Provider V2 private Realtime review artifacts', () => {
  test('plans and emits deterministic review-only artifacts through the isolated V2 bridge', () => {
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.auth).toMatchObject({
      capabilities: ['auth.identity'],
      outputs: []
    })
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.migrations).toMatchObject({
      capabilities: ['migrations.schema'],
      outputs: ['database-schema', 'migration-plan']
    })
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.securityPolicy).toMatchObject({
      capabilities: ['policy.row-level'],
      outputs: ['security-policy']
    })
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.realtime).toMatchObject({
      capabilities: ['events.data-change', 'realtime.subscribe'],
      outputs: ['client-config', 'deployment-manifest', 'security-policy']
    })
    const first = emittedArtifacts()
    const second = emittedArtifacts()

    expect(first.plan.planDigest).toBe(second.plan.planDigest)
    expect(first.emission.manifestDigest).toBe(second.emission.manifestDigest)
    expect([...first.emission.files]).toEqual([...second.emission.files])
    expect(first.plan.actualCapabilities).toEqual([
      'auth.identity',
      'events.data-change',
      'migrations.schema',
      'policy.row-level',
      'realtime.subscribe'
    ])
    expect(first.plan.capabilities).toEqual(
      first.plan.actualCapabilities.map((capability) => ({
        capability,
        required: true,
        providerSupported: true,
        targetStatus: 'supported',
        resolution: 'supported',
        included: true
      }))
    )
    expect(Object.keys(first.plan.adapterPlans)).toEqual([
      'auth',
      'securityPolicy',
      'migrations',
      'realtime'
    ])
    expect(first.result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'supabase-v2-private-realtime-managed-schema-prerequisite',
        severity: 'warning'
      })
    )

    const review = JSON.parse(
      first.artifact(SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.reviewManifest)
    )
    const prerequisites = JSON.parse(
      first.artifact(SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.databasePrerequisites)
    )
    expect(review).toMatchObject({
      reviewOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      releaseReady: false,
      capabilityCoverage: {
        'auth.identity': 'host-auth-session-contract-planned',
        'events.data-change': 'minimal-invalidation-trigger-review-artifacts-emitted',
        'migrations.schema': 'target-model-and-inspection-gated-review-artifacts-emitted',
        'policy.row-level': 'owner-rls-review-artifacts-emitted',
        'realtime.subscribe': 'review-artifacts-emitted'
      },
      dashboard: { allowPublicAccess: false },
      managedObjectLifecycle: {
        repeatApplyAllowed: false,
        priorManagedObjectDrift: 'hard-blocked'
      },
      privateSchemaAuthority: {
        requiredOwner: 'current-trusted-migration-role',
        mismatchedOwner: 'hard-blocked'
      }
    })
    expect(review.requiredManualChecks).toContain('retire-prior-application-id-managed-objects')
    expect(review.requiredManualChecks).toContain(
      'inspect-existing-realtime-messages-policies-for-broad-access'
    )
    expect(prerequisites).toMatchObject({
      targetModelArtifactEmitted: true,
      migrationReviewArtifactEmitted: true,
      ownerRlsReviewArtifactsEmitted: true,
      schemaApplyAllowed: false,
      privateSupportSchemaSqlEmitted: true,
      requiredEvidence: 'trusted-p1-source-ledger-applied-schema-receipt'
    })
    expect(JSON.stringify(review)).not.toContain('prerequisite-only-not-implemented')
    expect(JSON.stringify(prerequisites)).not.toContain('schemaSqlEmitted')

    const databaseSchema = JSON.parse(
      first.artifact(SUPABASE_COMMON_ARTIFACT_PATHS_V2.databaseSchema)
    )
    const migrationPlan = JSON.parse(
      first.artifact(SUPABASE_COMMON_ARTIFACT_PATHS_V2.migrationPlan)
    )
    const securityPolicy = JSON.parse(
      first.artifact(SUPABASE_COMMON_ARTIFACT_PATHS_V2.securityPolicyManifest)
    )
    const rlsSql = first.artifact(SUPABASE_COMMON_ARTIFACT_PATHS_V2.securityPolicy)
    expect(migrationPlan.targetModel).toEqual(databaseSchema.model)
    expect(migrationPlan.targetModelDigest).toBe(databaseSchema.modelDigest)
    expect(securityPolicy).toEqual(first.plan.adapterPlans.securityPolicy)
    expect(databaseSchema).toMatchObject({
      format: 'openpencil.supabase-database-schema.v1',
      management: { managed: 'migration-proposal-eligible-after-remote-inspection' }
    })
    expect(databaseSchema.model.entities[0]).toMatchObject({ id: 'tasks', management: 'managed' })
    expect(migrationPlan).toMatchObject({
      format: 'openpencil.supabase-migration-proposal.v1',
      currentModel: 'remote-inspection-required',
      applyAllowed: false,
      releaseReady: false
    })
    expect(migrationPlan.targetModel.entities[0].id).toBe('tasks')
    expect(securityPolicy).toMatchObject({
      format: 'openpencil.supabase-security-policy.v1',
      proposalOnly: true,
      applyAllowed: false,
      releaseReady: false
    })
    expect(securityPolicy.tables[0]).toMatchObject({
      entityId: 'tasks'
    })
    expect(securityPolicy.tables[0].policies[0]).toMatchObject({
      status: 'emitted',
      principal: { kind: 'owner' }
    })
    expect(
      Object.values(SUPABASE_COMMON_ARTIFACT_PATHS_V2).every((path) =>
        path.startsWith('backend/supabase-v2/base/')
      )
    ).toBe(true)
    expect(rlsSql).toContain('ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;')
    expect(rlsSql).toContain('(select auth.uid()) = "owner_id"')

    const reasoned = supabasePrivateRealtimeApplicationV2()
    const migrationCapability = reasoned.capabilities.find(
      (entry) => entry.capability === 'migrations.schema'
    )
    expect(migrationCapability).toBeDefined()
    if (!migrationCapability) throw new Error('Missing migration capability test fixture')
    migrationCapability.reason = 'Managed schema review is required.'
    expect(
      lowerSupabaseBackendApplicationV2ToV1(reasoned).capabilities.find(
        (entry) => entry.capability === 'migrations.schema'
      )?.reason
    ).toBe('Managed schema review is required.')

    const vue = createPlan()
    expect(vue.result.ok).toBe(true)
    const vueResult = createBackendProviderPlanV2(vue.registry, {
      selection: vue.selection,
      application: supabasePrivateRealtimeApplicationV2(),
      target: 'vue',
      mode: 'production'
    })
    expect(vueResult).toMatchObject({ ok: true })
  })

  test('emits owner-scoped private Broadcast SQL without mutating the locked Realtime schema', () => {
    const result = emittedArtifacts()
    const sql = result.artifact(SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.sql)
    const realtimePlan = result.plan.adapterPlans.realtime as {
      subscriptions: readonly [{ digest: string; topicPrefix: string }]
    }
    const { digest, topicPrefix } = realtimePlan.subscriptions[0]

    expect(topicPrefix).toBe(`op:rt:${digest}:`)
    expect(sql).toContain('ON "realtime"."messages"\nFOR SELECT\nTO "authenticated"')
    expect(sql).toContain('"realtime"."messages"."extension" = \'broadcast\'')
    expect(sql).toContain(
      `(SELECT "realtime"."topic"()) = ('op:rt:${digest}:' || (SELECT "auth"."uid"())::text)`
    )
    expect(sql).toContain('PERFORM "realtime"."send"(')
    expect(sql.match(/PERFORM "realtime"\."send"\(/gu)).toHaveLength(5)
    expect(sql).toContain("'openpencil.invalidate',")
    expect(sql).toContain('\n      true\n    );')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "openpencil_private".')
    expect(sql).toContain("SECURITY DEFINER\nSET search_path = ''")
    expect(sql).toContain('FROM PUBLIC, "anon", "authenticated";')
    expect(sql).toContain('OLD."owner_id" IS DISTINCT FROM NEW."owner_id"')
    expect(sql).toContain("'entityId', 'tasks', 'operation', 'insert', 'primaryKey'")
    expect(sql).toContain("'entityId', 'tasks', 'operation', 'update', 'primaryKey'")
    expect(sql).toContain("'entityId', 'tasks', 'operation', 'delete', 'primaryKey'")
    expect(sql).not.toContain("'owner_id'")
    expect(sql).not.toContain("'title'")
    expect(sql).not.toContain('broadcast_changes')
    expect(sql).not.toMatch(/"to_jsonb"\((?:NEW|OLD)\)/u)
    expect(sql).not.toMatch(/CREATE\s+(?:TABLE|SCHEMA)[^;]*[".]realtime/iu)
    expect(sql).not.toMatch(/ALTER\s+TABLE[^;]*[".]realtime/iu)
    expect(sql).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/iu)
    expect(sql).toContain('DO $openpencil_drift$\nBEGIN')
    expect(sql).toContain('END;\n$openpencil_drift$;')
    expect(sql).toContain('END;\n$openpencil_owner$;')
    expect(sql).toContain('schema_owner."rolname" = CURRENT_USER')
  })

  test('waits for subscription readiness and executes fail-closed disposal', async () => {
    const { client, subscribe } = generatedRealtimeClient()
    expect(client.match(/await supabase\.realtime\.setAuth\(\)/gu)).toHaveLength(2)
    expect(client).toContain('options: { config: { private: true } }')
    expect(client).toContain('supabase.channel(topic, { config: { private: true } })')
    expect(client).toContain('await supabase.removeChannel(channel)')
    expect(client).toContain('OPENPENCIL_REALTIME_SUBSCRIBE_TIMEOUT_MS = 10_000')
    expect(client).toContain("status === 'SUBSCRIBED'")
    expect(client).toContain("status !== 'ok'")
    expect(client).toContain('async refreshAuth()')
    expect(client).toContain(
      "if (lifecycle.stopped) throw new Error('The Realtime subscription is no longer active')"
    )
    expect(client).toContain('!Object.hasOwn(openPencilRealtimeSubscriptions, args.subscriptionId)')
    expect(client).toContain('A lower-case canonical user id is required')
    expect(client).not.toMatch(/accessToken|access_token|credentialRef|Bearer/iu)
    expect(client).not.toMatch(/OPENPENCIL_UUID\s*=.*\/iu/u)
    expect(client).not.toMatch(/sb_secret_|service_role|Bearer\s+[A-Za-z0-9]/iu)

    const authCalls: unknown[][] = []
    let removed = 0
    let selectedTopic = ''
    let broadcast: (() => void) | undefined
    let statusCallback: GeneratedRealtimeStatusCallback | undefined
    const channel = {
      on(_type: string, _filter: unknown, callback: () => void) {
        broadcast = callback
        return channel
      },
      subscribe(callback: GeneratedRealtimeStatusCallback, timeout: number) {
        statusCallback = callback
        expect(timeout).toBe(10_000)
        callback('SUBSCRIBED')
        return channel
      }
    }
    const supabase = {
      realtime: {
        setAuth(...args: unknown[]) {
          authCalls.push(args)
        }
      },
      channel(topic: string, options: { config: { private: boolean } }) {
        selectedTopic = topic
        expect(options).toEqual({ config: { private: true } })
        return channel
      },
      removeChannel(received: unknown) {
        expect(received).toBe(channel)
        removed += 1
        return 'ok'
      }
    }
    const userId = '00000000-0000-0000-0000-000000000000'
    let invalidations = 0
    const handle = await subscribe({
      supabase,
      userId,
      subscriptionId: 'task-list-invalidation',
      onInvalidate() {
        invalidations += 1
      }
    })
    expect(invalidations).toBe(0)
    expect(authCalls).toEqual([[]])
    expect(selectedTopic).toBe(handle.topic)
    expect(selectedTopic.endsWith(`:${userId}`)).toBe(true)
    broadcast?.()
    expect(invalidations).toBe(1)
    await handle.refreshAuth()
    expect(authCalls).toEqual([[], []])
    const firstDispose = handle.dispose()
    const secondDispose = handle.dispose()
    expect(secondDispose).toBe(firstDispose)
    await firstDispose
    expect(handle.dispose()).toBe(firstDispose)
    expect(removed).toBe(1)
    broadcast?.()
    statusCallback?.('CLOSED')
    expect(invalidations).toBe(1)
    await expect(handle.refreshAuth()).rejects.toThrow('no longer active')
    expect(authCalls).toEqual([[], []])
  })

  test('cleans up subscription failures while preserving the original failure', async () => {
    const { subscribe } = generatedRealtimeClient()
    const subscriptionFailure = new Error('simulated channel rejection')
    let removed = 0
    let invalidations = 0
    let broadcast: (() => void) | undefined
    const channel = {
      on(_type: string, _filter: unknown, callback: () => void) {
        broadcast = callback
        return channel
      },
      subscribe(callback: GeneratedRealtimeStatusCallback, timeout: number) {
        expect(timeout).toBe(10_000)
        callback('CHANNEL_ERROR', subscriptionFailure)
        return channel
      }
    }
    const supabase = {
      realtime: { setAuth: () => undefined },
      channel() {
        return channel
      },
      removeChannel(received: unknown) {
        expect(received).toBe(channel)
        removed += 1
        return 'ok'
      }
    }
    const attempt = subscribe({
      supabase,
      userId: '00000000-0000-0000-0000-000000000000',
      subscriptionId: 'task-list-invalidation',
      onInvalidate() {
        invalidations += 1
      }
    })
    await expect(attempt).rejects.toBe(subscriptionFailure)
    expect(removed).toBe(1)
    broadcast?.()
    expect(invalidations).toBe(0)
  })

  test('removes a channel and suppresses invalidation after a post-ready terminal status', async () => {
    const { subscribe } = generatedRealtimeClient()
    let broadcast: (() => void) | undefined
    let statusCallback: GeneratedRealtimeStatusCallback | undefined
    let invalidations = 0
    let removed = 0
    const channel = {
      on(_type: string, _filter: unknown, callback: () => void) {
        broadcast = callback
        return channel
      },
      subscribe(callback: GeneratedRealtimeStatusCallback) {
        statusCallback = callback
        callback('SUBSCRIBED')
        return channel
      }
    }
    const supabase = {
      realtime: { setAuth: () => undefined },
      channel() {
        return channel
      },
      removeChannel() {
        removed += 1
        return 'ok'
      }
    }
    const handle = await subscribe({
      supabase,
      userId: '00000000-0000-0000-0000-000000000000',
      subscriptionId: 'task-list-invalidation',
      onInvalidate() {
        invalidations += 1
      }
    })
    broadcast?.()
    expect(invalidations).toBe(1)
    statusCallback?.('CHANNEL_ERROR', new Error('late channel failure'))
    expect(removed).toBe(1)
    broadcast?.()
    expect(invalidations).toBe(1)
    await expect(handle.refreshAuth()).rejects.toThrow('no longer active')
    await handle.dispose()
    expect(removed).toBe(1)
  })

  test('rejects non-ok removal and aggregates cleanup failure without losing subscribe failure', async () => {
    const { subscribe } = generatedRealtimeClient()
    let broadcast: (() => void) | undefined
    let statusCallback: GeneratedRealtimeStatusCallback | undefined
    let removalStatus = 'error'
    let invalidations = 0
    const channel = {
      on(_type: string, _filter: unknown, callback: () => void) {
        broadcast = callback
        return channel
      },
      subscribe(callback: GeneratedRealtimeStatusCallback) {
        statusCallback = callback
        callback('SUBSCRIBED')
        return channel
      }
    }
    const supabase = {
      realtime: { setAuth: () => undefined },
      channel() {
        return channel
      },
      removeChannel() {
        return removalStatus
      }
    }
    const args = {
      supabase,
      userId: '00000000-0000-0000-0000-000000000000',
      subscriptionId: 'task-list-invalidation',
      onInvalidate() {
        invalidations += 1
      }
    }
    const handle = await subscribe(args)
    const firstDispose = handle.dispose()
    expect(handle.dispose()).toBe(firstDispose)
    await expect(firstDispose).rejects.toThrow('removal failed with status error')
    broadcast?.()
    expect(invalidations).toBe(0)

    removalStatus = 'timed out'
    const subscribeFailure = new Error('second channel rejection')
    channel.subscribe = (callback: GeneratedRealtimeStatusCallback) => {
      statusCallback = callback
      callback('CHANNEL_ERROR', subscribeFailure)
      return channel
    }
    let aggregate: unknown
    try {
      await subscribe(args)
    } catch (cause) {
      aggregate = cause
    }
    expect(aggregate).toBeInstanceOf(AggregateError)
    expect((aggregate as AggregateError).errors[0]).toBe(subscribeFailure)
    expect((aggregate as AggregateError).errors[1]).toEqual(
      expect.objectContaining({
        message: 'Supabase Realtime channel removal failed with status timed out'
      })
    )
    statusCallback?.('CLOSED')
    broadcast?.()
    expect(invalidations).toBe(0)
  })

  test('keeps object names stable per app and subscription while behavior-bound topics change', () => {
    const before = emittedArtifacts()
    const changed = supabasePrivateRealtimeApplicationV2()
    changed.realtime.subscriptions[0].delivery.queryKey = 'tasks.changed'
    const after = emittedArtifacts(changed)
    const beforePlan = before.plan.adapterPlans.realtime as {
      subscriptions: readonly [
        {
          digest: string
          applicationObjectKey: string
          subscriptionObjectKey: string
        }
      ]
    }
    const afterPlan = after.plan.adapterPlans.realtime as typeof beforePlan
    expect(afterPlan.subscriptions[0].applicationObjectKey).toBe(
      beforePlan.subscriptions[0].applicationObjectKey
    )
    expect(afterPlan.subscriptions[0].subscriptionObjectKey).toBe(
      beforePlan.subscriptions[0].subscriptionObjectKey
    )
    expect(afterPlan.subscriptions[0].digest).not.toBe(beforePlan.subscriptions[0].digest)

    const otherApp = supabasePrivateRealtimeApplicationV2()
    otherApp.applicationId = 'test.supabase-private-realtime.other'
    const other = emittedArtifacts(otherApp)
    const otherPlan = other.plan.adapterPlans.realtime as typeof beforePlan
    expect(otherPlan.subscriptions[0].applicationObjectKey).not.toBe(
      beforePlan.subscriptions[0].applicationObjectKey
    )
    expect(other.artifact(SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.sql)).not.toContain(
      `oprtf_${beforePlan.subscriptions[0].applicationObjectKey}_`
    )
    expect(other.artifact(SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.sql)).not.toContain(
      `oprtt_${beforePlan.subscriptions[0].applicationObjectKey}_`
    )
    expect(other.artifact(SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.sql)).not.toContain(
      `oprtp_${beforePlan.subscriptions[0].applicationObjectKey}_`
    )
  })

  test('fails closed for non-owner principals, invalid owner fields, and a missing select policy', () => {
    const broad = supabasePrivateRealtimeApplicationV2()
    broad.realtime.subscriptions[0].principal = { kind: 'authenticated' }
    broad.auth.rowAccess[0].principal = { kind: 'authenticated' }
    expect(createPlan(broad).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'supabase-v2-private-realtime-owner-principal-required'
        })
      ])
    })

    for (const invalidField of [
      { type: 'string' as const, nullable: false },
      { type: 'uuid' as const, nullable: true }
    ]) {
      const invalidOwner = supabasePrivateRealtimeApplicationV2()
      Object.assign(invalidOwner.dataModel.entities[0].fields[1], invalidField)
      expect(createPlan(invalidOwner).result).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'supabase-v2-private-realtime-owner-field-invalid' })
        ])
      })
    }

    const missingPolicy = supabasePrivateRealtimeApplicationV2()
    missingPolicy.auth.rowAccess = []
    expect(createPlan(missingPolicy).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-realtime-select-policy-missing' })
      ])
    })

    const extraBroadPolicy = supabasePrivateRealtimeApplicationV2()
    extraBroadPolicy.auth.rowAccess.push({
      id: 'extra-broad',
      entityId: 'tasks',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'authenticated' }
    })
    expect(createPlan(extraBroadPolicy).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-broad-row-policy-blocked' })
      ])
    })
  })

  test('rejects secret-like IR before planning and rejects self-consistent stale plan tampering', () => {
    const secretLike = supabasePrivateRealtimeApplicationV2()
    secretLike.realtime.subscriptions[0].delivery.queryKey = 'sb_secret_not-a-real-test-value'
    expect(createPlan(secretLike).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-secret-material-forbidden' })
      ])
    })

    const planned = createPlan()
    expect(planned.result.ok).toBe(true)
    if (!planned.result.ok) return
    const tampered = structuredClone(planned.result.plan) as BackendProviderPlanV2 & {
      planDigest: string
      adapterPlans: { realtime: { tampered?: boolean } }
    }
    tampered.adapterPlans.realtime.tampered = true
    tampered.planDigest = backendProviderPlanDigestV2(tampered)
    expect(
      emitBackendProviderPlanV2(planned.registry, {
        plan: tampered,
        selection: planned.selection
      })
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-provider-v2-plan-stale' })
      ])
    })
  })
})
