import { DATA_MODEL_IR_VERSION, type BackendCapability } from '../types'
import { BACKEND_CAPABILITIES } from '../validate'
import type {
  BackendReleaseApplySnapshotV1,
  BackendReleaseAuthorityV1,
  BackendReleasePlanV1,
  BackendReleaseProviderAuthorityV1,
  BackendReleaseStalenessIssue,
  BackendReleaseStaleField
} from './types'
import {
  releaseDigest,
  releaseIdentifier,
  releasePackageDigest,
  releaseText,
  exactArray,
  exactRecord,
  stringArray,
  stringValue,
  sortedUniqueIntegers,
  sortedUniqueStrings
} from './validation'

const ENVIRONMENTS = new Set(['preview', 'staging', 'production'])
const BACKEND_PROVIDER_CONTRACT_VERSION = 1 as const
const PROVIDER_CAPABILITIES = new Set<BackendCapability>(BACKEND_CAPABILITIES)
const PROVIDER_OUTPUT_KINDS = new Set([
  'client-config',
  'database-schema',
  'deployment-manifest',
  'migration-plan',
  'security-policy',
  'server-runtime'
])

function knownProviderStrings(
  values: readonly string[],
  path: string,
  allowed: ReadonlySet<string>
): string[] {
  const normalized = sortedUniqueStrings(values, path)
  if (normalized.length === 0 || normalized.some((value) => !allowed.has(value))) {
    throw new TypeError(`${path} must contain only supported contract v1 values`)
  }
  return normalized
}

export function normalizeBackendReleaseProviderAuthority(
  value: BackendReleaseProviderAuthorityV1
): BackendReleaseProviderAuthorityV1 {
  if (value.contractVersion !== BACKEND_PROVIDER_CONTRACT_VERSION) {
    throw new TypeError('authority.backendProvider.contractVersion is not supported')
  }
  const permissions = sortedUniqueStrings(
    value.permissions,
    'authority.backendProvider.permissions'
  )
  if (permissions.length > 0) {
    throw new TypeError('Backend Provider contractVersion 1 does not grant permissions')
  }
  const supportedModelVersions = sortedUniqueIntegers(
    value.supportedModelVersions,
    'authority.backendProvider.supportedModelVersions'
  )
  if (supportedModelVersions.length !== 1 || supportedModelVersions[0] !== DATA_MODEL_IR_VERSION) {
    throw new TypeError('authority.backendProvider.supportedModelVersions is not supported')
  }
  return {
    publisherId: releaseIdentifier(value.publisherId, 'authority.backendProvider.publisherId'),
    packageDigest: releasePackageDigest(
      value.packageDigest,
      'authority.backendProvider.packageDigest'
    ),
    pluginId: releaseIdentifier(value.pluginId, 'authority.backendProvider.pluginId'),
    contributionId: releaseIdentifier(
      value.contributionId,
      'authority.backendProvider.contributionId'
    ),
    providerId: releaseIdentifier(value.providerId, 'authority.backendProvider.providerId'),
    adapterId: releaseIdentifier(value.adapterId, 'authority.backendProvider.adapterId'),
    adapterVersion: releaseText(
      value.adapterVersion,
      'authority.backendProvider.adapterVersion',
      64
    ),
    contractVersion: BACKEND_PROVIDER_CONTRACT_VERSION,
    supportedModelVersions,
    capabilities: knownProviderStrings(
      value.capabilities,
      'authority.backendProvider.capabilities',
      PROVIDER_CAPABILITIES
    ),
    permissions,
    outputKinds: knownProviderStrings(
      value.outputKinds,
      'authority.backendProvider.outputKinds',
      PROVIDER_OUTPUT_KINDS
    )
  }
}

export function parseBackendReleaseProviderAuthority(
  value: unknown,
  path = '$.backendProvider'
): BackendReleaseProviderAuthorityV1 {
  const source = exactRecord(value, path, [
    'publisherId',
    'packageDigest',
    'pluginId',
    'contributionId',
    'providerId',
    'adapterId',
    'adapterVersion',
    'contractVersion',
    'supportedModelVersions',
    'capabilities',
    'permissions',
    'outputKinds'
  ])
  if (!Number.isSafeInteger(source.contractVersion)) {
    throw new TypeError(`${path}.contractVersion must be an integer`)
  }
  const rawModelVersions = exactArray(
    source.supportedModelVersions,
    `${path}.supportedModelVersions`
  )
  const supportedModelVersions = sortedUniqueIntegers(
    rawModelVersions.map((entry) => {
      if (typeof entry !== 'number') {
        throw new TypeError(`${path}.supportedModelVersions must contain numbers`)
      }
      return entry
    }),
    `${path}.supportedModelVersions`
  )
  return normalizeBackendReleaseProviderAuthority({
    publisherId: stringValue(source.publisherId, `${path}.publisherId`),
    packageDigest: releasePackageDigest(
      stringValue(source.packageDigest, `${path}.packageDigest`),
      `${path}.packageDigest`
    ),
    pluginId: stringValue(source.pluginId, `${path}.pluginId`),
    contributionId: stringValue(source.contributionId, `${path}.contributionId`),
    providerId: stringValue(source.providerId, `${path}.providerId`),
    adapterId: stringValue(source.adapterId, `${path}.adapterId`),
    adapterVersion: stringValue(source.adapterVersion, `${path}.adapterVersion`, 64),
    contractVersion: source.contractVersion as number,
    supportedModelVersions,
    capabilities: stringArray(source.capabilities, `${path}.capabilities`),
    permissions: stringArray(source.permissions, `${path}.permissions`),
    outputKinds: stringArray(source.outputKinds, `${path}.outputKinds`)
  })
}

export function normalizeBackendReleaseAuthority(
  value: BackendReleaseAuthorityV1
): BackendReleaseAuthorityV1 {
  if (!ENVIRONMENTS.has(value.environment)) {
    throw new TypeError('authority.environment is not supported')
  }
  return {
    documentDigest: releaseDigest(value.documentDigest, 'authority.documentDigest'),
    irDigest: releaseDigest(value.irDigest, 'authority.irDigest'),
    inspectedSchemaDigest: releaseDigest(
      value.inspectedSchemaDigest,
      'authority.inspectedSchemaDigest'
    ),
    compilerVersion: releaseText(value.compilerVersion, 'authority.compilerVersion', 64),
    target: releaseIdentifier(value.target, 'authority.target'),
    environment: value.environment,
    projectId: releaseIdentifier(value.projectId, 'authority.projectId'),
    accountId: releaseIdentifier(value.accountId, 'authority.accountId'),
    grantGeneration: releaseIdentifier(value.grantGeneration, 'authority.grantGeneration'),
    backendProvider: normalizeBackendReleaseProviderAuthority(value.backendProvider)
  }
}

export function parseBackendReleaseAuthority(
  value: unknown,
  path = '$.authority'
): BackendReleaseAuthorityV1 {
  const source = exactRecord(value, path, [
    'documentDigest',
    'irDigest',
    'inspectedSchemaDigest',
    'compilerVersion',
    'target',
    'environment',
    'projectId',
    'accountId',
    'grantGeneration',
    'backendProvider'
  ])
  if (
    source.environment !== 'preview' &&
    source.environment !== 'staging' &&
    source.environment !== 'production'
  ) {
    throw new TypeError(`${path}.environment is not supported`)
  }
  return normalizeBackendReleaseAuthority({
    documentDigest: releaseDigest(
      stringValue(source.documentDigest, `${path}.documentDigest`),
      `${path}.documentDigest`
    ),
    irDigest: releaseDigest(stringValue(source.irDigest, `${path}.irDigest`), `${path}.irDigest`),
    inspectedSchemaDigest: releaseDigest(
      stringValue(source.inspectedSchemaDigest, `${path}.inspectedSchemaDigest`),
      `${path}.inspectedSchemaDigest`
    ),
    compilerVersion: stringValue(source.compilerVersion, `${path}.compilerVersion`, 64),
    target: stringValue(source.target, `${path}.target`),
    environment: source.environment,
    projectId: stringValue(source.projectId, `${path}.projectId`),
    accountId: stringValue(source.accountId, `${path}.accountId`),
    grantGeneration: stringValue(source.grantGeneration, `${path}.grantGeneration`),
    backendProvider: parseBackendReleaseProviderAuthority(
      source.backendProvider,
      `${path}.backendProvider`
    )
  })
}

function sameArray(
  left: readonly string[] | readonly number[],
  right: readonly string[] | readonly number[]
) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function stale(field: BackendReleaseStaleField): BackendReleaseStalenessIssue {
  return {
    field,
    code: 'release-plan-stale',
    message: `The freshly inspected ${field} no longer matches the reviewed release plan.`
  }
}

export function compareBackendReleaseAuthority(
  expectedPlanDigest: string,
  expected: BackendReleaseAuthorityV1,
  observed: BackendReleaseApplySnapshotV1
): BackendReleaseStalenessIssue[] {
  const issues: BackendReleaseStalenessIssue[] = []
  const add = (field: BackendReleaseStaleField, matches: boolean) => {
    if (!matches) issues.push(stale(field))
  }
  add('planDigest', observed.planDigest === expectedPlanDigest)
  add('documentDigest', observed.authority.documentDigest === expected.documentDigest)
  add('irDigest', observed.authority.irDigest === expected.irDigest)
  add('schemaDigest', observed.authority.inspectedSchemaDigest === expected.inspectedSchemaDigest)
  add('compilerVersion', observed.authority.compilerVersion === expected.compilerVersion)
  add('target', observed.authority.target === expected.target)
  add('environment', observed.authority.environment === expected.environment)
  add('projectId', observed.authority.projectId === expected.projectId)
  add('accountId', observed.authority.accountId === expected.accountId)
  add('grantGeneration', observed.authority.grantGeneration === expected.grantGeneration)

  const left = expected.backendProvider
  const right = observed.authority.backendProvider
  add('publisherId', right.publisherId === left.publisherId)
  add('packageDigest', right.packageDigest === left.packageDigest)
  add('pluginId', right.pluginId === left.pluginId)
  add('contributionId', right.contributionId === left.contributionId)
  add('providerId', right.providerId === left.providerId)
  add('adapterId', right.adapterId === left.adapterId)
  add('adapterVersion', right.adapterVersion === left.adapterVersion)
  add('contractVersion', right.contractVersion === left.contractVersion)
  add(
    'supportedModelVersions',
    sameArray(right.supportedModelVersions, left.supportedModelVersions)
  )
  add('capabilities', sameArray(right.capabilities, left.capabilities))
  add('permissions', sameArray(right.permissions, left.permissions))
  add('outputKinds', sameArray(right.outputKinds, left.outputKinds))
  return issues
}

export function backendReleaseSingleFlightKey(plan: BackendReleasePlanV1): string {
  const { projectId, accountId, grantGeneration } = plan.authority
  return ['backend-release-v1', projectId, accountId, grantGeneration, plan.planDigest]
    .map((part) => encodeURIComponent(part))
    .join(':')
}
