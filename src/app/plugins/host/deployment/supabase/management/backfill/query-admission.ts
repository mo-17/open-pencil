import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import { createSupabaseDataAdmission } from '@/app/plugins/host/deployment/supabase/data-admission'

type QueryRecord = Record<string, unknown>

export const BACKFILL_CATALOG_REQUEST_KEYS = Object.freeze([
  'queryId',
  'queryVersion',
  'queryDigest',
  'subjectDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'statementCount',
  'catalogOnly',
  'accessMode',
  'snapshotScope',
  'parameters'
] as const)

export function createBackfillQueryAdmission(fail: (code: 'invalid-request') => never) {
  const { ownData, plainRecord, exactKeys } = createSupabaseDataAdmission(fail)
  const invalid = 'invalid-request'

  function pattern(value: unknown, expression: RegExp): string {
    if (typeof value !== 'string' || !expression.test(value)) return fail(invalid)
    return value
  }

  function boundedText(value: unknown, maximum: number): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      new TextEncoder().encode(value).byteLength > maximum ||
      /\p{Cc}/u.test(value)
    )
      return fail(invalid)
    return value
  }

  function metadata(
    source: QueryRecord,
    queryId: string,
    queryVersion: string,
    managedDataRead?: false
  ): void {
    if (
      ownData(source, 'queryId', invalid) !== queryId ||
      ownData(source, 'queryVersion', invalid) !== queryVersion ||
      ownData(source, 'statementCount', invalid) !== 1 ||
      ownData(source, 'catalogOnly', invalid) !== true ||
      (managedDataRead === false && ownData(source, 'managedDataRead', invalid) !== false) ||
      ownData(source, 'accessMode', invalid) !== 'read-only' ||
      ownData(source, 'snapshotScope', invalid) !== 'single-statement'
    )
      return fail(invalid)
  }

  function requestMetadata(
    value: unknown,
    keys: readonly string[],
    queryId: string,
    queryVersion: string
  ) {
    const source = plainRecord(value, invalid)
    exactKeys(source, keys, invalid)
    metadata(source, queryId, queryVersion)
    return source
  }

  function authority(source: QueryRecord, expected: SupabaseBackfillLiveCatalogAuthorityV1): void {
    for (const key of ['projectRef', 'accountId', 'grantGeneration'] as const) {
      if (ownData(source, key, invalid) !== expected[key]) return fail(invalid)
    }
  }

  function bindingFields(
    source: QueryRecord,
    digest: (value: unknown) => string,
    withReview = false
  ) {
    return {
      subjectDigest: digest(ownData(source, 'subjectDigest', invalid)),
      ...(withReview ? { reviewDigest: digest(ownData(source, 'reviewDigest', invalid)) } : {}),
      projectRef: ownData(source, 'projectRef', invalid),
      accountId: ownData(source, 'accountId', invalid),
      grantGeneration: ownData(source, 'grantGeneration', invalid),
      queryVersion: ownData(source, 'queryVersion', invalid),
      queryDigest: digest(ownData(source, 'queryDigest', invalid))
    }
  }

  function stringParsers(digest: RegExp, identifier: RegExp, maximumTextBytes: number) {
    return {
      digest: (value: unknown) => pattern(value, digest),
      identifier: (value: unknown) => pattern(value, identifier),
      boundedParameterText: (value: unknown) => boundedText(value, maximumTextBytes)
    }
  }

  function tableFields(
    source: QueryRecord,
    identifier: (value: unknown) => string,
    text: (value: unknown) => string
  ) {
    return {
      schema: ownData(source, 'schema', invalid),
      table: identifier(ownData(source, 'table', invalid)),
      entityMarker: text(ownData(source, 'entityMarker', invalid))
    }
  }

  function validateBindings(
    parsed: ReturnType<typeof bindingFields> & { schema: unknown },
    expected: SupabaseBackfillLiveCatalogAuthorityV1,
    queryVersion: string,
    digests: { subjectDigest: string; queryDigest: string; reviewDigest?: string }
  ): void {
    if (
      parsed.schema !== 'public' ||
      parsed.subjectDigest !== digests.subjectDigest ||
      parsed.reviewDigest !== digests.reviewDigest ||
      parsed.projectRef !== expected.projectRef ||
      parsed.accountId !== expected.accountId ||
      parsed.grantGeneration !== expected.grantGeneration ||
      parsed.queryVersion !== queryVersion ||
      parsed.queryDigest !== digests.queryDigest
    )
      return fail(invalid)
  }

  return {
    pattern,
    boundedText,
    metadata,
    requestMetadata,
    authority,
    bindingFields,
    stringParsers,
    tableFields,
    validateBindings
  }
}
