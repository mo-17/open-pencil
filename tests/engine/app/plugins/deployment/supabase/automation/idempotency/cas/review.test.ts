/* eslint-disable max-lines -- one focused suite covers the full immutable review boundary */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  canonicalBackendAutomationIdempotencyCASProposalBytes,
  canonicalBackendAutomationIdempotencyRecordBytes,
  createBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  type BackendAutomationIdempotencyCASCandidateV1,
  type BackendAutomationIdempotencyRecordV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createSupabaseAutomationIdempotencyCASReviewForTestingV1,
  renderSupabaseAutomationIdempotencyCASSQLForTestingV1,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL_COUNT,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE,
  SupabaseAutomationIdempotencyCASReviewError,
  trustedSupabaseAutomationIdempotencyCASReviewContextV1
} from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/review'

const APPLICATION_OBJECT_KEY = 'abcde12345abcde12345'
const CREATED_AT = '2026-09-09T00:00:00.000Z'
const EXPIRES_AT = '2026-09-10T00:00:00.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function initialRecord(): Promise<BackendAutomationIdempotencyRecordV1> {
  return {
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
}

async function successorRecord(
  previous: BackendAutomationIdempotencyRecordV1
): Promise<BackendAutomationIdempotencyRecordV1> {
  return {
    ...previous,
    recordedAt: '2026-09-09T00:00:01.000Z',
    revision: 1,
    previousRecordDigest: await digestBackendAutomationIdempotencyRecord(previous),
    state: 'dispatch-started'
  }
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function rawTextDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let binary = ''
  for (const byte of digestBytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) expectDeepFrozen(descriptor.value, seen)
  }
}

async function candidateAndRecord(): Promise<{
  candidate: BackendAutomationIdempotencyCASCandidateV1
  record: BackendAutomationIdempotencyRecordV1
}> {
  const record = await initialRecord()
  return { candidate: await createBackendAutomationIdempotencyCASProposal(null, record), record }
}

describe('Supabase Backend Automation idempotency CAS review', () => {
  test('reviews valid initial and successor proposals without creating authority', async () => {
    const initial = await initialRecord()
    const initialCandidate = await createBackendAutomationIdempotencyCASProposal(null, initial)
    const initialReview = await createSupabaseAutomationIdempotencyCASReviewForTestingV1({
      applicationObjectKey: APPLICATION_OBJECT_KEY,
      candidate: initialCandidate,
      currentRecord: null
    })
    const successor = await successorRecord(initial)
    const successorCandidate = await createBackendAutomationIdempotencyCASProposal(
      initial,
      successor
    )
    const successorReview = await createSupabaseAutomationIdempotencyCASReviewForTestingV1({
      applicationObjectKey: APPLICATION_OBJECT_KEY,
      candidate: successorCandidate,
      currentRecord: initial
    })

    expect(initialReview.review).toMatchObject({
      testingOnly: true,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      productionReachable: false,
      databaseLedgerBound: false,
      operationAuthorityAuthenticated: false,
      hostEvidenceAuthenticated: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      persistenceAuthorityGranted: false,
      dispatchAuthorityGranted: false,
      queueRunnerWired: false,
      transaction: {
        schemaName: `op_automation_${APPLICATION_OBJECT_KEY}`,
        isolation: 'serializable',
        statementCount: 1,
        finalStates: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES
      },
      policy: {
        callerSqlAccepted: false,
        callerSchemaAccepted: false,
        managementTransportCreated: false,
        requestDispatched: false,
        mutationDispatched: false,
        databaseCASCommitted: false,
        automaticRetryAllowed: false
      }
    })
    expect(initialReview.review.bindings.currentRecordDigest).toBeNull()
    expect(successorReview.review.bindings.currentRecordDigest).toBe(
      await digestBackendAutomationIdempotencyRecord(initial)
    )
    const successorContext = trustedSupabaseAutomationIdempotencyCASReviewContextV1(successorReview)
    if (successorContext === null) throw new Error('Expected a trusted successor CAS context.')
    const expectedHeadDigest = await digestBackendAutomationIdempotencyRecord(initial)
    expect(successorContext.parameters.slice(14, 18)).toEqual([
      1,
      0,
      expectedHeadDigest,
      expectedHeadDigest
    ])
    expectDeepFrozen(initialReview)
    expectDeepFrozen(successorReview)
  })

  test('binds all 27 values in exact order while exposing only schema and digests', async () => {
    const { candidate } = await candidateAndRecord()
    const envelope = await createSupabaseAutomationIdempotencyCASReviewForTestingV1({
      applicationObjectKey: APPLICATION_OBJECT_KEY,
      candidate,
      currentRecord: null
    })
    const context = trustedSupabaseAutomationIdempotencyCASReviewContextV1(envelope)
    expect(context).not.toBeNull()
    if (!context) throw new Error('Expected a trusted CAS review context.')
    const values = context.parameters

    expect(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA.map(({ name }) => name)).toEqual(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER
    )
    expect(values).toHaveLength(27)
    expect(values).toEqual([
      await digestBackendAutomationIdempotencyCASProposal(candidate.proposal),
      expect.any(String),
      candidate.recordDigest,
      expect.any(String),
      candidate.record.automationId,
      candidate.record.eventId,
      candidate.record.operationId,
      candidate.record.idempotencyKeyDigest,
      candidate.record.causationId,
      candidate.record.causationHop,
      candidate.record.retentionHours,
      candidate.record.createdAt,
      candidate.record.expiresAt,
      candidate.record.recordedAt,
      0,
      null,
      null,
      null,
      ['attempt-001'],
      'attempt-001',
      'reserved',
      null,
      null,
      null,
      false,
      false,
      false
    ])
    expect(decodeBase64(values[1] as string)).toEqual(
      canonicalBackendAutomationIdempotencyCASProposalBytes(candidate.proposal)
    )
    expect(decodeBase64(values[3] as string)).toEqual(
      canonicalBackendAutomationIdempotencyRecordBytes(candidate.record)
    )
    expect(envelope.review.bindings.parameterValuesDigest).toBe(
      await digestCanonicalManifest({
        format: 'openpencil.supabase-automation-idempotency-cas-parameters.v1',
        version: 1,
        order: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
        values
      })
    )
    expect(envelope.review.artifact.digest).toBe(await rawTextDigest(envelope.previewSql))
    expect(envelope.review.artifact.byteLength).toBe(
      new TextEncoder().encode(envelope.previewSql).byteLength
    )
    const publicReview = JSON.stringify(envelope)
    for (const hiddenValue of [
      values[1],
      values[3],
      candidate.record.automationId,
      candidate.record.eventId,
      candidate.record.operationId,
      candidate.record.idempotencyKeyDigest,
      candidate.record.causationId,
      candidate.record.currentAttemptId
    ]) {
      expect(publicReview).not.toContain(String(hiddenValue))
    }
    expectDeepFrozen(context)
    expect(
      trustedSupabaseAutomationIdempotencyCASReviewContextV1(structuredClone(envelope))
    ).toBeNull()
    expect(trustedSupabaseAutomationIdempotencyCASReviewContextV1({ ...envelope })).toBeNull()
  })

  test('snapshots before the first await and rejects accessors and transparent proxies', async () => {
    const { candidate } = await candidateAndRecord()
    const mutableCandidate = structuredClone(candidate)
    const mutableInput = {
      applicationObjectKey: APPLICATION_OBJECT_KEY,
      candidate: mutableCandidate,
      currentRecord: null
    }
    const pending = createSupabaseAutomationIdempotencyCASReviewForTestingV1(mutableInput)
    mutableInput.applicationObjectKey = 'zzzzz99999zzzzz99999'
    Reflect.set(mutableCandidate.record, 'automationId', 'automation-mutated')
    Reflect.set(mutableCandidate.proposal, 'automationId', 'automation-mutated')
    const envelope = await pending
    const context = trustedSupabaseAutomationIdempotencyCASReviewContextV1(envelope)
    expect(envelope.review.transaction.schemaName).toBe(`op_automation_${APPLICATION_OBJECT_KEY}`)
    expect(context?.candidate.record.automationId).toBe('automation-send-receipt')

    let getterCalls = 0
    const accessorRecord = { ...structuredClone(candidate.record) }
    Object.defineProperty(accessorRecord, 'automationId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'automation-send-receipt'
      }
    })
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate: { ...candidate, record: accessorRecord as never },
        currentRecord: null
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
    expect(getterCalls).toBe(0)

    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate: { ...candidate, record: new Proxy(candidate.record, {}) },
        currentRecord: null
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate: new Proxy(candidate, {}),
        currentRecord: null
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate: { ...candidate, proposal: new Proxy(candidate.proposal, {}) },
        currentRecord: null
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1(
        new Proxy(
          {
            applicationObjectKey: APPLICATION_OBJECT_KEY,
            candidate,
            currentRecord: null
          },
          {}
        )
      )
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)

    const successor = await successorRecord(candidate.record)
    const successorCandidate = await createBackendAutomationIdempotencyCASProposal(
      candidate.record,
      successor
    )
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate: successorCandidate,
        currentRecord: new Proxy(candidate.record, {})
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
  })

  test('rejects mismatched CAS inputs and snapshots successor mutable state', async () => {
    const initial = await initialRecord()
    const successor = await successorRecord(initial)
    const candidate = await createBackendAutomationIdempotencyCASProposal(initial, successor)
    const mutableCurrent = structuredClone(initial)
    const mutableCandidate = structuredClone(candidate)
    const mutatedRecordDigest = await digest('mutated-record-digest')
    const pending = createSupabaseAutomationIdempotencyCASReviewForTestingV1({
      applicationObjectKey: APPLICATION_OBJECT_KEY,
      candidate: mutableCandidate,
      currentRecord: mutableCurrent
    })
    Reflect.set(mutableCurrent.attemptIds, 0, 'attempt-mutated-current')
    Reflect.set(mutableCandidate.record.attemptIds, 0, 'attempt-mutated-next')
    Reflect.set(mutableCandidate, 'recordDigest', mutatedRecordDigest)
    const envelope = await pending
    const context = trustedSupabaseAutomationIdempotencyCASReviewContextV1(envelope)
    expect(context?.currentRecord?.attemptIds).toEqual(['attempt-001'])
    expect(context?.candidate.record.attemptIds).toEqual(['attempt-001'])
    expect(context?.candidate.recordDigest).toBe(candidate.recordDigest)

    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate,
        currentRecord: null
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate: { ...candidate, recordDigest: await digest('tampered-record-digest') },
        currentRecord: initial
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)

    const invalidProposal = {
      ...candidate.proposal,
      expectedRevision: null,
      expectedHeadDigest: candidate.proposal.expectedHeadDigest
    }
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate: { ...candidate, proposal: invalidProposal },
        currentRecord: initial
      })
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
  })

  test('renders only the fixed schema token and keeps one fixed parameterized statement', async () => {
    const sql = renderSupabaseAutomationIdempotencyCASSQLForTestingV1(APPLICATION_OBJECT_KEY)
    const placeholderCasts = [...sql.matchAll(/\$(\d+)::"pg_catalog"\."([^"]+)"(\[\])?/gu)].map(
      (match) => ({
        position: Number(match[1]),
        pgType: String(match[2]) + (match[3] ?? '')
      })
    )
    const expectedCastTypes = SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA.map(
      ({ position, pgType }) => {
        let sqlType: string = pgType
        if (pgType === 'bigint') sqlType = 'int8'
        if (pgType === 'integer') sqlType = 'int4'
        if (pgType === 'boolean') sqlType = 'bool'
        return { position, pgType: sqlType }
      }
    )

    expect(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE).toContain(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL
    )
    expect(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE.split(
        SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL
      )
    ).toHaveLength(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL_COUNT + 1)
    expect(sql).not.toContain(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL)
    expect(sql).toContain(`op_automation_${APPLICATION_OBJECT_KEY}`)
    expect(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE).not.toContain('\\')
    expect(placeholderCasts).toEqual(expectedCastTypes)
    expect(sql.match(/;/gu) ?? []).toHaveLength(1)
    expect(sql.trimEnd().endsWith(';')).toBe(true)
    for (const status of SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES) {
      expect(sql).toContain(`'${status}'`)
    }
    expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK)\b/iu)
    expect(sql).not.toMatch(/^\s*(?:EXECUTE|CALL|COPY)\b/imu)

    for (const requiredInputGuard of [
      '"expected_canonical_proposal_text"',
      '"expected_canonical_record_text"',
      '"pg_catalog"."sha256"("canonical_proposal")',
      '"pg_catalog"."sha256"("canonical_record")',
      '"previous_record_digest" IS NOT DISTINCT FROM "expected_head_digest"',
      '"pg_catalog"."array_ndims"("attempt_ids") = 1',
      '"host_evidence_authenticated" IS FALSE',
      '"persistence_authority_granted" IS FALSE',
      '"dispatch_authority_granted" IS FALSE'
    ]) {
      expect(sql).toContain(requiredInputGuard)
    }
    for (const requiredRuntimeGuard of [
      '"pg_catalog"."current_setting"(\'transaction_isolation\') = \'serializable\'',
      '"pg_catalog"."current_setting"(\'transaction_read_only\') = \'off\'',
      '"pg_catalog"."current_setting"(\'row_security\') = \'off\'',
      '"pg_catalog"."current_setting"(\'search_path\') = \'pg_catalog\'',
      '"pg_catalog"."current_setting"(\'session_replication_role\') = \'origin\'',
      '"pg_catalog"."current_setting"(\'synchronous_commit\') = \'on\'',
      '"pg_catalog"."current_setting"(\'server_encoding\') = \'UTF8\'',
      '"pg_catalog"."current_setting"(\'statement_timeout\')',
      '"pg_catalog"."current_setting"(\'lock_timeout\')',
      'CURRENT_USER = SESSION_USER',
      '"pg_catalog"."pg_is_in_recovery"()'
    ]) {
      expect(sql).toContain(requiredRuntimeGuard)
    }
    for (const requiredCatalogGuard of [
      '"expected_columns"',
      '"expected_constraints"',
      '"expected_indexes"',
      "'idempotency_revisions_previous_fkey'",
      "'idempotency_heads_revision_fkey'",
      "'idempotency_revisions_attempt_reservation_uidx'",
      "'idempotency_revisions_immutable'",
      '"actual"."connoinherit" IS DISTINCT FROM "expected"."no_inherit"',
      '"pg_catalog"."pg_get_constraintdef"("actual"."oid", FALSE)',
      '"pg_catalog"."unnest"("actual"."indkey")',
      '"pg_catalog"."pg_get_indexdef"("index_relation"."oid")',
      '"actual"."attcollation" IS DISTINCT FROM CASE "expected"."type_name"',
      '"default_collation"."collisdeterministic"',
      'FROM "pg_catalog"."pg_rewrite" AS "rewrite_rule"',
      'FROM "pg_catalog"."pg_policy" AS "row_policy"',
      'FROM "pg_catalog"."pg_publication" AS "publication"',
      'FROM "pg_catalog"."pg_publication_rel" AS "published_relation"',
      'FROM "pg_catalog"."pg_publication_namespace" AS "published_schema"',
      '"publication"."puballtables"',
      '"pg_catalog"."pg_has_role"(',
      '"guard_function"."prosrc" = (',
      '"guard_function"."probin" IS NULL',
      '"guard_function"."prosqlbody" IS NULL',
      '"guard_trigger"."tgqual" IS NULL',
      '"guard_trigger"."tgnargs" = 0',
      '"ledger_trigger"."tgisinternal"',
      '"pg_catalog"."aclexplode"',
      '"pg_catalog"."has_column_privilege"',
      "'anon'",
      "'authenticated'",
      "'authenticator'",
      "'service' || '_role'"
    ]) {
      expect(sql).toContain(requiredCatalogGuard)
    }
    expect(sql).not.toContain('"actual"."indkey"::"pg_catalog"."int2"[]')
    expect(sql).not.toContain('COALESCE(\n          "ledger_column"."attacl",\n          ARRAY[]')
    expect(sql.match(/\$openpencil_constraint\$/gu) ?? []).toHaveLength(36)
    expect(sql.match(/'CREATE (?:UNIQUE )?INDEX /gu) ?? []).toHaveLength(6)
    expect(sql).toContain(
      '"pg_catalog"."obj_description"("actual"."oid", \'pg_constraint\')\n          IS DISTINCT FROM'
    )
    expect(sql).toContain(
      '"pg_catalog"."obj_description"("index_relation"."oid", \'pg_class\')\n          IS DISTINCT FROM'
    )
    for (const requiredExactIndexGuard of [
      '"index_relation"."relowner" IS DISTINCT FROM "objects"."current_role_oid"',
      '"index_access_method"."amname" = \'btree\'',
      '"actual"."indnullsnotdistinct"',
      '"actual"."indnkeyatts" <> "pg_catalog"."cardinality"("expected"."key_columns")',
      '"actual"."indexprs" IS NOT NULL'
    ]) {
      expect(sql).toContain(requiredExactIndexGuard)
    }

    const headLock = sql.indexOf('FOR UPDATE OF "head" NOWAIT')
    const revisionLock = sql.indexOf('FOR SHARE OF "revision_row" NOWAIT')
    expect(headLock).toBeGreaterThan(-1)
    expect(revisionLock).toBeGreaterThan(headLock)
    expect(sql).toContain('"candidate_digest_match" IS TRUE')
    expect(sql).toContain('"candidate_exact" IS NOT TRUE')
    expect(sql).toContain('WHERE "pre_state"."state" IN (\'write-initial\', \'write-successor\')')
    expect(sql.match(/\bINSERT INTO\b/gu) ?? []).toHaveLength(2)
    expect(sql.match(/^  UPDATE$/gmu) ?? []).toHaveLength(1)
    expect(sql).toContain('1 / CASE')

    for (const headColumn of [
      'automation_id',
      'idempotency_key_digest',
      'current_revision',
      'current_head_digest',
      'current_event_id',
      'current_operation_id',
      'current_causation_id',
      'current_causation_hop',
      'current_attempt_id',
      'current_attempt_ordinal',
      'current_state',
      'current_retry_fence',
      'current_recorded_at',
      'retention_expires_at'
    ]) {
      expect(sql).toMatch(
        new RegExp(
          '"head"\\."' +
            headColumn +
            '"\\s+IS NOT DISTINCT FROM "expected_head"\\."' +
            headColumn +
            '"',
          'u'
        )
      )
    }

    const { candidate } = await candidateAndRecord()
    await expect(
      createSupabaseAutomationIdempotencyCASReviewForTestingV1({
        applicationObjectKey: APPLICATION_OBJECT_KEY,
        candidate,
        currentRecord: null,
        sql: 'SELECT attacker_controlled()'
      } as never)
    ).rejects.toBeInstanceOf(SupabaseAutomationIdempotencyCASReviewError)
    expect(() => renderSupabaseAutomationIdempotencyCASSQLForTestingV1('invalid')).toThrow()
  })
})
