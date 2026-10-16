import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY,
  SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER,
  SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID,
  SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
  SUPABASE_BACKFILL_LIVE_CATALOG_SQL,
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogHostTransportV1,
  type SupabaseBackfillLiveCatalogRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import { createSupabaseDataAdmission } from '@/app/plugins/host/deployment/supabase/data-admission'

import { createBackfillCatalogSession } from './catalog-session'
import { prepareBackfillReadTransport, createBackfillAuthorityValidator } from './project-authority'
import { BACKFILL_CATALOG_REQUEST_KEYS, createBackfillQueryAdmission } from './query-admission'
import { createBackfillJSONRequester } from './read-response-runtime'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u

export const SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxProjectResponseBytes: 128 * 1024,
  maxCatalogResponseBytes: 512 * 1024,
  requestTimeoutMs: 30_000
})

export type SupabaseManagementBackfillLiveCatalogFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementBackfillLiveCatalogTransportErrorCode =
  | 'aborted'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'
  | 'timeout'

export class SupabaseManagementBackfillLiveCatalogTransportError extends Error {
  constructor(readonly code: SupabaseManagementBackfillLiveCatalogTransportErrorCode) {
    super(`Supabase Management backfill catalog transport failed: ${code}.`)
    this.name = 'SupabaseManagementBackfillLiveCatalogTransportError'
  }
}

export interface CreateSupabaseManagementBackfillLiveCatalogTransportOptions {
  /** Ephemeral runtime value. Create a new transport for every inspection operation. */
  readonly personalAccessToken: string
  /** Authority generation resolved atomically with this credential value by the Host vault. */
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly fetcher: SupabaseManagementBackfillLiveCatalogFetch
  readonly signal?: AbortSignal
  /** Tests and stricter hosts may shorten, but never extend, the fixed Host deadline. */
  readonly requestTimeoutMs?: number
}

export type SupabaseManagementBackfillLiveCatalogTransport =
  SupabaseBackfillLiveCatalogHostTransportV1

interface UnknownRecord {
  [key: string]: unknown
}

const REQUEST_KEYS = BACKFILL_CATALOG_REQUEST_KEYS

const dataAdmission = createSupabaseDataAdmission(fail)
const { plainRecord, ownData } = dataAdmission

const queryAdmission = createBackfillQueryAdmission(fail)

const { digest, identifier, boundedParameterText } = queryAdmission.stringParsers(
  DIGEST,
  IDENTIFIER,
  8_192
)

function fail(code: SupabaseManagementBackfillLiveCatalogTransportErrorCode): never {
  throw new SupabaseManagementBackfillLiveCatalogTransportError(code)
}

const validateAuthority = createBackfillAuthorityValidator(fail)

async function validatedQueryParameters(
  value: unknown,
  expectedAuthority: SupabaseBackfillLiveCatalogAuthorityV1
): Promise<readonly unknown[]> {
  const source = queryAdmission.requestMetadata(
    value,
    REQUEST_KEYS,
    SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID,
    SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION
  )

  const queryDigest = digest(ownData(source, 'queryDigest', 'invalid-request'))
  const subjectDigest = digest(ownData(source, 'subjectDigest', 'invalid-request'))
  if (queryDigest !== (await digestCanonicalManifest(SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY))) {
    return fail('invalid-request')
  }
  queryAdmission.authority(source, expectedAuthority)
  const parameters = plainRecord(
    ownData(source, 'parameters', 'invalid-request'),
    'invalid-request'
  )
  dataAdmission.exactKeys(
    parameters,
    SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER,
    'invalid-request'
  )
  const parsed = Object.freeze({
    ...queryAdmission.tableFields(parameters, identifier, boundedParameterText),
    cursorField: identifier(ownData(parameters, 'cursorField', 'invalid-request')),
    cursorMarker: boundedParameterText(ownData(parameters, 'cursorMarker', 'invalid-request')),
    primaryKeyMarker: boundedParameterText(
      ownData(parameters, 'primaryKeyMarker', 'invalid-request')
    ),
    targetField: identifier(ownData(parameters, 'targetField', 'invalid-request')),
    targetMarker: boundedParameterText(ownData(parameters, 'targetMarker', 'invalid-request')),
    ...queryAdmission.bindingFields(parameters, digest)
  })
  queryAdmission.validateBindings(
    parsed,
    expectedAuthority,
    SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
    { subjectDigest, queryDigest }
  )
  return Object.freeze(SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER.map((key) => parsed[key]))
}

const READ_ABORT_MESSAGE = 'Supabase backfill catalog request aborted'

const requestJSON = createBackfillJSONRequester({
  abortMessage: READ_ABORT_MESSAGE,
  timeoutMessage: 'Backfill catalog request timed out',
  ownsError: (cause) => cause instanceof SupabaseManagementBackfillLiveCatalogTransportError,
  fail
})

function parseSingleCatalogRow(value: unknown): UnknownRecord {
  return plainRecord(dataAdmission.singleItem(value, 'invalid-response'), 'invalid-response')
}

export function createSupabaseManagementBackfillLiveCatalogTransport(
  options: CreateSupabaseManagementBackfillLiveCatalogTransportOptions
): SupabaseBackfillLiveCatalogHostTransportV1 {
  const { boundAuthority, timeoutMs } = prepareBackfillReadTransport(
    options,
    SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS,
    fail
  )
  const session = createBackfillCatalogSession<SupabaseBackfillLiveCatalogRequestV1>(
    boundAuthority,
    options,
    timeoutMs,
    {
      requestJSON,
      validateAuthority: validateAuthority,
      validatedQueryParameters,
      parseRow: parseSingleCatalogRow,
      fail,
      sql: SUPABASE_BACKFILL_LIVE_CATALOG_SQL,
      maxProjectResponseBytes:
        SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxProjectResponseBytes,
      maxQueryResponseBytes:
        SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxCatalogResponseBytes
    }
  )
  return Object.freeze({
    getProjectAuthority: session.getProjectAuthority,
    runReadOnlyBackfillCatalogQuery: session.runQuery
  })
}
