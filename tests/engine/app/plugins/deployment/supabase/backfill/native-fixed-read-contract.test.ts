/* oxlint-disable eslint(max-lines) -- One contract matrix keeps fixed vectors, embedded V2 documents, and fail-closed parsing together. */

import { describe, expect, test } from 'bun:test'

import { containsBackendSecretLikeMaterial } from '@open-pencil/lowcode/backend'
import {
  canonicalManifestBytes,
  digestCanonicalManifest,
  encodeBase64URL
} from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS,
  SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1,
  SUPABASE_BACKFILL_NATIVE_FIXED_READ_REQUEST_FORMAT,
  SUPABASE_BACKFILL_NATIVE_FIXED_READ_RESULT_FORMAT,
  SupabaseBackfillNativeFixedReadContractError,
  createSupabaseBackfillNativeFixedReadRequestV1,
  createSupabaseBackfillNativeFixedReadResultV1,
  parseSupabaseBackfillNativeFixedReadRequestV1,
  parseSupabaseBackfillNativeFixedReadResultV1,
  type SupabaseBackfillNativeFixedReadBindingsV1,
  type SupabaseBackfillNativeFixedReadRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/native-fixed-read-contract'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_SCHEMA
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/review'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/review'

const DIGEST_A = 'A'.repeat(43)
const DIGEST_B = `${'B'.repeat(42)}A`
const SCOPE_DIGEST = 'LibNiuZSjgQl-XXIdFe_cPFbxXJ6IvbYmXT5szY5jqU'
const RECEIPT_DIGEST = 'pT8FSWqT2VWEAHDrpaX8gnnspoYIkaS97sSPnOeFGdg'
const PARAMETER_VALUES_DIGEST = 'MrcqUPBL6cHFrAgJM3FVpD4jSCJEqdB2urZVvSFXL4c'
const REQUEST_DIGEST = 'KffEdAmqSCyEz1gEp5ICefkGg857kQHTn39IOpXMSJs'
const REQUEST_JSON_BYTES = 9_449
const REQUEST_DIGEST_ENVELOPE_BYTES = 9_487

const RECEIPT_ZERO_SCOPE = Object.freeze({
  format: 'openpencil.backend-backfill-execution-scope',
  version: 2,
  providerId: 'supabase',
  environment: 'staging',
  providerAuthorityDigest: DIGEST_A,
  applicationId: 'application-1',
  applicationDigest: DIGEST_A,
  migrationId: 'migration-1',
  migrationDigest: DIGEST_A,
  migrationPlanDigest: DIGEST_A,
  sourceLedgerDigest: DIGEST_A,
  captureDigest: DIGEST_A,
  receiptZeroEvidenceDigest: DIGEST_A,
  resourceIdentityDigest: DIGEST_A,
  catalogPreconditionDigest: DIGEST_A,
  entityId: 'tasks',
  cursorField: 'id',
  cursorFieldType: 'integer',
  targetField: 'completed_at',
  batchSize: 100,
  maximumReceiptCount: 10_000,
  maximumBatchCount: 9_999,
  capturedHighWater: 42,
  initialRemainingEligibleRowCount: 10,
  initialRemainingTargetRowCount: 10,
  requiredBatchCount: 1,
  requiredMatchedRowCount: null,
  resumePolicy: 'from-receipt',
  completionRule: 'predicate-exhausted-and-postconditions-satisfied'
})

const RECEIPT_ZERO_RECEIPT = Object.freeze({
  format: 'openpencil.backend-backfill-execution-receipt',
  version: 2,
  receiptId: 'receipt-1',
  executionId: 'execution-1',
  idempotencyKey: 'idempotency-1',
  requestDigest: DIGEST_A,
  scope: RECEIPT_ZERO_SCOPE,
  scopeDigest: SCOPE_DIGEST,
  checkpointKind: 'capture',
  batchIndex: 0,
  previousCursor: null,
  lastProcessedKey: null,
  batchCounts: Object.freeze({ scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 }),
  cumulativeCounts: Object.freeze({ scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 }),
  exhaustion: Object.freeze({
    checked: true,
    remainingEligibleRowCount: 10,
    remainingTargetRowCount: 10
  }),
  postconditions: Object.freeze({
    fieldNotNull: false,
    requiredMatchedRowCount: null,
    matchedRowCountSatisfied: true
  }),
  outcome: 'in-progress',
  terminalReason: null,
  stableErrorCode: null,
  previousReceiptDigest: null,
  catalogEvidenceDigest: DIGEST_A,
  operationAuthorityDigest: DIGEST_A,
  databaseEventId: 'event-1',
  databaseHeadVersion: 1,
  committedAt: '2026-09-08T00:00:00.000Z',
  evidenceDigest: DIGEST_A
})

function standardBase64(bytes: Uint8Array): string {
  const unpadded = encodeBase64URL(bytes).replaceAll('-', '+').replaceAll('_', '/')
  return `${unpadded}${'='.repeat((4 - (unpadded.length % 4)) % 4)}`
}

function canonicalBase64(value: unknown): string {
  return standardBase64(canonicalManifestBytes(value))
}

async function bindings(
  values: readonly (string | null)[] = parameters()
): Promise<SupabaseBackfillNativeFixedReadBindingsV1> {
  return {
    reconciliationReviewDigest: DIGEST_A,
    staticSqlSafetyCertificateDigest: DIGEST_A,
    reconciliationSqlDigest: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlDigest,
    reconciliationQueryDigest: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.queryDigest,
    queryContractDigest: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.queryContractDigest,
    analysisProfileDigest: DIGEST_A,
    parameterSchemaDigest: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.parameterSchemaDigest,
    parameterValuesDigest: await digestCanonicalManifest({
      format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1',
      version: 1,
      order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
      values
    }),
    parameterOrderDigest: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.parameterOrderDigest,
    responseFieldsDigest: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.responseFieldsDigest,
    ledgerShapeDigest: DIGEST_A,
    expectedColumnInventoryDigest: DIGEST_A,
    expectedConstraintInventoryDigest: DIGEST_A,
    scopeDigest: values[8] as string,
    receiptDigest: values[25] as string,
    candidateOperationEvidenceDigest: values[27] as string,
    historicalInstallMarkerDigest: DIGEST_A
  }
}

function parameters(): readonly (string | null)[] {
  return [
    'execution-1',
    'application-1',
    DIGEST_A,
    'migration-1',
    DIGEST_A,
    DIGEST_A,
    DIGEST_A,
    DIGEST_A,
    SCOPE_DIGEST,
    DIGEST_A,
    DIGEST_A,
    standardBase64(canonicalManifestBytes(RECEIPT_ZERO_SCOPE)),
    DIGEST_A,
    '42',
    '10',
    '10',
    null,
    '1',
    '100',
    'running',
    '2026-09-08T00:00:00.000Z',
    'event-1',
    'receipt-1',
    'idempotency-1',
    DIGEST_A,
    RECEIPT_DIGEST,
    standardBase64(canonicalManifestBytes(RECEIPT_ZERO_RECEIPT)),
    DIGEST_A
  ]
}

async function request(): Promise<SupabaseBackfillNativeFixedReadRequestV1> {
  const values = parameters()
  return createSupabaseBackfillNativeFixedReadRequestV1({
    bindings: await bindings(values),
    parameters: values
  })
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillNativeFixedReadContractError)
    return (cause as SupabaseBackfillNativeFixedReadContractError).code
  }
  throw new Error('Expected Native fixed-read contract failure.')
}

describe('Supabase backfill Native fixed-read TypeScript IPC contract', () => {
  test('matches the Native secret-prefix policy without case-variant bypasses', () => {
    for (const secret of [
      'sk_live_abcdef',
      'SK_LIVE_abc',
      'github_pat_abcdefgh',
      'GITHUB_PAT_ABCDEFGH',
      'ghp_abcdefgh',
      'GHP_abcdefgh',
      'xoxb-abcdefgh',
      'XOXB-ABCDEFGH',
      'sb_secret_abcdef',
      'SB_SECRET_ABCDEF'
    ]) {
      expect(containsBackendSecretLikeMaterial(secret)).toBe(true)
    }
    expect(containsBackendSecretLikeMaterial('018f47bb-4d9b-4f15-8c48-f8c8f8f0f0f0')).toBe(false)
    expect(containsBackendSecretLikeMaterial(DIGEST_A)).toBe(false)
  })

  test('pins every shared SQL and fixed-query identity used by the native contract', async () => {
    const sqlBytes = new TextEncoder().encode(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL)
    const sqlDigest = encodeBase64URL(
      new Uint8Array(await crypto.subtle.digest('SHA-256', sqlBytes))
    )
    const queryContract = {
      format: 'openpencil.supabase-backfill-read-query-contract.v1',
      version: 1,
      queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
      parameterOrder: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
      responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS
    }

    expect(sqlBytes).toHaveLength(SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlByteLength)
    expect(sqlDigest).toBe(SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlDigest)
    expect(
      await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY)
    ).toBe(SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.queryDigest)
    expect(await digestCanonicalManifest(queryContract)).toBe(
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.queryContractDigest
    )
    expect(await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER)).toBe(
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.parameterOrderDigest
    )
    expect(await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_SCHEMA)).toBe(
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.parameterSchemaDigest
    )
    expect(
      await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS)
    ).toBe(SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.responseFieldsDigest)
  })

  test('constructs a bounded contract-only request with fixed query identity and no authority', async () => {
    const value = await request()

    expect(value.format).toBe(SUPABASE_BACKFILL_NATIVE_FIXED_READ_REQUEST_FORMAT)
    expect(value.providerId).toBe('supabase')
    expect(value.environment).toBe('staging')
    expect(value.variant).toBe('receipt-zero-reconciliation')
    expect(value.query).toEqual({
      queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
      statementCount: 1,
      accessMode: 'read-only',
      snapshotScope: 'single-statement',
      sqlByteLength: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlByteLength,
      parameterCount: 28,
      parameterOrder: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
      responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
      rawSqlIncluded: false,
      endpointIncluded: false
    })
    expect(value.requirements).toEqual({
      configuredSearchPath: ['pg_catalog'],
      requiresTransportEnforcedReadOnlyBoundary: true,
      requiresLiveCatalogSemanticsAuthentication: true,
      serverStatementTimeoutMs: 15_000,
      maximumResponseBytes: SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.responseBytes
    })
    expect(value.parameters).toHaveLength(28)
    expect(Object.keys(value.bindings)).toHaveLength(17)
    expect(value.bindings.parameterValuesDigest).toBe(PARAMETER_VALUES_DIGEST)
    expect(value.requestDigest).toBe(REQUEST_DIGEST)
    expect(new TextEncoder().encode(JSON.stringify(value))).toHaveLength(REQUEST_JSON_BYTES)
    const { requestDigest: _requestDigest, ...withoutDigest } = value
    expect(
      canonicalManifestBytes({
        format: 'openpencil.supabase-backfill-native-fixed-read-request-digest.v1',
        version: 1,
        request: withoutDigest
      })
    ).toHaveLength(REQUEST_DIGEST_ENVELOPE_BYTES)
    expect(value).toMatchObject({
      contractOnly: true,
      nativeCommandRegistered: false,
      requestDispatched: false,
      productionTransportCreated: false,
      productionTransportAuthenticated: false,
      productionRequestDispatchAuthenticated: false,
      adapterAuthenticated: false,
      dynamicBindingsAuthenticated: false,
      readOnlyBoundaryAuthenticated: false,
      configuredSearchPathAuthenticated: false,
      liveCatalogSemanticsAuthenticated: false,
      serverStatementTimeoutAuthenticated: false,
      serverCancellationAuthenticated: false,
      singleStatementSnapshotAuthenticated: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })
    expect(value).not.toHaveProperty('sql')
    expect(value).not.toHaveProperty('url')
    expect(value).not.toHaveProperty('endpoint')
    expect(value).not.toHaveProperty('headers')
    expect(value).not.toHaveProperty('credential')
    expect(value).not.toHaveProperty('personalAccessToken')
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.bindings)).toBe(true)
    expect(Object.isFrozen(value.parameters)).toBe(true)
  })

  test('strictly parses a serialized request and rejects tampering or authority override keys', async () => {
    const original = await request()
    const serialized = structuredClone(original)
    const parsed = await parseSupabaseBackfillNativeFixedReadRequestV1(serialized)
    expect(parsed).toEqual(original)
    expect(parsed).not.toBe(serialized)

    const extraSql = { ...structuredClone(original), sql: 'select 1' }
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(extraSql))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
    const extraEndpoint = {
      ...structuredClone(original),
      endpoint: 'https://example.invalid'
    }
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(extraEndpoint))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
    const nestedHeader = {
      ...structuredClone(original),
      query: { ...structuredClone(original.query), headers: {} }
    }
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(nestedHeader))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
    const changedProvider = { ...structuredClone(original), providerId: 'postgres' }
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(changedProvider))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
    const changedBinding = structuredClone(original)
    changedBinding.bindings.scopeDigest = DIGEST_B
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(changedBinding))).toBe(
      'supabase-backfill-native-fixed-read-binding-mismatch'
    )
    const changedAuthority = { ...structuredClone(original), requestDispatched: true }
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(changedAuthority))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
  })

  test('binds all 28 parameters to the canonical Scope V2 and Receipt V2 documents', async () => {
    const replacements = [
      [0, 'execution-2'],
      [1, 'application-2'],
      [2, DIGEST_B],
      [3, 'migration-2'],
      [4, DIGEST_B],
      [5, DIGEST_B],
      [6, DIGEST_B],
      [7, DIGEST_B],
      [8, DIGEST_B],
      [9, DIGEST_B],
      [10, DIGEST_B],
      [12, DIGEST_B],
      [13, null],
      [14, '9'],
      [15, '9'],
      [16, '0'],
      [17, '2'],
      [18, '99'],
      [19, 'completed'],
      [20, '2026-09-08T00:00:00.001Z'],
      [21, 'event-2'],
      [22, 'receipt-2'],
      [23, 'idempotency-2'],
      [24, DIGEST_B],
      [25, DIGEST_B],
      [27, DIGEST_B]
    ] as const
    for (const [index, replacement] of replacements) {
      const changed = parameters().slice()
      changed[index] = replacement
      expect(
        await errorCode(
          createSupabaseBackfillNativeFixedReadRequestV1({
            bindings: await bindings(changed),
            parameters: changed
          })
        )
      ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')
    }

    const changedScope = parameters().slice()
    changedScope[11] = canonicalBase64({ ...RECEIPT_ZERO_SCOPE, applicationId: 'application-2' })
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: await bindings(changedScope),
          parameters: changedScope
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')

    const changedReceipt = parameters().slice()
    changedReceipt[26] = canonicalBase64({
      ...RECEIPT_ZERO_RECEIPT,
      databaseEventId: 'event-2'
    })
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: await bindings(changedReceipt),
          parameters: changedReceipt
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')

    const changedNestedScope = parameters().slice()
    changedNestedScope[26] = canonicalBase64({
      ...RECEIPT_ZERO_RECEIPT,
      scope: { ...RECEIPT_ZERO_SCOPE, applicationId: 'application-2' }
    })
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: await bindings(changedNestedScope),
          parameters: changedNestedScope
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')
  })

  test('rejects malformed, unsafe, or non-receipt-zero embedded V2 documents', async () => {
    for (const [index, document] of [
      [11, {}],
      [26, {}],
      [
        11,
        {
          ...RECEIPT_ZERO_SCOPE,
          applicationId: 'application\0forged'
        }
      ],
      [11, { ...RECEIPT_ZERO_SCOPE, applicationId: '\ud800' }],
      [11, { ...RECEIPT_ZERO_SCOPE, applicationId: '\udfff' }],
      [
        11,
        {
          ...RECEIPT_ZERO_SCOPE,
          capturedHighWater: Number.MAX_SAFE_INTEGER + 1
        }
      ],
      [11, { ...RECEIPT_ZERO_SCOPE, providerId: 'postgres' }],
      [11, { ...RECEIPT_ZERO_SCOPE, environment: 'production' }],
      [26, { ...RECEIPT_ZERO_RECEIPT, checkpointKind: 'batch' }],
      [
        26,
        {
          ...RECEIPT_ZERO_RECEIPT,
          batchCounts: { scannedRowCount: 1, matchedRowCount: 0, updatedRowCount: 0 }
        }
      ]
    ] as const) {
      const invalid = parameters().slice()
      invalid[index] = canonicalBase64(document)
      expect(
        await errorCode(
          createSupabaseBackfillNativeFixedReadRequestV1({
            bindings: await bindings(invalid),
            parameters: invalid
          })
        )
      ).toBe('supabase-backfill-native-fixed-read-request-invalid')
    }

    for (const [index, document] of [
      [11, RECEIPT_ZERO_SCOPE],
      [26, RECEIPT_ZERO_RECEIPT]
    ] as const) {
      const nonCanonical = parameters().slice()
      nonCanonical[index] = standardBase64(new TextEncoder().encode(JSON.stringify(document)))
      expect(
        await errorCode(
          createSupabaseBackfillNativeFixedReadRequestV1({
            bindings: await bindings(nonCanonical),
            parameters: nonCanonical
          })
        )
      ).toBe('supabase-backfill-native-fixed-read-request-invalid')
    }
  })

  test('rejects getters, hostile proxies, sparse arrays, reordered fields, and oversized parameters', async () => {
    const original = await request()
    const getter = { ...structuredClone(original) }
    Object.defineProperty(getter, 'providerId', {
      enumerable: true,
      get: () => 'supabase'
    })
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(getter))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )

    const throwingProxy = new Proxy(structuredClone(original), {
      ownKeys: () => {
        throw new Error('hostile')
      }
    })
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(throwingProxy))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
    const { proxy, revoke } = Proxy.revocable(structuredClone(original), {})
    revoke()
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(proxy))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )

    const sparse = structuredClone(original)
    sparse.parameters.pop()
    sparse.parameters.length = original.parameters.length
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(sparse))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
    const reordered = structuredClone(original)
    ;[reordered.query.parameterOrder[0], reordered.query.parameterOrder[1]] = [
      reordered.query.parameterOrder[1],
      reordered.query.parameterOrder[0]
    ]
    expect(await errorCode(parseSupabaseBackfillNativeFixedReadRequestV1(reordered))).toBe(
      'supabase-backfill-native-fixed-read-request-invalid'
    )
    const accessorParameter = parameters().slice()
    Object.defineProperty(accessorParameter, '0', { enumerable: true, get: () => 'forged' })
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: await bindings(),
          parameters: accessorParameter
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-request-invalid')

    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: { ...(await bindings()), parameterValuesDigest: DIGEST_A },
          parameters: parameters()
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')
    const boundary = parameters().slice()
    boundary[11] = canonicalBase64({ x: 'x'.repeat(65_528) })
    expect(new TextEncoder().encode(boundary[11]).byteLength).toBe(
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.parameterStringBytes
    )
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: await bindings(boundary),
          parameters: boundary
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-request-invalid')

    const oversized = parameters().slice()
    oversized[0] = 'x'.repeat(SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.parameterStringBytes + 1)
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: await bindings(),
          parameters: oversized
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-request-too-large')

    for (const loneSurrogate of ['\ud800', '\udfff']) {
      const invalidUTF16 = parameters().slice()
      invalidUTF16[0] = loneSurrogate
      expect(
        await errorCode(
          createSupabaseBackfillNativeFixedReadRequestV1({
            bindings: await bindings(invalidUTF16),
            parameters: invalidUTF16
          })
        )
      ).toBe('supabase-backfill-native-fixed-read-request-invalid')
    }
    for (const [index, invalid] of [
      [17, null],
      [14, '01'],
      [14, '9223372036854775808'],
      [17, '2147483648'],
      [2, 'B'.repeat(43)],
      [20, '2026-09-08T00:00:00Z'],
      [20, '+010000-09-08T00:00:00.000Z'],
      [11, 'eyJiIjoxLCJhIjoyfQ==']
    ] as const) {
      const invalidEncoding = parameters().slice()
      invalidEncoding[index] = invalid
      expect(
        await errorCode(
          createSupabaseBackfillNativeFixedReadRequestV1({
            bindings: await bindings(invalidEncoding),
            parameters: invalidEncoding
          })
        )
      ).toBe('supabase-backfill-native-fixed-read-request-invalid')
    }

    const maximumDatabaseIntegers = parameters().slice()
    maximumDatabaseIntegers[13] = '9223372036854775807'
    maximumDatabaseIntegers[14] = '9223372036854775807'
    maximumDatabaseIntegers[15] = '9223372036854775807'
    maximumDatabaseIntegers[16] = '9223372036854775807'
    maximumDatabaseIntegers[17] = '2147483647'
    maximumDatabaseIntegers[18] = '2147483647'
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadRequestV1({
          bindings: await bindings(maximumDatabaseIntegers),
          parameters: maximumDatabaseIntegers
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')
  })

  test('constructs and parses an untrusted result without authenticating production dispatch', async () => {
    const fixedRequest = await request()
    const responseBytes = [...new TextEncoder().encode('[{"queryVersion":"fixture"}]')]
    const result = await createSupabaseBackfillNativeFixedReadResultV1({
      request: fixedRequest,
      responseBytes
    })

    expect(result.format).toBe(SUPABASE_BACKFILL_NATIVE_FIXED_READ_RESULT_FORMAT)
    expect(result.requestDigest).toBe(fixedRequest.requestDigest)
    expect(result.responseBytes).toEqual(responseBytes)
    expect(result.responseByteLength).toBe(responseBytes.length)
    expect(result.responseDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(result.resultDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(result).toMatchObject({
      contractOnly: true,
      nativeCommandRegistered: false,
      productionRequestDispatchAuthenticated: false,
      productionTransportCreationAuthenticated: false,
      productionTransportAuthenticated: false,
      adapterAuthenticated: false,
      dynamicBindingsAuthenticated: false,
      readOnlyBoundaryAuthenticated: false,
      configuredSearchPathAuthenticated: false,
      liveCatalogSemanticsAuthenticated: false,
      serverStatementTimeoutAuthenticated: false,
      serverCancellationAuthenticated: false,
      singleStatementSnapshotAuthenticated: false,
      responseSnapshotAuthenticated: false,
      automaticRetryAllowed: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })

    const parsed = await parseSupabaseBackfillNativeFixedReadResultV1({
      request: structuredClone(fixedRequest),
      result: structuredClone(result)
    })
    expect(parsed).toEqual(result)
    expect(Object.isFrozen(parsed.responseBytes)).toBe(true)
  })

  test('rejects result rebinding, added authority, non-canonical bytes, tampering, and oversize', async () => {
    const fixedRequest = await request()
    const result = await createSupabaseBackfillNativeFixedReadResultV1({
      request: fixedRequest,
      responseBytes: [123, 125]
    })

    const otherRequest = await createSupabaseBackfillNativeFixedReadRequestV1({
      bindings: { ...(await bindings()), reconciliationReviewDigest: DIGEST_B },
      parameters: parameters()
    })
    expect(
      await errorCode(
        parseSupabaseBackfillNativeFixedReadResultV1({ request: otherRequest, result })
      )
    ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')

    const extraCredential = { ...structuredClone(result), credential: 'secret' }
    expect(
      await errorCode(
        parseSupabaseBackfillNativeFixedReadResultV1({
          request: fixedRequest,
          result: extraCredential
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-result-invalid')
    const forgedDispatch = {
      ...structuredClone(result),
      productionRequestDispatchAuthenticated: true
    }
    expect(
      await errorCode(
        parseSupabaseBackfillNativeFixedReadResultV1({
          request: fixedRequest,
          result: forgedDispatch
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-result-invalid')
    const changedBytes = structuredClone(result)
    changedBytes.responseBytes[0] = 91
    expect(
      await errorCode(
        parseSupabaseBackfillNativeFixedReadResultV1({
          request: fixedRequest,
          result: changedBytes
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-binding-mismatch')
    const floatByte = { ...structuredClone(result), responseBytes: [1.5] }
    expect(
      await errorCode(
        parseSupabaseBackfillNativeFixedReadResultV1({
          request: fixedRequest,
          result: floatByte
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-result-invalid')
    const sparseBytes = [1, 2]
    sparseBytes.pop()
    sparseBytes.length = 2
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadResultV1({
          request: fixedRequest,
          responseBytes: sparseBytes
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-result-invalid')
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadResultV1({
          request: fixedRequest,
          responseBytes: []
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-result-invalid')
    const oversizedBytes = Array.from(
      { length: SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.responseBytes + 1 },
      () => 0
    )
    expect(
      await errorCode(
        createSupabaseBackfillNativeFixedReadResultV1({
          request: fixedRequest,
          responseBytes: oversizedBytes
        })
      )
    ).toBe('supabase-backfill-native-fixed-read-response-too-large')
  })
})
