/* oxlint-disable max-lines, typescript-eslint/no-implied-eval -- Generated-client assertions execute reviewed emitted TypeScript. */
import { describe, expect, test } from 'bun:test'

import {
  backendProviderPlanDigestV2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  emitBackendProviderPlanV2,
  SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2,
  SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  type BackendProviderAdapterContextV2,
  type BackendProviderPlanV2
} from '@open-pencil/compiler'

import {
  supabaseAtomicTransactionApplicationV2,
  supabasePrivateRealtimeSelectionV2
} from './helpers'

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function createPlan(application = supabaseAtomicTransactionApplicationV2()) {
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

function emittedArtifacts(application = supabaseAtomicTransactionApplicationV2()) {
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

type GeneratedAtomicExecutor = (args: {
  readonly supabase: {
    rpc(
      name: string,
      args: Record<string, unknown>
    ): PromiseLike<{
      data: unknown
      error: unknown
      count?: unknown
      status?: unknown
      statusText?: unknown
      success?: unknown
    }>
  }
  readonly parameters: Record<string, unknown>
}) => Promise<{
  readonly entityId: string
  readonly primaryKey: Readonly<Record<string, string>>
  readonly newVersion: number
}>

function generatedAtomicClient() {
  const client = emittedArtifacts().artifact(SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.client)
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    client.replaceAll('export ', '')
  )
  const loaded = new Function(
    `${javascript}\nreturn { executeOpenPencilAtomicTransaction, openPencilAtomicTransaction }`
  )() as {
    executeOpenPencilAtomicTransaction: GeneratedAtomicExecutor
    openPencilAtomicTransaction: {
      readonly transactionId: string
      readonly functionName: string
      readonly retry: false
      readonly idempotency: false
    }
  }
  return { client, ...loaded }
}

async function capturedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected generated atomic client call to reject')
}

describe('Supabase Backend Provider V2 atomic transaction review artifacts', () => {
  test('routes data and atomic authority through distinct deterministic adapter slots', () => {
    expect(SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2).toBe('2.3.0')
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.data).toMatchObject({
      capabilities: ['data.read', 'data.write'],
      outputs: []
    })
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.transactions).toMatchObject({
      capabilities: ['transactions.atomic'],
      outputs: ['client-config', 'deployment-manifest', 'server-runtime']
    })
    const first = emittedArtifacts()
    const second = emittedArtifacts()

    expect(first.plan.planDigest).toBe(second.plan.planDigest)
    expect(first.emission.manifestDigest).toBe(second.emission.manifestDigest)
    expect([...first.emission.files]).toEqual([...second.emission.files])
    expect(first.plan.actualCapabilities).toEqual([
      'auth.identity',
      'data.read',
      'data.write',
      'migrations.schema',
      'policy.row-level',
      'transactions.atomic'
    ])
    expect(Object.keys(first.plan.adapterPlans)).toEqual([
      'data',
      'auth',
      'securityPolicy',
      'migrations',
      'transactions'
    ])
    expect(first.plan.adapterPlans.data).toMatchObject({
      releaseReady: false,
      p1ReceiptBound: false,
      p1ArtifactDigestBound: false,
      directOwnerCrud: true,
      exclusiveWriteAuthority: false,
      atomicGuarantee: 'rpc-call-only',
      directOwnerCrudAuthority: 'p1-owner-rls-and-authenticated-table-grants',
      executionBoundary: 'single-reviewed-atomic-rpc',
      operations: ['select-for-update', 'bounded-update']
    })
    expect(first.plan.adapterPlans.transactions).toMatchObject({
      reviewOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      releaseReady: false,
      p1ReceiptBound: false,
      p1ArtifactDigestBound: false,
      directOwnerCrud: true,
      exclusiveWriteAuthority: false,
      atomicGuarantee: 'rpc-call-only',
      execution: {
        api: 'postgrest-rpc',
        schema: 'public',
        security: 'invoker',
        isolation: 'serializable',
        atomicGuarantee: 'rpc-call-only',
        directOwnerCrud: true,
        exclusiveWriteAuthority: false,
        retry: 'caller-forbidden-by-generated-client'
      }
    })
    expect(first.result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'supabase-v2-atomic-reviewed-apply-required',
        severity: 'warning',
        message: expect.stringContaining('P1 direct owner REST CRUD remains available')
      })
    )

    const manifest = JSON.parse(
      first.artifact(SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.reviewManifest)
    )
    const prerequisites = JSON.parse(
      first.artifact(SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.prerequisites)
    )
    expect(manifest).toMatchObject({
      reviewOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      releaseReady: false,
      directOwnerCrud: true,
      exclusiveWriteAuthority: false,
      atomicGuarantee: 'rpc-call-only',
      actualCapabilities: first.plan.actualCapabilities,
      capabilityCoverage: {
        'data.read': 'atomic-rpc-step-plus-existing-p1-direct-owner-rest-read',
        'data.write': 'atomic-rpc-step-plus-existing-p1-direct-owner-rest-write',
        'transactions.atomic': 'serializable-postgrest-rpc-review-artifacts-emitted'
      },
      rpc: {
        schema: 'public',
        volatility: 'volatile',
        security: 'invoker',
        isolation: 'serializable',
        authenticatedExecuteOnly: true,
        automaticRetry: false,
        idempotencyClaim: false,
        atomicArtifactTablePrivilegeGrantEmitted: false,
        existingOverloads: 'hard-blocked'
      }
    })
    expect(manifest.requiredManualChecks).toContain(
      'verify-two-client-same-version-one-winner-one-serialization-conflict'
    )
    expect(manifest.requiredManualChecks).toContain(
      'verify-postgrest-single-request-transaction-and-schema-cache-reload'
    )
    expect(manifest.releaseBlockers).toEqual(
      expect.arrayContaining([
        'p1-source-ledger-receipt-not-bound-to-v2-plan',
        'p1-schema-and-policy-artifact-digests-not-bound-to-v2-plan',
        'p1-owner-policy-expression-evidence-not-bound-to-v2-plan',
        'direct-owner-rest-write-remains-available-outside-atomic-rpc'
      ])
    )
    expect(prerequisites).toMatchObject({
      schemaApplyAllowed: false,
      atomicArtifactTablePrivilegeGrantEmitted: false,
      p1ReceiptBound: false,
      p1ArtifactDigestBound: false,
      releaseReady: false,
      directOwnerCrud: true,
      exclusiveWriteAuthority: false,
      atomicGuarantee: 'rpc-call-only',
      postgrest: {
        exposedSchema: 'public',
        requestTransaction: 'single-database-transaction',
        schemaCacheReloadNotificationEmitted: true
      }
    })

    const vue = createBackendProviderPlanV2(first.registry, {
      selection: first.selection,
      application: supabaseAtomicTransactionApplicationV2(),
      target: 'vue',
      mode: 'production'
    })
    expect(vue).toMatchObject({ ok: true })
  })

  test('emits a public SECURITY INVOKER serializable RPC with exact ACL and owner predicates', () => {
    const result = emittedArtifacts()
    const sql = result.artifact(SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.sql)
    const transactionPlan = result.plan.adapterPlans.transactions as {
      transaction: { functionName: string }
    }
    const functionName = transactionPlan.transaction.functionName

    expect(sql).toContain(`CREATE FUNCTION "public"."${functionName}"(`)
    expect(sql).toContain('LANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER')
    expect(sql).toContain("SET search_path = ''")
    expect(sql).toContain("SET default_transaction_isolation TO 'serializable'")
    expect(sql).toContain('"pg_catalog"."current_setting"(\'transaction_isolation\')')
    expect(sql).toContain('"auth"."uid"()')
    expect(sql).toContain('FROM "public"."tasks" AS "target_row"')
    expect(sql).toContain('FOR UPDATE;')
    expect(sql).toContain('UPDATE "public"."tasks" AS "target_row"')
    expect(sql).toContain('"version" = "target_row"."version" + 1')
    expect(sql).toContain('"target_row"."owner_id" = "current_user_id"')
    expect(sql).toContain('"target_row"."id" = $3')
    expect(sql).toContain('"target_row"."version" = $1')
    expect(sql).toContain('"score" = $2')
    expect(sql).toContain('"title" = $4')
    expect(sql).toContain('IF $1 IS NULL THEN')
    expect(sql).toContain('IF $2 IS NULL THEN')
    expect(sql).toContain('IF $3 IS NULL THEN')
    expect(sql).toContain('IF $4 IS NULL THEN')
    expect(sql).toContain("$2::\"pg_catalog\".\"text\" IN ('NaN', 'Infinity', '-Infinity')")
    expect(sql).toContain('"pg_catalog"."octet_length"($4) > 4000000')
    expect(sql).toContain('9007199254740990')
    expect(sql).toContain('GET DIAGNOSTICS "affected_rows" = ROW_COUNT;')
    expect(sql).toContain('"updated_version" IS DISTINCT FROM $1 + 1')
    expect(sql).toContain('\'newVersion\', "pg_catalog"."to_jsonb"("updated_version")')
    expect(sql).toContain('openpencil:v1:entity:tasks')
    expect(sql).toContain('openpencil:v1:field:task-score')
    expect(sql).toContain('openpencil:v1:primary-key:tasks')
    expect(sql).toContain('"pg_catalog"."obj_description"("managed_policy"."oid", \'pg_policy\')')
    expect(sql).toContain("'openpencil:v1:policy:ope' ||")
    expect(sql).toContain('"managed_table"."relrowsecurity"')
    expect(sql).toContain('"managed_table"."relforcerowsecurity"')
    expect(sql).toContain('"role_entry"."rolsuper"')
    expect(sql).toContain('"role_entry"."rolbypassrls"')
    expect(sql).toContain('FROM "pg_catalog"."pg_trigger" AS "user_trigger"')
    expect(sql).toContain('AND NOT "user_trigger"."tgisinternal"')
    expect(sql).toContain('FROM "pg_catalog"."pg_rewrite" AS "user_rule"')
    expect(sql).toContain('OpenPencil direct table grant prerequisite failed')
    expect(sql).toContain('P1 owner RLS and authenticated table grants still permit direct REST')
    expect(sql).toContain(`"managed_function"."proname" = '${functionName}'`)
    expect(sql).toContain('"pg_catalog"."aclexplode"(')
    expect(sql).toContain('AND NOT "function_acl"."is_grantable"')
    expect(sql).toContain('FROM PUBLIC, "anon", "authenticated", "service_role";')
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION "public"."${functionName}"("pg_catalog"."int8", "pg_catalog"."float8", "pg_catalog"."uuid", "pg_catalog"."text") TO "authenticated";`
    )
    expect(sql).toContain('NOTIFY "pgrst", \'reload schema\';\nCOMMIT;')
    expect(sql).not.toContain('SECURITY DEFINER')
    expect(sql).not.toContain('CREATE OR REPLACE')
    expect(sql).not.toMatch(/\bDROP\b/iu)
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[^;]*TO\s+(?:PUBLIC|"anon"|"service_role")/iu)
    expect(sql).not.toMatch(/GRANT\s+[^;]*ON\s+TABLE/iu)
    expect(sql).not.toMatch(/\n\s*EXECUTE\s+/u)
    expect(sql).not.toMatch(/to_jsonb\("target_row"\)|RETURNING\s+\*/iu)
  })

  test('executes the generated client once and validates exact inputs and output', async () => {
    const { client, executeOpenPencilAtomicTransaction, openPencilAtomicTransaction } =
      generatedAtomicClient()
    expect(openPencilAtomicTransaction).toMatchObject({
      transactionId: 'update-task-title',
      retry: false,
      idempotency: false
    })
    expect(client).toContain(
      'responseValue = await args.supabase.rpc(openPencilAtomicTransaction.functionName'
    )
    expect(client).toContain("OpenPencilAtomicTransactionError('request-failed')")
    expect(client).not.toMatch(/accessToken|access_token|credentialRef|Bearer/iu)
    expect(client).not.toMatch(/\bretry\s*\(|setTimeout|while\s*\(|for\s*\([^)]*rpc/iu)

    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const taskId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const supabase = {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return Promise.resolve({
          data: { entityId: 'tasks', primaryKey: { id: taskId }, newVersion: 8 },
          error: null,
          success: true,
          count: null,
          status: 200,
          statusText: 'OK'
        })
      }
    }
    const result = await executeOpenPencilAtomicTransaction({
      supabase,
      parameters: { expectedVersion: 7, score: 4.5, taskId, title: 'Reviewed title' }
    })
    expect(result).toEqual({ entityId: 'tasks', primaryKey: { id: taskId }, newVersion: 8 })
    expect(calls).toEqual([
      {
        name: openPencilAtomicTransaction.functionName,
        args: { arg_001: 7, arg_002: 4.5, arg_003: taskId, arg_004: 'Reviewed title' }
      }
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.primaryKey)).toBe(true)

    await expect(
      executeOpenPencilAtomicTransaction({
        supabase,
        parameters: {
          expectedVersion: Number.MAX_SAFE_INTEGER,
          score: 1,
          taskId,
          title: 'Nope'
        }
      })
    ).rejects.toThrow('expectedVersion is invalid')
    await expect(
      executeOpenPencilAtomicTransaction({
        supabase,
        parameters: { expectedVersion: 7, score: 1, taskId: taskId.toUpperCase(), title: 'Nope' }
      })
    ).rejects.toThrow('taskId is invalid')
    await expect(
      executeOpenPencilAtomicTransaction({
        supabase,
        parameters: { expectedVersion: 7, score: 1, taskId, title: 'Nope', extra: true }
      })
    ).rejects.toThrow('exact data-only object')
    await expect(
      executeOpenPencilAtomicTransaction({
        supabase,
        parameters: { expectedVersion: 7, score: null, taskId, title: 'Nope' }
      })
    ).rejects.toThrow('score is invalid')
    await expect(
      executeOpenPencilAtomicTransaction({
        supabase,
        parameters: { expectedVersion: 7, score: Number.POSITIVE_INFINITY, taskId, title: 'Nope' }
      })
    ).rejects.toThrow('score is invalid')
    expect(calls).toHaveLength(1)
  })

  test('accepts exact legacy five-key PostgREST success and failure envelopes', async () => {
    const { executeOpenPencilAtomicTransaction } = generatedAtomicClient()
    const taskId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const parameters = { expectedVersion: 7, score: 4.5, taskId, title: 'Reviewed title' }
    const successClient = {
      rpc() {
        return Promise.resolve({
          data: { entityId: 'tasks', primaryKey: { id: taskId }, newVersion: 8 },
          error: null,
          count: 1,
          status: 200,
          statusText: 'OK'
        })
      }
    }
    await expect(
      executeOpenPencilAtomicTransaction({ supabase: successClient, parameters })
    ).resolves.toEqual({ entityId: 'tasks', primaryKey: { id: taskId }, newVersion: 8 })

    const failureClient = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { code: '40001', message: 'legacy conflict', details: null, hint: null },
          count: null,
          status: 409,
          statusText: 'Conflict'
        })
      }
    }
    expect(
      await capturedError(
        executeOpenPencilAtomicTransaction({ supabase: failureClient, parameters })
      )
    ).toMatchObject({ code: 'conflict' })
  })

  test('does not retry, types failures, and never leaks raw PostgREST errors', async () => {
    const { executeOpenPencilAtomicTransaction } = generatedAtomicClient()
    const taskId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const parameters = { expectedVersion: 7, score: 4.5, taskId, title: 'Reviewed title' }
    let calls = 0
    const conflictClient = {
      rpc() {
        calls += 1
        return Promise.resolve({
          data: null,
          error: { code: '40001', message: 'sb_secret_conflict_must_not_leak' },
          success: false,
          count: null,
          status: 409,
          statusText: 'Conflict'
        })
      }
    }
    const conflict = await capturedError(
      executeOpenPencilAtomicTransaction({ supabase: conflictClient, parameters })
    )
    expect(conflict).toMatchObject({
      name: 'OpenPencilAtomicTransactionError',
      code: 'conflict',
      message: 'Supabase atomic transaction conflicted'
    })
    expect(String(conflict)).not.toContain('sb_secret_conflict_must_not_leak')
    expect(calls).toBe(1)

    const rejectedClient = {
      rpc() {
        calls += 1
        return Promise.reject(new Error('sb_secret_network_failure_must_not_leak'))
      }
    }
    const requestFailure = await capturedError(
      executeOpenPencilAtomicTransaction({ supabase: rejectedClient, parameters })
    )
    expect(requestFailure).toMatchObject({
      name: 'OpenPencilAtomicTransactionError',
      code: 'request-failed',
      message: 'Supabase atomic transaction request failed'
    })
    expect(String(requestFailure)).not.toContain('sb_secret_network_failure_must_not_leak')
    expect(calls).toBe(2)

    const fetchFailureClient = {
      rpc() {
        calls += 1
        return Promise.resolve({
          data: null,
          error: { code: '', message: 'fetch failed', details: null, hint: null },
          success: false,
          count: null,
          status: 0,
          statusText: ''
        })
      }
    }
    expect(
      await capturedError(
        executeOpenPencilAtomicTransaction({ supabase: fetchFailureClient, parameters })
      )
    ).toMatchObject({ code: 'request-failed' })
    expect(calls).toBe(3)

    const invalidResultClient = {
      rpc() {
        return Promise.resolve({
          data: { entityId: 'tasks', primaryKey: { id: taskId }, newVersion: 9 },
          error: null,
          success: true,
          count: null,
          status: 200,
          statusText: 'OK'
        })
      }
    }
    expect(
      await capturedError(
        executeOpenPencilAtomicTransaction({ supabase: invalidResultClient, parameters })
      )
    ).toMatchObject({ code: 'invalid-result' })

    const wrongEntityClient = {
      rpc() {
        return Promise.resolve({
          data: { entityId: 'other', primaryKey: { id: taskId }, newVersion: 8 },
          error: null,
          success: true,
          count: null,
          status: 200,
          statusText: 'OK'
        })
      }
    }
    expect(
      await capturedError(
        executeOpenPencilAtomicTransaction({ supabase: wrongEntityClient, parameters })
      )
    ).toMatchObject({ code: 'invalid-result' })
  })

  test('rejects missing, unknown, invalid, and contradictory PostgREST metadata', async () => {
    const { executeOpenPencilAtomicTransaction } = generatedAtomicClient()
    const taskId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const parameters = { expectedVersion: 7, score: 4.5, taskId, title: 'Reviewed title' }
    const data = { entityId: 'tasks', primaryKey: { id: taskId }, newVersion: 8 }
    const executeEnvelope = (response: unknown) =>
      executeOpenPencilAtomicTransaction({
        supabase: {
          rpc() {
            return Promise.resolve(response as { readonly data: unknown; readonly error: unknown })
          }
        },
        parameters
      })
    const invalidEnvelopes: readonly unknown[] = [
      { data, error: null, count: null, status: 200 },
      { data, error: undefined, count: null, status: 200, statusText: 'OK' },
      { data, error: null, count: -1, status: 200, statusText: 'OK' },
      { data, error: null, count: 1.5, status: 200, statusText: 'OK' },
      { data, error: null, count: null, status: 600, statusText: 'OK' },
      { data, error: null, count: null, status: 200, statusText: 'x'.repeat(1_001) },
      { data, error: null, count: null, status: 500, statusText: 'Error' },
      { data, error: null, success: true, count: null, status: 500, statusText: 'Error' },
      { data, error: null, success: false, count: null, status: 200, statusText: 'OK' },
      {
        data: null,
        error: { code: '40001' },
        success: true,
        count: null,
        status: 409,
        statusText: 'Conflict'
      },
      {
        data: null,
        error: { code: '40001' },
        count: null,
        status: 200,
        statusText: 'OK'
      },
      {
        data,
        error: { code: '40001' },
        success: false,
        count: null,
        status: 409,
        statusText: 'Conflict'
      },
      {
        data: null,
        error: { message: 'missing code' },
        success: false,
        count: null,
        status: 500,
        statusText: 'Error'
      },
      {
        data,
        error: null,
        success: true,
        count: null,
        status: 200,
        statusText: 'OK',
        transportTrace: 'not-reviewed'
      }
    ]
    for (const envelope of invalidEnvelopes) {
      expect(await capturedError(executeEnvelope(envelope))).toMatchObject({
        code: 'invalid-result'
      })
    }
  })

  test('rejects proxies and traps without reading getters or leaking trap failures', async () => {
    const { executeOpenPencilAtomicTransaction } = generatedAtomicClient()
    const taskId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const parameters = { expectedVersion: 7, score: 4.5, taskId, title: 'Reviewed title' }
    const data = { entityId: 'tasks', primaryKey: { id: taskId }, newVersion: 8 }
    const currentEnvelope = {
      data,
      error: null,
      success: true,
      count: null,
      status: 200,
      statusText: 'OK'
    }
    const executeEnvelope = (response: unknown) =>
      executeOpenPencilAtomicTransaction({
        supabase: {
          rpc() {
            return Promise.resolve(response as { readonly data: unknown; readonly error: unknown })
          }
        },
        parameters
      })

    expect(await capturedError(executeEnvelope(new Proxy(currentEnvelope, {})))).toMatchObject({
      code: 'invalid-result'
    })

    const throwingEnvelope = new Proxy(currentEnvelope, {
      ownKeys() {
        throw new Error('sb_secret_envelope_trap_must_not_leak')
      }
    })
    const throwingEnvelopeError = await capturedError(executeEnvelope(throwingEnvelope))
    expect(throwingEnvelopeError).toMatchObject({ code: 'invalid-result' })
    expect(String(throwingEnvelopeError)).not.toContain('sb_secret_envelope_trap_must_not_leak')

    let statefulOwnKeysCalls = 0
    const legacyEnvelope = { data, error: null, count: null, status: 200, statusText: 'OK' }
    const statefulEnvelope = new Proxy(legacyEnvelope, {
      ownKeys(target) {
        statefulOwnKeysCalls += 1
        if (statefulOwnKeysCalls === 1) return Reflect.ownKeys(target)
        throw new Error('sb_secret_stateful_trap_must_not_leak')
      }
    })
    const statefulError = await capturedError(executeEnvelope(statefulEnvelope))
    expect(statefulError).toMatchObject({ code: 'invalid-result' })
    expect(String(statefulError)).not.toContain('sb_secret_stateful_trap_must_not_leak')
    expect(statefulOwnKeysCalls).toBe(2)

    let envelopeGetterCalls = 0
    const accessorEnvelope: Record<string, unknown> = {
      error: null,
      success: true,
      count: null,
      status: 200,
      statusText: 'OK'
    }
    Object.defineProperty(accessorEnvelope, 'data', {
      enumerable: true,
      get() {
        envelopeGetterCalls += 1
        return data
      }
    })
    expect(await capturedError(executeEnvelope(accessorEnvelope))).toMatchObject({
      code: 'invalid-result'
    })
    expect(envelopeGetterCalls).toBe(0)

    let resultGetterCalls = 0
    const accessorResult: Record<string, unknown> = {
      primaryKey: { id: taskId },
      newVersion: 8
    }
    Object.defineProperty(accessorResult, 'entityId', {
      enumerable: true,
      get() {
        resultGetterCalls += 1
        return 'tasks'
      }
    })
    expect(
      await capturedError(executeEnvelope({ ...currentEnvelope, data: accessorResult }))
    ).toMatchObject({ code: 'invalid-result' })
    expect(resultGetterCalls).toBe(0)

    let errorGetterCalls = 0
    const accessorError: Record<string, unknown> = { message: 'failure' }
    Object.defineProperty(accessorError, 'code', {
      enumerable: true,
      get() {
        errorGetterCalls += 1
        return '40001'
      }
    })
    expect(
      await capturedError(
        executeEnvelope({
          ...currentEnvelope,
          data: null,
          error: accessorError,
          success: false,
          status: 409,
          statusText: 'Conflict'
        })
      )
    ).toMatchObject({ code: 'invalid-result' })
    expect(errorGetterCalls).toBe(0)

    const resultTrap = new Proxy(data, {
      ownKeys() {
        throw new Error('sb_secret_result_trap_must_not_leak')
      }
    })
    const resultTrapError = await capturedError(
      executeEnvelope({ ...currentEnvelope, data: resultTrap })
    )
    expect(resultTrapError).toMatchObject({ code: 'invalid-result' })
    expect(String(resultTrapError)).not.toContain('sb_secret_result_trap_must_not_leak')

    const errorTrap = new Proxy(
      { code: '40001' },
      {
        ownKeys() {
          throw new Error('sb_secret_error_trap_must_not_leak')
        }
      }
    )
    const errorTrapFailure = await capturedError(
      executeEnvelope({
        ...currentEnvelope,
        data: null,
        error: errorTrap,
        success: false,
        status: 409,
        statusText: 'Conflict'
      })
    )
    expect(errorTrapFailure).toMatchObject({ code: 'invalid-result' })
    expect(String(errorTrapFailure)).not.toContain('sb_secret_error_trap_must_not_leak')

    let rpcCalls = 0
    const parameterTrap = new Proxy(parameters, {
      ownKeys() {
        throw new Error('sb_secret_parameter_trap_must_not_leak')
      }
    })
    const parameterFailure = await capturedError(
      executeOpenPencilAtomicTransaction({
        supabase: {
          rpc() {
            rpcCalls += 1
            return Promise.resolve(currentEnvelope)
          }
        },
        parameters: parameterTrap
      })
    )
    expect(parameterFailure).toBeInstanceOf(TypeError)
    expect(parameterFailure).toMatchObject({
      message: 'Atomic transaction parameters must be an exact data-only object'
    })
    expect(String(parameterFailure)).not.toContain('sb_secret_parameter_trap_must_not_leak')
    expect(rpcCalls).toBe(0)

    const transparentParameterFailure = await capturedError(
      executeOpenPencilAtomicTransaction({
        supabase: {
          rpc() {
            rpcCalls += 1
            return Promise.resolve(currentEnvelope)
          }
        },
        parameters: new Proxy(parameters, {})
      })
    )
    expect(transparentParameterFailure).toBeInstanceOf(TypeError)
    expect(transparentParameterFailure).toMatchObject({
      message: 'Atomic transaction parameters must be an exact data-only object'
    })
    expect(rpcCalls).toBe(0)
  })

  test('fails closed on shapes outside the single owner UUID-PK update subset', () => {
    const optionalParameter = supabaseAtomicTransactionApplicationV2()
    required(
      optionalParameter.transactions.transactions[0].parameters.find(
        (entry) => entry.name === 'title'
      ),
      'Missing title parameter'
    ).required = false
    expect(createPlan(optionalParameter).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-atomic-parameters-invalid' })
      ])
    })

    const nonZeroVersionDefault = supabaseAtomicTransactionApplicationV2()
    required(
      nonZeroVersionDefault.dataModel.entities[0].fields.find(
        (entry) => entry.id === 'task-version'
      ),
      'Missing task version field'
    ).default = { kind: 'literal', value: 1 }
    expect(createPlan(nonZeroVersionDefault).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-atomic-version-control-invalid' })
      ])
    })

    const sharedPrimaryKeyOwner = supabaseAtomicTransactionApplicationV2()
    sharedPrimaryKeyOwner.auth.ownership[0].identityFieldId = 'task-id'
    expect(createPlan(sharedPrimaryKeyOwner).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-atomic-version-control-invalid' })
      ])
    })

    const arbitraryRead = supabaseAtomicTransactionApplicationV2()
    const read = arbitraryRead.transactions.transactions[0].steps[0]
    if (read.kind !== 'data.read' || !read.filters) throw new Error('Invalid atomic fixture')
    read.filters[0].operator = 'neq'
    expect(createPlan(arbitraryRead).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-atomic-read-shape-invalid' })
      ])
    })

    const nonUuidPrimaryKey = supabaseAtomicTransactionApplicationV2()
    const id = required(
      nonUuidPrimaryKey.dataModel.entities[0].fields.find((entry) => entry.id === 'task-id'),
      'Missing task id field'
    )
    id.type = 'string'
    delete id.default
    const taskIdParameter = required(
      nonUuidPrimaryKey.transactions.transactions[0].parameters.find(
        (entry) => entry.name === 'taskId'
      ),
      'Missing taskId parameter'
    )
    taskIdParameter.type = 'string'
    expect(createPlan(nonUuidPrimaryKey).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-atomic-primary-key-type-unsupported' })
      ])
    })

    const multipleEntities = supabaseAtomicTransactionApplicationV2()
    multipleEntities.dataModel.entities.push({
      id: 'notes',
      name: 'notes',
      management: 'managed',
      fields: [{ id: 'note-id', name: 'id', type: 'uuid', nullable: false }],
      primaryKey: { fields: ['note-id'] }
    })
    expect(createPlan(multipleEntities).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-atomic-entity-count-invalid' })
      ])
    })

    const generatedUpdate = supabaseAtomicTransactionApplicationV2()
    required(
      generatedUpdate.dataModel.entities[0].fields.find((entry) => entry.id === 'task-title'),
      'Missing task title field'
    ).default = { kind: 'generated', generator: 'uuid' }
    expect(createPlan(generatedUpdate).result.ok).toBe(false)

    const secretAndRetry = supabaseAtomicTransactionApplicationV2()
    secretAndRetry.secrets.push({
      kind: 'environment',
      name: 'ATOMIC_SERVER_SECRET',
      exposure: 'server',
      required: true
    })
    secretAndRetry.capabilities.push({ capability: 'workflows.retry', required: true })
    expect(createPlan(secretAndRetry).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'supabase-v2-atomic-secret-retry-authority-forbidden' })
      ])
    })

    const deleteMutation = supabaseAtomicTransactionApplicationV2()
    const mutation = deleteMutation.transactions.transactions[0].steps[2]
    if (mutation.kind !== 'data.mutate') throw new Error('Invalid atomic fixture')
    mutation.operation = 'delete'
    mutation.values = undefined
    mutation.increments = undefined
    expect(createPlan(deleteMutation).result.ok).toBe(false)

    const invalidIncrement = supabaseAtomicTransactionApplicationV2()
    const invalidIncrementMutation = invalidIncrement.transactions.transactions[0].steps[2]
    if (invalidIncrementMutation.kind !== 'data.mutate' || !invalidIncrementMutation.increments) {
      throw new Error('Invalid atomic fixture')
    }
    invalidIncrementMutation.increments[0].by = 2
    expect(createPlan(invalidIncrement).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-transaction-increment-invalid' })
      ])
    })

    const identifierInjection = supabaseAtomicTransactionApplicationV2()
    identifierInjection.dataModel.entities[0].name = 'tasks"; DROP TABLE auth.users; --'
    expect(createPlan(identifierInjection).result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'backend-identifier-invalid' })
      ])
    })
  })

  test('rejects standalone CRUD and non-owner principals at the Provider boundary', () => {
    const application = supabaseAtomicTransactionApplicationV2()
    application.transactions.transactions = []
    const context: BackendProviderAdapterContextV2 = {
      application,
      selection: supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2),
      target: 'react',
      mode: 'production',
      actualCapabilities: ['data.read', 'data.write'],
      capabilities: []
    }
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.data.validate(context)).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-atomic-data-standalone-forbidden' })
    )

    const nonOwner = supabaseAtomicTransactionApplicationV2()
    nonOwner.transactions.transactions[0].principal = { kind: 'authenticated' }
    const nonOwnerContext: BackendProviderAdapterContextV2 = {
      ...context,
      application: nonOwner,
      actualCapabilities: [
        'auth.identity',
        'data.read',
        'data.write',
        'migrations.schema',
        'policy.row-level',
        'transactions.atomic'
      ]
    }
    expect(
      SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.transactions.validate(nonOwnerContext)
    ).toContainEqual(
      expect.objectContaining({ code: 'supabase-v2-atomic-owner-principal-required' })
    )

    const unrelatedContext: BackendProviderAdapterContextV2 = {
      ...nonOwnerContext,
      application: supabaseAtomicTransactionApplicationV2(),
      actualCapabilities: [...nonOwnerContext.actualCapabilities, 'realtime.subscribe']
    }
    expect(
      SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.transactions.validate(unrelatedContext)
    ).toContainEqual(expect.objectContaining({ code: 'supabase-v2-atomic-capability-unsupported' }))
  })

  test('rejects recomputed transaction-plan tampering before artifact emission', () => {
    const planned = createPlan()
    expect(planned.result.ok).toBe(true)
    if (!planned.result.ok) return
    const tampered = structuredClone(planned.result.plan) as BackendProviderPlanV2 & {
      planDigest: string
      adapterPlans: { transactions: { tampered?: boolean } }
    }
    tampered.adapterPlans.transactions.tampered = true
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
