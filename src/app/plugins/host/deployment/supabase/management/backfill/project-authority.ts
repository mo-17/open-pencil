import type {
  SupabaseBackfillLiveCatalogAuthorityV1,
  SupabaseBackfillLiveCatalogProjectAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import { createSupabaseDataAdmission } from '@/app/plugins/host/deployment/supabase/data-admission'

import { isSupabaseManagementToken, supabaseManagementTimeout } from '../transport-runtime'

type AuthorityError = 'invalid-request' | 'invalid-response' | 'invalid-authority'
type AuthorityFailure = (code: AuthorityError) => never

const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

export function createBackfillAuthorityValidator(fail: AuthorityFailure) {
  return (value: unknown) => validateBackfillReadAuthority(value, fail)
}

export function prepareBackfillReadTransport(
  options: {
    readonly authority: unknown
    readonly personalAccessToken: unknown
    readonly fetcher: unknown
    readonly requestTimeoutMs?: unknown
  },
  limits: { readonly maxPATBytes: number; readonly requestTimeoutMs: number },
  fail: (code: 'invalid-authority') => never
) {
  if (!isSupabaseManagementToken(options.personalAccessToken, limits.maxPATBytes))
    fail('invalid-authority')
  if (typeof options.fetcher !== 'function') fail('invalid-authority')
  let boundAuthority: SupabaseBackfillLiveCatalogAuthorityV1
  try {
    boundAuthority = validateBackfillReadAuthority(options.authority, () =>
      fail('invalid-authority')
    )
  } catch {
    return fail('invalid-authority')
  }
  return {
    boundAuthority,
    timeoutMs: supabaseManagementTimeout(options.requestTimeoutMs, limits.requestTimeoutMs, () =>
      fail('invalid-authority')
    )
  }
}

export function sameBackfillReadAuthority(
  left: SupabaseBackfillLiveCatalogAuthorityV1,
  right: SupabaseBackfillLiveCatalogAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

export function validateBackfillReadAuthority(
  value: unknown,
  fail: AuthorityFailure
): SupabaseBackfillLiveCatalogAuthorityV1 {
  const { plainRecord, ownData, ownKeys } = createSupabaseDataAdmission(fail)
  const source = plainRecord(value, 'invalid-request')
  const keys = ownKeys(source, 'invalid-request')
  const expected = ['projectRef', 'accountId', 'grantGeneration']
  if (
    keys.length !== expected.length ||
    !keys.every((key) => typeof key === 'string' && expected.includes(key))
  ) {
    return fail('invalid-request')
  }
  const projectRef = ownData(source, 'projectRef', 'invalid-request')
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef))
    return fail('invalid-request')
  const identifier = (candidate: unknown): string => {
    if (typeof candidate !== 'string' || !STABLE_ID.test(candidate)) return fail('invalid-request')
    return candidate
  }
  return Object.freeze({
    projectRef,
    accountId: identifier(ownData(source, 'accountId', 'invalid-request')),
    grantGeneration: identifier(ownData(source, 'grantGeneration', 'invalid-request'))
  })
}

export function readBackfillProjectAuthority(
  value: unknown,
  expected: SupabaseBackfillLiveCatalogAuthorityV1,
  fail: AuthorityFailure
): SupabaseBackfillLiveCatalogProjectAuthorityV1 {
  const { plainRecord, ownData } = createSupabaseDataAdmission(fail)
  const project = plainRecord(value, 'invalid-response')
  const ref = ownData(project, 'ref', 'invalid-response')
  const accountId = ownData(project, 'organization_id', 'invalid-response')
  if (ref !== expected.projectRef || accountId !== expected.accountId)
    return fail('invalid-authority')
  return Object.freeze({
    projectRef: expected.projectRef,
    organizationId: expected.accountId,
    grantGeneration: expected.grantGeneration
  })
}
