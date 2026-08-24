import { PLUGIN_MANIFEST_LIMITS, PLUGIN_RUNTIME_CAPABILITIES } from '@open-pencil/plugin-contracts'
import {
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL
} from '@open-pencil/scene-graph'

import { MARKETPLACE_CONTROL_SCHEMA_VERSION } from './control-contract'
import {
  parseMarketplaceRuntimePresentation,
  type MarketplaceConnectorPresentationV1,
  type MarketplaceRuntimePresentationV1,
  type MarketplaceSubmissionPresentationV1
} from './presentation'
import {
  parsePositivePresentationInteger as positive,
  parsePresentationText as boundedText,
  parseSortedPresentationStrings as parseSortedSet
} from './presentation-parse'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseMarketplaceIdentity,
  parseMarketplaceReleaseCoordinate,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceSubmissionV1
} from './types'

export interface MarketplaceReadableSetDiffV1 {
  readonly before: readonly string[]
  readonly after: readonly string[]
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

export interface MarketplaceSubmissionRevisionIdentityV1 {
  readonly revision: number
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly listingDigest: string
  readonly runtimePackageDigest: string | null
}

export interface MarketplaceConnectorNetworkDiffV1 {
  readonly connectorId: string
  readonly beforeExists: boolean
  readonly afterExists: boolean
  readonly origins: MarketplaceReadableSetDiffV1
  readonly originTemplates: MarketplaceReadableSetDiffV1
  readonly methods: MarketplaceReadableSetDiffV1
}

export const MARKETPLACE_RUNTIME_DIFF_FIELDS = Object.freeze([
  'presence',
  'packageDigest',
  'artifactDigest',
  'byteLength',
  'kind',
  'abi',
  'capabilities',
  'limits.timeoutMs',
  'limits.maxInputBytes',
  'limits.maxOutputBytes',
  'limits.maxMemoryPages',
  'asset.mediaType',
  'asset.byteLength',
  'asset.digest',
  'executionStatus',
  'executionReason'
] as const)

export type MarketplaceRuntimeDiffFieldV1 = (typeof MARKETPLACE_RUNTIME_DIFF_FIELDS)[number]

export interface MarketplaceSubmissionRuntimeDiffV1 {
  readonly before: MarketplaceRuntimePresentationV1 | null
  readonly after: MarketplaceRuntimePresentationV1 | null
  readonly capabilities: MarketplaceReadableSetDiffV1
  readonly changedFields: readonly MarketplaceRuntimeDiffFieldV1[]
}

export interface MarketplaceSubmissionRevisionDiffV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly submissionId: string
  readonly publisherId: string
  readonly coordinate: MarketplaceReleaseCoordinateV1
  readonly from: MarketplaceSubmissionRevisionIdentityV1
  readonly to: MarketplaceSubmissionRevisionIdentityV1
  readonly permissions: MarketplaceReadableSetDiffV1
  readonly network: Readonly<{
    connectors: readonly MarketplaceConnectorNetworkDiffV1[]
  }>
  readonly runtime: MarketplaceSubmissionRuntimeDiffV1
}

const ROOT_KEYS = new Set([
  'schemaVersion',
  'submissionId',
  'publisherId',
  'coordinate',
  'from',
  'to',
  'permissions',
  'network',
  'runtime'
])
const IDENTITY_KEYS = new Set([
  'revision',
  'manifestDigest',
  'artifactDigest',
  'listingDigest',
  'runtimePackageDigest'
])
const SET_DIFF_KEYS = new Set(['before', 'after', 'added', 'removed'])
const NETWORK_KEYS = new Set(['connectors'])
const CONNECTOR_DIFF_KEYS = new Set([
  'connectorId',
  'beforeExists',
  'afterExists',
  'origins',
  'originTemplates',
  'methods'
])
const RUNTIME_DIFF_KEYS = new Set(['before', 'after', 'capabilities', 'changedFields'])
const RUNTIME_FIELDS = new Set<string>(MARKETPLACE_RUNTIME_DIFF_FIELDS)
const PERMISSIONS = new Set([
  'document.read',
  'document.selection.read',
  'document.variables.read',
  'file.save'
])
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const RUNTIME_CAPABILITIES = new Set<string>(PLUGIN_RUNTIME_CAPABILITIES)

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function supportedValue(allowed: ReadonlySet<string>) {
  return (value: unknown, path: string): string => {
    if (typeof value !== 'string' || !allowed.has(value)) {
      throw new TypeError(`${path} is not supported`)
    }
    return value
  }
}

function deriveSetDiff(
  beforeValue: readonly string[],
  afterValue: readonly string[]
): MarketplaceReadableSetDiffV1 {
  const before = Object.freeze([...new Set(beforeValue)].sort())
  const after = Object.freeze([...new Set(afterValue)].sort())
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return Object.freeze({
    before,
    after,
    added: Object.freeze(after.filter((value) => !beforeSet.has(value))),
    removed: Object.freeze(before.filter((value) => !afterSet.has(value)))
  })
}

function hasSetChanges(diff: MarketplaceReadableSetDiffV1): boolean {
  return diff.added.length > 0 || diff.removed.length > 0
}

function parseSetDiff(
  value: unknown,
  path: string,
  maximum: number,
  parse: (entry: unknown, path: string) => string = boundedText
): MarketplaceReadableSetDiffV1 {
  const source = parseExactManifestRecord(value, path, SET_DIFF_KEYS)
  const before = parseSortedSet(source.before, `${path}.before`, maximum, parse)
  const after = parseSortedSet(source.after, `${path}.after`, maximum, parse)
  const added = parseSortedSet(source.added, `${path}.added`, maximum, parse)
  const removed = parseSortedSet(source.removed, `${path}.removed`, maximum, parse)
  const expected = deriveSetDiff(before, after)
  if (!equalStrings(added, expected.added) || !equalStrings(removed, expected.removed)) {
    throw new TypeError(`${path} set diff is inconsistent`)
  }
  return Object.freeze({ before, after, added, removed })
}

function parseRevisionIdentity(
  value: unknown,
  path: string
): MarketplaceSubmissionRevisionIdentityV1 {
  const source = parseExactManifestRecord(value, path, IDENTITY_KEYS)
  return Object.freeze({
    revision: positive(source.revision, `${path}.revision`),
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    listingDigest: parseSha256Base64URL(source.listingDigest, `${path}.listingDigest`),
    runtimePackageDigest:
      source.runtimePackageDigest === null
        ? null
        : parseSha256Base64URL(source.runtimePackageDigest, `${path}.runtimePackageDigest`)
  })
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be boolean`)
  return value
}

function parseConnectorNetworkDiff(
  value: unknown,
  path: string
): MarketplaceConnectorNetworkDiffV1 {
  const source = parseExactManifestRecord(value, path, CONNECTOR_DIFF_KEYS)
  const beforeExists = booleanValue(source.beforeExists, `${path}.beforeExists`)
  const afterExists = booleanValue(source.afterExists, `${path}.afterExists`)
  if (!beforeExists && !afterExists) {
    throw new TypeError(`${path} must identify an existing connector revision`)
  }
  const origins = parseSetDiff(source.origins, `${path}.origins`, 64)
  const originTemplates = parseSetDiff(source.originTemplates, `${path}.originTemplates`, 64)
  const methods = parseSetDiff(source.methods, `${path}.methods`, 5, supportedValue(METHODS))
  if (
    (!beforeExists &&
      (origins.before.length > 0 ||
        originTemplates.before.length > 0 ||
        methods.before.length > 0)) ||
    (!afterExists &&
      (origins.after.length > 0 || originTemplates.after.length > 0 || methods.after.length > 0))
  ) {
    throw new TypeError(`${path} network values do not match connector presence`)
  }
  if (
    beforeExists === afterExists &&
    origins.added.length === 0 &&
    origins.removed.length === 0 &&
    originTemplates.added.length === 0 &&
    originTemplates.removed.length === 0 &&
    methods.added.length === 0 &&
    methods.removed.length === 0
  ) {
    throw new TypeError(`${path} must contain a readable network change`)
  }
  return Object.freeze({
    connectorId: parseMarketplaceIdentity(source.connectorId, `${path}.connectorId`),
    beforeExists,
    afterExists,
    origins,
    originTemplates,
    methods
  })
}

function runtimeChangedFields(
  before: MarketplaceRuntimePresentationV1 | null,
  after: MarketplaceRuntimePresentationV1 | null
): readonly MarketplaceRuntimeDiffFieldV1[] {
  if (!before || !after) {
    return before === after ? Object.freeze([]) : Object.freeze(['presence'])
  }
  const fields: MarketplaceRuntimeDiffFieldV1[] = []
  const changed = (field: MarketplaceRuntimeDiffFieldV1, left: unknown, right: unknown) => {
    if (left !== right) fields.push(field)
  }
  changed('packageDigest', before.packageDigest, after.packageDigest)
  changed('artifactDigest', before.artifactDigest, after.artifactDigest)
  changed('byteLength', before.byteLength, after.byteLength)
  changed('kind', before.kind, after.kind)
  changed('abi', before.abi, after.abi)
  if (!equalStrings(before.capabilities, after.capabilities)) fields.push('capabilities')
  changed('limits.timeoutMs', before.limits.timeoutMs, after.limits.timeoutMs)
  changed('limits.maxInputBytes', before.limits.maxInputBytes, after.limits.maxInputBytes)
  changed('limits.maxOutputBytes', before.limits.maxOutputBytes, after.limits.maxOutputBytes)
  changed('limits.maxMemoryPages', before.limits.maxMemoryPages, after.limits.maxMemoryPages)
  changed('asset.mediaType', before.asset.mediaType, after.asset.mediaType)
  changed('asset.byteLength', before.asset.byteLength, after.asset.byteLength)
  changed('asset.digest', before.asset.digest, after.asset.digest)
  changed('executionStatus', before.executionStatus, after.executionStatus)
  changed('executionReason', before.executionReason, after.executionReason)
  return Object.freeze(fields)
}

function parseRuntimeDiff(value: unknown, path: string): MarketplaceSubmissionRuntimeDiffV1 {
  const source = parseExactManifestRecord(value, path, RUNTIME_DIFF_KEYS)
  const before =
    source.before === null
      ? null
      : parseMarketplaceRuntimePresentation(source.before, `${path}.before`)
  const after =
    source.after === null
      ? null
      : parseMarketplaceRuntimePresentation(source.after, `${path}.after`)
  const capabilities = parseSetDiff(
    source.capabilities,
    `${path}.capabilities`,
    2,
    supportedValue(RUNTIME_CAPABILITIES)
  )
  if (
    !equalStrings(capabilities.before, before?.capabilities ?? []) ||
    !equalStrings(capabilities.after, after?.capabilities ?? [])
  ) {
    throw new TypeError(`${path}.capabilities do not match runtime metadata`)
  }
  const changedFields = parseSortedSet(
    source.changedFields,
    `${path}.changedFields`,
    MARKETPLACE_RUNTIME_DIFF_FIELDS.length,
    (entry, entryPath) => {
      if (typeof entry !== 'string' || !RUNTIME_FIELDS.has(entry)) {
        throw new TypeError(`${entryPath} is not supported`)
      }
      return entry
    }
  ) as readonly MarketplaceRuntimeDiffFieldV1[]
  const expectedFields = runtimeChangedFields(before, after)
  if (!equalStrings(changedFields, [...expectedFields].sort())) {
    throw new TypeError(`${path}.changedFields do not match runtime metadata`)
  }
  return Object.freeze({ before, after, capabilities, changedFields })
}

function revisionIdentity(
  submission: MarketplaceSubmissionV1
): MarketplaceSubmissionRevisionIdentityV1 {
  return Object.freeze({
    revision: submission.revision,
    manifestDigest: submission.manifestDigest,
    artifactDigest: submission.artifactDigest,
    listingDigest: submission.listingDigest,
    runtimePackageDigest: submission.runtimeCoordinate?.packageDigest ?? null
  })
}

function connectorNetworkDiffs(
  before: readonly MarketplaceConnectorPresentationV1[],
  after: readonly MarketplaceConnectorPresentationV1[]
): readonly MarketplaceConnectorNetworkDiffV1[] {
  const beforeById = new Map(before.map((connector) => [connector.connectorId, connector]))
  const afterById = new Map(after.map((connector) => [connector.connectorId, connector]))
  const connectorIds = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort()
  return Object.freeze(
    connectorIds.flatMap((connectorId) => {
      const previous = beforeById.get(connectorId)
      const next = afterById.get(connectorId)
      const origins = deriveSetDiff(previous?.origins ?? [], next?.origins ?? [])
      const originTemplates = deriveSetDiff(
        previous?.originTemplates ?? [],
        next?.originTemplates ?? []
      )
      const methods = deriveSetDiff(previous?.methods ?? [], next?.methods ?? [])
      const changed =
        !previous ||
        !next ||
        hasSetChanges(origins) ||
        hasSetChanges(originTemplates) ||
        hasSetChanges(methods)
      return changed
        ? [
            Object.freeze({
              connectorId,
              beforeExists: previous !== undefined,
              afterExists: next !== undefined,
              origins,
              originTemplates,
              methods
            })
          ]
        : []
    })
  )
}

export function createMarketplaceSubmissionRevisionDiff(
  fromSubmission: MarketplaceSubmissionV1,
  toSubmission: MarketplaceSubmissionV1,
  fromPresentation: MarketplaceSubmissionPresentationV1,
  toPresentation: MarketplaceSubmissionPresentationV1
): MarketplaceSubmissionRevisionDiffV1 {
  const coordinateKey = (coordinate: MarketplaceReleaseCoordinateV1) =>
    `${coordinate.pluginId}@${coordinate.version}#${coordinate.channel}`
  if (
    fromSubmission.id !== toSubmission.id ||
    fromSubmission.publisherId !== toSubmission.publisherId ||
    coordinateKey(fromSubmission.coordinate) !== coordinateKey(toSubmission.coordinate) ||
    fromSubmission.revision >= toSubmission.revision ||
    fromPresentation.submissionId !== fromSubmission.id ||
    toPresentation.submissionId !== toSubmission.id ||
    fromPresentation.publisherId !== fromSubmission.publisherId ||
    toPresentation.publisherId !== toSubmission.publisherId ||
    fromPresentation.revision !== fromSubmission.revision ||
    toPresentation.revision !== toSubmission.revision ||
    coordinateKey(fromPresentation.coordinate) !== coordinateKey(fromSubmission.coordinate) ||
    coordinateKey(toPresentation.coordinate) !== coordinateKey(toSubmission.coordinate)
  ) {
    throw new TypeError('Submission revision diff inputs do not share one immutable coordinate')
  }
  return parseMarketplaceSubmissionRevisionDiff({
    schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
    submissionId: toSubmission.id,
    publisherId: toSubmission.publisherId,
    coordinate: toSubmission.coordinate,
    from: revisionIdentity(fromSubmission),
    to: revisionIdentity(toSubmission),
    permissions: deriveSetDiff(
      fromPresentation.manifest.permissions,
      toPresentation.manifest.permissions
    ),
    network: Object.freeze({
      connectors: connectorNetworkDiffs(
        fromPresentation.manifest.connectors,
        toPresentation.manifest.connectors
      )
    }),
    runtime: Object.freeze({
      before: fromPresentation.runtime,
      after: toPresentation.runtime,
      capabilities: deriveSetDiff(
        fromPresentation.runtime?.capabilities ?? [],
        toPresentation.runtime?.capabilities ?? []
      ),
      changedFields: Object.freeze(
        [...runtimeChangedFields(fromPresentation.runtime, toPresentation.runtime)].sort()
      )
    })
  })
}

export function parseMarketplaceSubmissionRevisionDiff(
  value: unknown,
  path = 'marketplaceControl.submissionRevisionDiff'
): MarketplaceSubmissionRevisionDiffV1 {
  const source = parseExactManifestRecord(value, path, ROOT_KEYS)
  if (source.schemaVersion !== MARKETPLACE_CONTROL_SCHEMA_VERSION) {
    throw new TypeError(`${path}.schemaVersion is not supported`)
  }
  const submissionId = parseMarketplaceIdentity(source.submissionId, `${path}.submissionId`)
  const publisherId = parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`)
  const coordinate = parseMarketplaceReleaseCoordinate(source.coordinate, `${path}.coordinate`)
  if (!MARKETPLACE_RELEASE_CHANNELS.includes(coordinate.channel)) {
    throw new TypeError(`${path}.coordinate.channel is not supported`)
  }
  const from = parseRevisionIdentity(source.from, `${path}.from`)
  const to = parseRevisionIdentity(source.to, `${path}.to`)
  if (from.revision >= to.revision) {
    throw new TypeError(`${path} must compare an older revision to a newer revision`)
  }
  const permissions = parseSetDiff(
    source.permissions,
    `${path}.permissions`,
    PERMISSIONS.size,
    supportedValue(PERMISSIONS)
  )
  const networkSource = parseExactManifestRecord(source.network, `${path}.network`, NETWORK_KEYS)
  const connectors = parseBoundedManifestArray(
    networkSource.connectors,
    `${path}.network.connectors`,
    PLUGIN_MANIFEST_LIMITS.maxConnectors
  ).map((entry, index) => parseConnectorNetworkDiff(entry, `${path}.network.connectors[${index}]`))
  if (
    connectors.some((connector, index) => {
      return index > 0 && connectors[index - 1].connectorId >= connector.connectorId
    })
  ) {
    throw new TypeError(`${path}.network.connectors must be sorted and unique`)
  }
  const runtime = parseRuntimeDiff(source.runtime, `${path}.runtime`)
  if (
    from.runtimePackageDigest !== (runtime.before?.packageDigest ?? null) ||
    to.runtimePackageDigest !== (runtime.after?.packageDigest ?? null)
  ) {
    throw new TypeError(`${path}.runtime does not match revision identity`)
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
    submissionId,
    publisherId,
    coordinate,
    from,
    to,
    permissions,
    network: Object.freeze({ connectors: Object.freeze(connectors) }),
    runtime
  })
}
