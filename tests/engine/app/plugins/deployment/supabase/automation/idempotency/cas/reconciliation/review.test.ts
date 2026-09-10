/* eslint-disable max-lines -- focused suite audits the complete fixed review boundary */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  createBackendAutomationIdempotencyCASProposal,
  type BackendAutomationIdempotencyRecordV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL_COUNT,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_BYTE_LENGTH,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_DIGEST,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_SHA256_HEX,
  SupabaseAutomationIdempotencyCASReconciliationReviewError,
  createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1,
  renderSupabaseAutomationIdempotencyCASReconciliationSQLForTestingV1,
  trustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1,
  type SupabaseAutomationIdempotencyCASReconciliationReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/reconciliation/review'
import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA,
  createSupabaseAutomationIdempotencyCASReviewForTestingV1,
  trustedSupabaseAutomationIdempotencyCASReviewContextV1
} from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/review'

const KEY = 'abcde12345abcde12345'
const CREATED_AT = '2026-09-09T00:00:00.000Z'
const EXPIRES_AT = '2026-09-10T00:00:00.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function createCASReview() {
  const record: BackendAutomationIdempotencyRecordV1 = {
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: 1,
    automationId: 'automation-send-receipt',
    eventId: 'event-001',
    operationId: 'operation-001',
    idempotencyKeyDigest: await digest('idempotency-key'),
    causationId: 'causation-001',
    causationHop: 0,
    retentionHours: 24,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    recordedAt: CREATED_AT,
    revision: 0,
    previousRecordDigest: null,
    attemptIds: ['attempt-001'],
    currentAttemptId: 'attempt-001',
    state: 'reserved',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false
  }
  return createSupabaseAutomationIdempotencyCASReviewForTestingV1({
    applicationObjectKey: KEY,
    candidate: await createBackendAutomationIdempotencyCASProposal(null, record),
    currentRecord: null
  })
}

async function rawDigest(value: string): Promise<{ base64url: string; hex: string }> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  )
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    base64url: btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''),
    hex: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
}

async function expectError(
  operation: Promise<unknown> | (() => unknown),
  code: SupabaseAutomationIdempotencyCASReconciliationReviewErrorCode
): Promise<void> {
  try {
    if (typeof operation === 'function') operation()
    else await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseAutomationIdempotencyCASReconciliationReviewError)
    expect((cause as SupabaseAutomationIdempotencyCASReconciliationReviewError).code).toBe(code)
    return
  }
  throw new TypeError('Expected ' + code)
}

function casts() {
  return SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE.matchAll(
    /\$(\d+)::"pg_catalog"\."(text|int4|int8|bool)"(\[\])?/gu
  )
}

function expectedCast(pgType: string): string {
  switch (pgType) {
    case 'integer':
      return 'int4'
    case 'bigint':
      return 'int8'
    case 'boolean':
      return 'bool'
    case 'text[]':
      return 'text[]'
    default:
      return 'text'
  }
}

function expectedCasts(): string[] {
  return SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA.map(
    ({ position, pgType }) => String(position) + ':' + expectedCast(pgType)
  )
}

describe('Automation idempotency CAS reconciliation review', () => {
  test('reuses the immutable 27-value snapshot and creates no authority', async () => {
    const casReview = await createCASReview()
    const casContext = trustedSupabaseAutomationIdempotencyCASReviewContextV1(casReview)
    if (!casContext) throw new TypeError('Expected trusted CAS review.')
    const envelope = await createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1({
      casReview
    })
    const context = trustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1(envelope)
    if (!context) throw new TypeError('Expected trusted reconciliation review.')

    expect(context.parameters).toEqual(casContext.parameters)
    expect(context.parameters).not.toBe(casContext.parameters)
    expect(context.parameters[18]).not.toBe(casContext.parameters[18])
    expect(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER).toBe(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER
    )
    expect(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA).toBe(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA
    )
    expect(envelope.review).toMatchObject({
      testingOnly: true,
      reviewOnly: true,
      productionReachable: false,
      databaseLedgerBound: false,
      reconciliationAuthorityCreated: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      automaticRetryAllowed: false,
      releaseReady: false,
      query: {
        schemaName: 'op_automation_' + KEY,
        accessMode: 'read-only',
        snapshotScope: 'single-statement',
        statementCount: 1,
        responseShape: 'one-row-one-non-null-text-json-column',
        responseColumn: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN,
        responseFields: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS,
        dmlAllowed: false,
        ddlAllowed: false,
        callAllowed: false,
        rowLocksUsed: false,
        liveTransportCreated: false
      },
      policy: {
        absentProvesPriorMutationStopped: false,
        advancedHeadIsRelationalOnly: true,
        commitOutcomeResolved: false,
        databaseCASCommitted: false,
        automaticRetryAllowed: false,
        productionResponseAuthenticated: false
      }
    })
    expect(envelope.review.parameters.valueCount).toBe(27)
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(context.parameters)).toBe(true)
    expect(Object.isFrozen(context.parameters[18])).toBe(true)
    expect(
      trustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1({ ...envelope })
    ).toBeNull()
    expect(
      trustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1(
        structuredClone(envelope)
      )
    ).toBeNull()

    const publicJSON = JSON.stringify(envelope)
    for (const hidden of [1, 3, 4, 5, 6, 8, 19].map((index) => casContext.parameters[index])) {
      expect(publicJSON).not.toContain(String(hidden))
    }
  })

  test('pins raw SQL bytes, digest, sentinel, casts, and read-only boundaries', async () => {
    const sql = SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE
    const digests = await rawDigest(sql)
    expect(new TextEncoder().encode(sql).byteLength).toBe(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_BYTE_LENGTH
    )
    expect(digests.base64url).toBe(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_DIGEST
    )
    expect(digests.hex).toBe(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_SHA256_HEX
    )
    expect(
      sql.split(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL).length - 1
    ).toBe(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL_COUNT)
    expect(
      [...casts()].map((match) => String(Number(match[1])) + ':' + match[2] + (match[3] ?? ''))
    ).toEqual(expectedCasts())
    expect(sql).not.toContain('\\')
    expect(sql).not.toContain(String.fromCharCode(96))
    expect(sql).not.toContain(String.fromCharCode(36, 123))
    expect(sql.split(';')).toHaveLength(2)
    expect(sql).toContain(`current_setting"('transaction_read_only') = 'on'`)
    expect(sql).toContain(`current_setting"('row_security') = 'off'`)
    expect(sql).toContain(`current_setting"('session_replication_role') = 'origin'`)
    expect(sql).toContain(
      'FROM ONLY "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_heads"'
    )
    expect(sql).toContain(
      'FROM ONLY "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_revisions"'
    )
    for (const forbidden of ['FOR UPDATE', 'FOR SHARE', 'FOR KEY SHARE', 'FOR NO KEY UPDATE']) {
      expect(sql).not.toContain(forbidden)
    }
  })

  test('renders only a strict 20-character application key', async () => {
    const rendered = renderSupabaseAutomationIdempotencyCASReconciliationSQLForTestingV1(KEY)
    expect(rendered).toContain('"op_automation_' + KEY + '"')
    expect(rendered).not.toContain(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL
    )
    for (const invalid of [
      'abcde12345abcde1234',
      'abcde12345abcde123456',
      'ABCDE12345abcde12345',
      'abcde12345.abcde1234',
      'abcde12345/abcde1234',
      'abcde12345;drop12345'
    ]) {
      await expectError(
        () => renderSupabaseAutomationIdempotencyCASReconciliationSQLForTestingV1(invalid),
        'supabase-automation-idempotency-cas-reconciliation-input-invalid'
      )
    }
  })

  test('rejects copied proofs, accessors, proxies, and extra keys', async () => {
    const casReview = await createCASReview()
    for (const forged of [structuredClone(casReview), { ...casReview }]) {
      await expectError(
        createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1({
          casReview: forged
        }),
        'supabase-automation-idempotency-cas-reconciliation-proof-invalid'
      )
    }
    let calls = 0
    const accessor = {}
    Object.defineProperty(accessor, 'casReview', {
      enumerable: true,
      get() {
        calls += 1
        return casReview
      }
    })
    await expectError(
      createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1(accessor as never),
      'supabase-automation-idempotency-cas-reconciliation-input-invalid'
    )
    expect(calls).toBe(0)
    await expectError(
      createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1(
        new Proxy({ casReview }, {})
      ),
      'supabase-automation-idempotency-cas-reconciliation-input-invalid'
    )
    await expectError(
      createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1({
        casReview,
        extra: true
      } as never),
      'supabase-automation-idempotency-cas-reconciliation-input-invalid'
    )
  })

  test('has no production call site outside this dormant contract and private native kernel', async () => {
    const allowed = [
      'src/app/plugins/host/deployment/supabase/automation/idempotency/cas/reconciliation/',
      'desktop/src/backend_automation_idempotency_cas/reconciliation'
    ]
    const names = [
      'createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1',
      'parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1'
    ]
    const violations: string[] = []
    for (const root of ['src', 'packages', 'desktop', 'extensions']) {
      const glob = new Bun.Glob(root + '/**/*.{ts,tsx,vue,rs}')
      for await (const path of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
        if (allowed.some((prefix) => path.startsWith(prefix))) continue
        const source = await Bun.file(path).text()
        if (names.some((name) => source.includes(name))) violations.push(path)
      }
    }
    expect(violations).toEqual([])
  })
})
