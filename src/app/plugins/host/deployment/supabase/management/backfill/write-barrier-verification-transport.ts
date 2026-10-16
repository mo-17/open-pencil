import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL,
  type SupabaseBackfillWriteBarrierVerificationHostTransportV1,
  type SupabaseBackfillWriteBarrierVerificationRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/verifier'
import { createSupabaseDataAdmission } from '@/app/plugins/host/deployment/supabase/data-admission'

import { createBackfillCatalogSession } from './catalog-session'
import { prepareBackfillReadTransport, createBackfillAuthorityValidator } from './project-authority'
import { BACKFILL_CATALOG_REQUEST_KEYS, createBackfillQueryAdmission } from './query-admission'
import { createBackfillJSONRequester } from './read-response-runtime'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const OID = /^(?:0|[1-9][0-9]{0,9})$/u
const MAX_PARAMETER_TEXT_BYTES = 8_192
const MAX_ATTRIBUTE_NUMBER = 32_767

export const SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxProjectResponseBytes: 128 * 1024,
  maxVerificationResponseBytes: 512 * 1024,
  requestTimeoutMs: 30_000
})

export type SupabaseManagementBackfillWriteBarrierVerificationFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementBackfillWriteBarrierVerificationTransportErrorCode =
  | 'aborted'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'
  | 'timeout'

export class SupabaseManagementBackfillWriteBarrierVerificationTransportError extends Error {
  constructor(readonly code: SupabaseManagementBackfillWriteBarrierVerificationTransportErrorCode) {
    super(`Supabase Management backfill write-barrier verification transport failed: ${code}.`)
    this.name = 'SupabaseManagementBackfillWriteBarrierVerificationTransportError'
  }
}

export interface CreateSupabaseManagementBackfillWriteBarrierVerificationTransportOptions {
  /** Ephemeral runtime value. Create a new transport for every verification operation. */
  readonly personalAccessToken: string
  /** Authority generation resolved atomically with this credential value by the Host vault. */
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly fetcher: SupabaseManagementBackfillWriteBarrierVerificationFetch
  readonly signal?: AbortSignal
  /** Tests and stricter hosts may shorten, but never extend, the fixed Host deadline. */
  readonly requestTimeoutMs?: number
}

export type SupabaseManagementBackfillWriteBarrierVerificationTransport =
  SupabaseBackfillWriteBarrierVerificationHostTransportV1

interface UnknownRecord {
  [key: string]: unknown
}

const REQUEST_KEYS = Object.freeze([...BACKFILL_CATALOG_REQUEST_KEYS, 'reviewDigest'] as const)

const dataAdmission = createSupabaseDataAdmission(fail)
const { plainRecord, ownData } = dataAdmission

const queryAdmission = createBackfillQueryAdmission(fail)

const { digest, identifier, boundedParameterText } = queryAdmission.stringParsers(
  DIGEST,
  IDENTIFIER,
  MAX_PARAMETER_TEXT_BYTES
)

function fail(code: SupabaseManagementBackfillWriteBarrierVerificationTransportErrorCode): never {
  throw new SupabaseManagementBackfillWriteBarrierVerificationTransportError(code)
}

function oid(value: unknown): string {
  if (typeof value !== 'string' || !OID.test(value)) return fail('invalid-request')
  return value
}

function attributeNumber(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_ATTRIBUTE_NUMBER
  ) {
    return fail('invalid-request')
  }
  return value as number
}

const validateAuthority = createBackfillAuthorityValidator(fail)

async function validatedQueryParameters(
  value: unknown,
  expectedAuthority: SupabaseBackfillLiveCatalogAuthorityV1
): Promise<readonly unknown[]> {
  const source = queryAdmission.requestMetadata(
    value,
    REQUEST_KEYS,
    SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
    SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION
  )

  const queryDigest = digest(ownData(source, 'queryDigest', 'invalid-request'))
  const subjectDigest = digest(ownData(source, 'subjectDigest', 'invalid-request'))
  const reviewDigest = digest(ownData(source, 'reviewDigest', 'invalid-request'))
  if (
    queryDigest !==
    (await digestCanonicalManifest(SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY))
  ) {
    return fail('invalid-request')
  }
  queryAdmission.authority(source, expectedAuthority)

  const parameters = plainRecord(
    ownData(source, 'parameters', 'invalid-request'),
    'invalid-request'
  )
  dataAdmission.exactKeys(
    parameters,
    SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER,
    'invalid-request'
  )
  const parsed = Object.freeze({
    ...queryAdmission.tableFields(parameters, identifier, boundedParameterText),
    tableOid: oid(ownData(parameters, 'tableOid', 'invalid-request')),
    targetField: identifier(ownData(parameters, 'targetField', 'invalid-request')),
    targetMarker: boundedParameterText(ownData(parameters, 'targetMarker', 'invalid-request')),
    targetSubId: attributeNumber(ownData(parameters, 'targetSubId', 'invalid-request')),
    targetTypeOid: oid(ownData(parameters, 'targetTypeOid', 'invalid-request')),
    constraintName: identifier(ownData(parameters, 'constraintName', 'invalid-request')),
    barrierMarker: boundedParameterText(ownData(parameters, 'barrierMarker', 'invalid-request')),
    ...queryAdmission.bindingFields(parameters, digest, true)
  })
  queryAdmission.validateBindings(
    parsed,
    expectedAuthority,
    SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
    { subjectDigest, queryDigest, reviewDigest }
  )
  return Object.freeze(
    SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER.map((key) => parsed[key])
  )
}

const READ_ABORT_MESSAGE = 'Supabase backfill write-barrier verification aborted'

const requestJSON = createBackfillJSONRequester({
  abortMessage: READ_ABORT_MESSAGE,
  timeoutMessage: 'Backfill write-barrier verification timed out',
  ownsError: (cause) =>
    cause instanceof SupabaseManagementBackfillWriteBarrierVerificationTransportError,
  fail
})

function parseSingleVerificationRow(value: unknown): UnknownRecord {
  return plainRecord(dataAdmission.singleItem(value, 'invalid-response'), 'invalid-response')
}

export function createSupabaseManagementBackfillWriteBarrierVerificationTransport(
  options: CreateSupabaseManagementBackfillWriteBarrierVerificationTransportOptions
): SupabaseBackfillWriteBarrierVerificationHostTransportV1 {
  const { boundAuthority, timeoutMs } = prepareBackfillReadTransport(
    options,
    SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS,
    fail
  )
  const session = createBackfillCatalogSession<SupabaseBackfillWriteBarrierVerificationRequestV1>(
    boundAuthority,
    options,
    timeoutMs,
    {
      requestJSON,
      validateAuthority: validateAuthority,
      validatedQueryParameters,
      parseRow: parseSingleVerificationRow,
      fail,
      sql: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL,
      maxProjectResponseBytes:
        SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.maxProjectResponseBytes,
      maxQueryResponseBytes:
        SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.maxVerificationResponseBytes
    }
  )
  return Object.freeze({
    getProjectAuthority: session.getProjectAuthority,
    runReadOnlyWriteBarrierVerificationQuery: session.runQuery
  })
}
