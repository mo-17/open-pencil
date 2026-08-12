import {
  canonicalManifestJSON as canonicalJSON,
  canonicalManifestValue as canonicalValue,
  compareStableSemver as compareSemver,
  assertSignedManifestVerificationPolicy,
  createSignedManifestIntegrity,
  normalizeStableEngineRange,
  parseStableSemver,
  satisfiesStableEngineRange,
  stableSemverParts,
  verifySignedManifestIntegrity,
  type StableSemver as Semver
} from '../signed-manifest'
import { createMotionContractValidationHelpers } from './contract-validation'
import { parseMotionRecipe } from './recipe'
import { instantiateMotionRecipe } from './recipe/instantiate'
import type {
  MotionRecipe,
  MotionRecipeInstantiation,
  MotionRecipeInstantiationInput
} from './recipe/types'
import type { MotionSpec, MotionValidationIssue } from './types'
import {
  USER_MOTION_PRESET_FORMAT,
  USER_MOTION_PRESET_SCHEMA_VERSION,
  instantiateUserMotionPreset,
  parseUserMotionPresetLibrary,
  type UserMotionPreset
} from './user-presets'
import {
  assertMotionPortableValue,
  MotionIssueValidationError,
  parseMotionSourceReference
} from './validation-helpers'

export const TEAM_MOTION_LIBRARY_FORMAT = 'openpencil-team-motion-library' as const
export const TEAM_MOTION_LIBRARY_SCHEMA_VERSION = 1 as const
export const TEAM_MOTION_REGISTRY_STATE_VERSION = 1 as const

export const TEAM_MOTION_LIBRARY_LIMITS = Object.freeze({
  maxEntries: 128,
  maxTokens: 64,
  maxTokenBindings: 128,
  maxHistory: 8,
  maxJsonBytes: 4_194_304,
  maxNameLength: 128,
  maxReleaseNotesLength: 4_096,
  maxRangeLength: 128,
  maxSourceRefLength: 2_048,
  tokenValue: Object.freeze({ min: -1_000_000, max: 1_000_000 })
})

export interface TeamMotionIdentity {
  id: string
  name: string
}

export interface TeamMotionPublisher extends TeamMotionIdentity {
  keyId: string
}

export type TeamMotionLibrarySource = { kind: 'file'; ref: string } | { kind: 'url'; ref: string }

export interface TeamMotionNumberToken {
  id: string
  type: 'number'
  defaultValue: number
  min: number
  max: number
}

export interface TeamMotionTokenBinding {
  tokenId: string
  parameterId: string
}

export type TeamMotionLibraryEntry =
  | { kind: 'preset'; preset: UserMotionPreset }
  | { kind: 'recipe'; recipe: MotionRecipe; tokenBindings?: TeamMotionTokenBinding[] }

export interface TeamMotionLibraryPayload {
  format: typeof TEAM_MOTION_LIBRARY_FORMAT
  schemaVersion: typeof TEAM_MOTION_LIBRARY_SCHEMA_VERSION
  publisher: TeamMotionPublisher
  library: TeamMotionIdentity
  version: string
  engineRange: string
  source: TeamMotionLibrarySource
  releaseNotes?: string
  tokens?: TeamMotionNumberToken[]
  entries: TeamMotionLibraryEntry[]
}

export interface TeamMotionLibrarySignature {
  algorithm: 'Ed25519'
  keyId: string
  value: string
}

export interface TeamMotionLibraryIntegrity {
  algorithm: 'SHA-256'
  digest: string
  signature: TeamMotionLibrarySignature
}

export interface TeamMotionLibraryManifest extends TeamMotionLibraryPayload {
  integrity: TeamMotionLibraryIntegrity
}

export interface VerifiedTeamMotionLibrarySnapshot {
  manifest: TeamMotionLibraryManifest
  verifiedDigest: string
  verifiedKeyId: string
}

export interface TeamMotionLibraryDiff {
  fromVersion: string | null
  toVersion: string
  added: string[]
  removed: string[]
  updated: string[]
}

export interface TeamMotionLibraryReview {
  candidate: VerifiedTeamMotionLibrarySnapshot
  diff: TeamMotionLibraryDiff
  status: 'pending'
}

export interface TeamMotionLibraryRegistryState {
  version: typeof TEAM_MOTION_REGISTRY_STATE_VERSION
  accepted: VerifiedTeamMotionLibrarySnapshot
  history: VerifiedTeamMotionLibrarySnapshot[]
  pending?: TeamMotionLibraryReview
}

export type TeamMotionLibraryInstantiation =
  | { kind: 'preset'; entryId: string; motion: MotionSpec }
  | { kind: 'recipe'; entryId: string; result: MotionRecipeInstantiation }

export type TeamMotionLibraryValidationResult =
  | { success: true; value: TeamMotionLibraryManifest }
  | { success: false; issues: MotionValidationIssue[] }

export class TeamMotionLibraryValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'TeamMotionLibraryValidationError'
  }
}

const SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/

const { boundedNumber, invalid, plainRecord, required, safeId, strictRecord, text, uniqueIds } =
  createMotionContractValidationHelpers((issues) => new TeamMotionLibraryValidationError(issues))

function jsonByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertJSONSize(value: string, path = 'manifest'): void {
  if (jsonByteLength(value) > TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes) {
    invalid(
      path,
      'limit_exceeded',
      `Team Motion library JSON may not exceed ${TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes} bytes`
    )
  }
}

function identity(value: unknown, path: string): TeamMotionIdentity {
  const record = strictRecord(value, path, ['id', 'name'])
  return {
    id: safeId(required(record, 'id', path), `${path}.id`),
    name: text(
      required(record, 'name', path),
      `${path}.name`,
      1,
      TEAM_MOTION_LIBRARY_LIMITS.maxNameLength
    )
  }
}

function publisher(value: unknown, path: string): TeamMotionPublisher {
  const record = strictRecord(value, path, ['id', 'name', 'keyId'])
  return {
    id: safeId(required(record, 'id', path), `${path}.id`),
    name: text(
      required(record, 'name', path),
      `${path}.name`,
      1,
      TEAM_MOTION_LIBRARY_LIMITS.maxNameLength
    ),
    keyId: safeId(required(record, 'keyId', path), `${path}.keyId`)
  }
}

const semverInvalid = (path: string, message: string): never =>
  invalid(path, 'invalid_value', message)

function semver(value: unknown, path: string): string {
  return parseStableSemver(value, path, semverInvalid)
}

function semverParts(value: string, path = 'version'): Semver {
  return stableSemverParts(value, path, semverInvalid)
}

function engineRange(value: unknown, path: string): string {
  return normalizeStableEngineRange(value, path, {
    maxLength: TEAM_MOTION_LIBRARY_LIMITS.maxRangeLength,
    invalid: semverInvalid
  })
}

export function satisfiesTeamMotionEngineRange(version: string, range: string): boolean {
  return satisfiesStableEngineRange(version, range, {
    maxLength: TEAM_MOTION_LIBRARY_LIMITS.maxRangeLength,
    invalid: semverInvalid
  })
}

function source(value: unknown, path: string): TeamMotionLibrarySource {
  const record = strictRecord(value, path, ['kind', 'ref'])
  const kind = required(record, 'kind', path)
  const ref = text(
    required(record, 'ref', path),
    `${path}.ref`,
    1,
    TEAM_MOTION_LIBRARY_LIMITS.maxSourceRefLength
  )
  return parseMotionSourceReference(
    kind,
    ref,
    path,
    invalid,
    'Expected an HTTP(S) URL without credentials'
  )
}

function token(value: unknown, path: string): TeamMotionNumberToken {
  const record = strictRecord(value, path, ['id', 'type', 'defaultValue', 'min', 'max'])
  const id = required(record, 'id', path)
  if (typeof id !== 'string' || !SAFE_TOKEN.test(id)) {
    return invalid(`${path}.id`, 'invalid_value', 'Expected a safe token path')
  }
  if (required(record, 'type', path) !== 'number') {
    return invalid(
      `${path}.type`,
      'invalid_value',
      'Only bounded numeric Motion tokens are supported'
    )
  }
  const min = boundedNumber(
    required(record, 'min', path),
    `${path}.min`,
    TEAM_MOTION_LIBRARY_LIMITS.tokenValue.min,
    TEAM_MOTION_LIBRARY_LIMITS.tokenValue.max
  )
  const max = boundedNumber(
    required(record, 'max', path),
    `${path}.max`,
    TEAM_MOTION_LIBRARY_LIMITS.tokenValue.min,
    TEAM_MOTION_LIBRARY_LIMITS.tokenValue.max
  )
  if (min > max) return invalid(`${path}.max`, 'invalid_value', 'Token max must be at least min')
  const defaultValue = boundedNumber(
    required(record, 'defaultValue', path),
    `${path}.defaultValue`,
    min,
    max
  )
  return { id, type: 'number', defaultValue, min, max }
}

function tokenBindings(
  value: unknown,
  path: string,
  recipe: MotionRecipe,
  tokens: readonly TeamMotionNumberToken[]
): TeamMotionTokenBinding[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return invalid(path, 'invalid_type', 'Expected an array')
  if (value.length > TEAM_MOTION_LIBRARY_LIMITS.maxTokenBindings) {
    return invalid(path, 'limit_exceeded', 'Too many token bindings')
  }
  const tokenIds = new Set(tokens.map(({ id }) => id))
  const parameterIds = new Set(recipe.parameters.map(({ id }) => id))
  const seen = new Set<string>()
  return value.map((candidate, index) => {
    const itemPath = `${path}[${index}]`
    const record = strictRecord(candidate, itemPath, ['tokenId', 'parameterId'])
    const tokenId = record.tokenId
    const parameterId = record.parameterId
    if (typeof tokenId !== 'string' || !tokenIds.has(tokenId)) {
      return invalid(`${itemPath}.tokenId`, 'invalid_value', 'Unknown team Motion token')
    }
    if (typeof parameterId !== 'string' || !parameterIds.has(parameterId)) {
      return invalid(`${itemPath}.parameterId`, 'invalid_value', 'Unknown recipe parameter')
    }
    if (seen.has(parameterId)) {
      return invalid(`${itemPath}.parameterId`, 'invalid_value', 'A parameter may bind one token')
    }
    seen.add(parameterId)
    return { tokenId, parameterId }
  })
}

function parsePreset(value: unknown, path: string): UserMotionPreset {
  try {
    const library = parseUserMotionPresetLibrary({
      format: USER_MOTION_PRESET_FORMAT,
      schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
      presets: [value]
    })
    return library.presets[0]
  } catch (error) {
    return invalid(path, 'invalid_value', error instanceof Error ? error.message : 'Invalid preset')
  }
}

function entry(
  value: unknown,
  path: string,
  tokens: readonly TeamMotionNumberToken[]
): TeamMotionLibraryEntry {
  const record = plainRecord(value, path)
  if (record.kind === 'preset') {
    const strict = strictRecord(record, path, ['kind', 'preset'])
    return {
      kind: 'preset',
      preset: parsePreset(required(strict, 'preset', path), `${path}.preset`)
    }
  }
  if (record.kind !== 'recipe') {
    return invalid(`${path}.kind`, 'invalid_value', 'Expected preset or recipe')
  }
  const strict = strictRecord(record, path, ['kind', 'recipe', 'tokenBindings'])
  let recipe: MotionRecipe
  try {
    recipe = parseMotionRecipe(required(strict, 'recipe', path))
  } catch (error) {
    return invalid(
      `${path}.recipe`,
      'invalid_value',
      error instanceof Error ? error.message : 'Invalid recipe'
    )
  }
  const bindings = tokenBindings(strict.tokenBindings, `${path}.tokenBindings`, recipe, tokens)
  return { kind: 'recipe', recipe, ...(bindings ? { tokenBindings: bindings } : {}) }
}

function entryId(candidate: TeamMotionLibraryEntry): string {
  return candidate.kind === 'preset' ? candidate.preset.id : candidate.recipe.id
}

function entries(
  value: unknown,
  path: string,
  tokens: readonly TeamMotionNumberToken[]
): TeamMotionLibraryEntry[] {
  if (!Array.isArray(value)) return invalid(path, 'invalid_type', 'Expected an array')
  if (value.length < 1 || value.length > TEAM_MOTION_LIBRARY_LIMITS.maxEntries) {
    return invalid(
      path,
      'limit_exceeded',
      `Expected 1-${TEAM_MOTION_LIBRARY_LIMITS.maxEntries} entries`
    )
  }
  const parsed = value.map((candidate, index) => entry(candidate, `${path}[${index}]`, tokens))
  const seen = new Set<string>()
  parsed.forEach((candidate, index) => {
    const id = entryId(candidate)
    if (seen.has(id)) invalid(`${path}[${index}]`, 'invalid_value', 'Entry ids must be unique')
    seen.add(id)
  })
  return parsed
}

function parseTokens(value: unknown, path: string): TeamMotionNumberToken[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return invalid(path, 'invalid_type', 'Expected an array')
  if (value.length > TEAM_MOTION_LIBRARY_LIMITS.maxTokens) {
    return invalid(path, 'limit_exceeded', 'Too many team Motion tokens')
  }
  const parsed = value.map((candidate, index) => token(candidate, `${path}[${index}]`))
  uniqueIds(parsed, path, 'Token')
  return parsed
}

function parsePayload(value: unknown, path = 'manifest'): TeamMotionLibraryPayload {
  const record = strictRecord(value, path, [
    'format',
    'schemaVersion',
    'publisher',
    'library',
    'version',
    'engineRange',
    'source',
    'releaseNotes',
    'tokens',
    'entries'
  ])
  if (required(record, 'format', path) !== TEAM_MOTION_LIBRARY_FORMAT) {
    return invalid(`${path}.format`, 'invalid_value', 'Unknown team Motion library format')
  }
  if (required(record, 'schemaVersion', path) !== TEAM_MOTION_LIBRARY_SCHEMA_VERSION) {
    return invalid(`${path}.schemaVersion`, 'invalid_value', 'Unsupported team Motion schema')
  }
  const parsedTokens = parseTokens(record.tokens, `${path}.tokens`)
  return {
    format: TEAM_MOTION_LIBRARY_FORMAT,
    schemaVersion: TEAM_MOTION_LIBRARY_SCHEMA_VERSION,
    publisher: publisher(required(record, 'publisher', path), `${path}.publisher`),
    library: identity(required(record, 'library', path), `${path}.library`),
    version: semver(required(record, 'version', path), `${path}.version`),
    engineRange: engineRange(required(record, 'engineRange', path), `${path}.engineRange`),
    source: source(required(record, 'source', path), `${path}.source`),
    ...(Object.hasOwn(record, 'releaseNotes')
      ? {
          releaseNotes: text(
            record.releaseNotes,
            `${path}.releaseNotes`,
            0,
            TEAM_MOTION_LIBRARY_LIMITS.maxReleaseNotesLength
          )
        }
      : {}),
    ...(parsedTokens ? { tokens: parsedTokens } : {}),
    entries: entries(required(record, 'entries', path), `${path}.entries`, parsedTokens ?? [])
  }
}

function encodedValue(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 512 ||
    !BASE64URL.test(value)
  ) {
    return invalid(path, 'invalid_value', 'Expected bounded base64url data')
  }
  return value
}

function integrity(
  value: unknown,
  path: string,
  publisherKeyId: string
): TeamMotionLibraryIntegrity {
  const record = strictRecord(value, path, ['algorithm', 'digest', 'signature'])
  if (required(record, 'algorithm', path) !== 'SHA-256') {
    return invalid(`${path}.algorithm`, 'invalid_value', 'Expected SHA-256')
  }
  const signatureRecord = strictRecord(required(record, 'signature', path), `${path}.signature`, [
    'algorithm',
    'keyId',
    'value'
  ])
  if (required(signatureRecord, 'algorithm', `${path}.signature`) !== 'Ed25519') {
    return invalid(`${path}.signature.algorithm`, 'invalid_value', 'Expected Ed25519')
  }
  const keyId = safeId(
    required(signatureRecord, 'keyId', `${path}.signature`),
    `${path}.signature.keyId`
  )
  if (keyId !== publisherKeyId) {
    return invalid(
      `${path}.signature.keyId`,
      'invalid_value',
      'Signature key does not match publisher'
    )
  }
  return {
    algorithm: 'SHA-256',
    digest: encodedValue(required(record, 'digest', path), `${path}.digest`),
    signature: {
      algorithm: 'Ed25519',
      keyId,
      value: encodedValue(
        required(signatureRecord, 'value', `${path}.signature`),
        `${path}.signature.value`
      )
    }
  }
}

export function parseTeamMotionLibraryPayload(value: unknown): TeamMotionLibraryPayload {
  assertMotionPortableValue(value, 'manifest', { invalid, plainRecord })
  const payload = parsePayload(value)
  assertJSONSize(canonicalJSON(payload), 'manifest')
  return payload
}

export function parseTeamMotionLibraryManifest(value: unknown): TeamMotionLibraryManifest {
  assertMotionPortableValue(value, 'manifest', { invalid, plainRecord })
  const record = strictRecord(value, 'manifest', [
    'format',
    'schemaVersion',
    'publisher',
    'library',
    'version',
    'engineRange',
    'source',
    'releaseNotes',
    'tokens',
    'entries',
    'integrity'
  ])
  const payloadRecord = { ...record }
  Reflect.deleteProperty(payloadRecord, 'integrity')
  const payload = parsePayload(payloadRecord)
  const manifest: TeamMotionLibraryManifest = {
    ...payload,
    integrity: integrity(
      required(record, 'integrity', 'manifest'),
      'manifest.integrity',
      payload.publisher.keyId
    )
  }
  assertJSONSize(canonicalJSON(manifest))
  return manifest
}

export function validateTeamMotionLibraryManifest(
  value: unknown
): TeamMotionLibraryValidationResult {
  try {
    return { success: true, value: parseTeamMotionLibraryManifest(value) }
  } catch (error) {
    if (error instanceof TeamMotionLibraryValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

export function serializeTeamMotionLibraryManifest(value: unknown): string {
  const manifest = parseTeamMotionLibraryManifest(value)
  return `${JSON.stringify(canonicalValue(manifest), null, 2)}\n`
}

export async function signTeamMotionLibraryManifest(
  value: unknown,
  privateKey: CryptoKey
): Promise<TeamMotionLibraryManifest> {
  const payload = parseTeamMotionLibraryPayload(value)
  return parseTeamMotionLibraryManifest({
    ...payload,
    integrity: await createSignedManifestIntegrity(payload, payload.publisher.keyId, privateKey)
  })
}

export async function verifyTeamMotionLibraryManifest(
  value: unknown,
  publicKey: CryptoKey,
  options: { engineVersion?: string; expectedKeyId?: string } = {}
): Promise<VerifiedTeamMotionLibrarySnapshot> {
  const manifest = parseTeamMotionLibraryManifest(value)
  assertSignedManifestVerificationPolicy(publicKey, manifest.integrity.signature.keyId, options, {
    engineRange: manifest.engineRange,
    label: 'Team Motion',
    engineLabel: 'Team Motion library',
    invalid: semverInvalid,
    maxEngineRangeLength: TEAM_MOTION_LIBRARY_LIMITS.maxRangeLength
  })
  const { integrity: manifestIntegrity, ...payload } = manifest
  const digest = await verifySignedManifestIntegrity(
    payload,
    manifestIntegrity,
    publicKey,
    'Team Motion library'
  )
  return {
    manifest,
    verifiedDigest: digest,
    verifiedKeyId: manifestIntegrity.signature.keyId
  }
}

function snapshot(value: VerifiedTeamMotionLibrarySnapshot): VerifiedTeamMotionLibrarySnapshot {
  const manifest = parseTeamMotionLibraryManifest(value.manifest)
  if (
    value.verifiedDigest !== manifest.integrity.digest ||
    value.verifiedKeyId !== manifest.integrity.signature.keyId
  ) {
    return invalid(
      'snapshot',
      'invalid_value',
      'Verified snapshot metadata does not match manifest'
    )
  }
  return {
    manifest,
    verifiedDigest: value.verifiedDigest,
    verifiedKeyId: value.verifiedKeyId
  }
}

function snapshotEntryMap(value: VerifiedTeamMotionLibrarySnapshot | null): Map<string, string> {
  return new Map(
    value?.manifest.entries.map((candidate) => [entryId(candidate), canonicalJSON(candidate)])
  )
}

export function diffTeamMotionLibraries(
  current: VerifiedTeamMotionLibrarySnapshot | null,
  candidate: VerifiedTeamMotionLibrarySnapshot
): TeamMotionLibraryDiff {
  const accepted = current ? snapshot(current) : null
  const next = snapshot(candidate)
  const before = snapshotEntryMap(accepted)
  const after = snapshotEntryMap(next)
  const added: string[] = []
  const removed: string[] = []
  const updated: string[] = []
  for (const [id, serialized] of after) {
    if (!before.has(id)) added.push(id)
    else if (before.get(id) !== serialized) updated.push(id)
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(id)
  }
  return {
    fromVersion: accepted?.manifest.version ?? null,
    toVersion: next.manifest.version,
    added: added.sort(),
    removed: removed.sort(),
    updated: updated.sort()
  }
}

function matchingLibrary(
  current: VerifiedTeamMotionLibrarySnapshot,
  candidate: VerifiedTeamMotionLibrarySnapshot
): void {
  if (
    current.manifest.library.id !== candidate.manifest.library.id ||
    current.manifest.publisher.id !== candidate.manifest.publisher.id ||
    current.manifest.publisher.keyId !== candidate.manifest.publisher.keyId
  ) {
    invalid('candidate', 'invalid_value', 'Team Motion library identity or signing key changed')
  }
}

function requireForwardLibraryVersion(
  current: VerifiedTeamMotionLibrarySnapshot,
  candidate: VerifiedTeamMotionLibrarySnapshot
): void {
  const compared = compareSemver(
    semverParts(candidate.manifest.version),
    semverParts(current.manifest.version)
  )
  if (compared === 0) {
    if (candidate.verifiedDigest !== current.verifiedDigest) {
      invalid(
        'candidate.manifest.version',
        'invalid_value',
        'Library content changed without a version bump'
      )
    }
    invalid(
      'candidate.manifest.version',
      'invalid_value',
      'Team Motion updates require a strictly greater version'
    )
  }
  if (compared < 0) {
    invalid(
      'candidate.manifest.version',
      'invalid_value',
      'Team Motion updates cannot downgrade a library; use explicit rollback'
    )
  }
}

export function createTeamMotionLibraryRegistry(
  acceptedValue: VerifiedTeamMotionLibrarySnapshot
): TeamMotionLibraryRegistryState {
  return {
    version: TEAM_MOTION_REGISTRY_STATE_VERSION,
    accepted: snapshot(acceptedValue),
    history: []
  }
}

export function reviewTeamMotionLibraryUpdate(
  state: TeamMotionLibraryRegistryState,
  candidateValue: VerifiedTeamMotionLibrarySnapshot
): TeamMotionLibraryRegistryState {
  const current = parseTeamMotionLibraryRegistryState(state)
  const candidate = snapshot(candidateValue)
  matchingLibrary(current.accepted, candidate)
  requireForwardLibraryVersion(current.accepted, candidate)
  return {
    ...current,
    pending: {
      candidate,
      diff: diffTeamMotionLibraries(current.accepted, candidate),
      status: 'pending'
    }
  }
}

export function acceptTeamMotionLibraryReview(
  state: TeamMotionLibraryRegistryState
): TeamMotionLibraryRegistryState {
  const current = parseTeamMotionLibraryRegistryState(state)
  if (!current.pending) return invalid('registry.pending', 'invalid_value', 'No pending review')
  return {
    version: TEAM_MOTION_REGISTRY_STATE_VERSION,
    accepted: current.pending.candidate,
    history: [current.accepted, ...current.history].slice(0, TEAM_MOTION_LIBRARY_LIMITS.maxHistory)
  }
}

export function rejectTeamMotionLibraryReview(
  state: TeamMotionLibraryRegistryState
): TeamMotionLibraryRegistryState {
  const current = parseTeamMotionLibraryRegistryState(state)
  const { pending: _pending, ...withoutPending } = current
  return withoutPending
}

export function rollbackTeamMotionLibrary(
  state: TeamMotionLibraryRegistryState,
  digest: string
): TeamMotionLibraryRegistryState {
  const current = parseTeamMotionLibraryRegistryState(state)
  const index = current.history.findIndex((candidate) => candidate.verifiedDigest === digest)
  if (index === -1)
    return invalid('rollback.digest', 'invalid_value', 'Unknown verified history snapshot')
  const target = current.history[index]
  return {
    version: TEAM_MOTION_REGISTRY_STATE_VERSION,
    accepted: target,
    history: [
      current.accepted,
      ...current.history.filter((_, candidateIndex) => candidateIndex !== index)
    ].slice(0, TEAM_MOTION_LIBRARY_LIMITS.maxHistory)
  }
}

export function parseTeamMotionLibraryRegistryState(
  value: unknown
): TeamMotionLibraryRegistryState {
  const record = strictRecord(value, 'registry', ['version', 'accepted', 'history', 'pending'])
  if (required(record, 'version', 'registry') !== TEAM_MOTION_REGISTRY_STATE_VERSION) {
    return invalid('registry.version', 'invalid_value', 'Unsupported team Motion registry state')
  }
  const accepted = snapshot(
    required(record, 'accepted', 'registry') as VerifiedTeamMotionLibrarySnapshot
  )
  if (!Array.isArray(record.history)) {
    return invalid('registry.history', 'invalid_type', 'Expected an array')
  }
  if (record.history.length > TEAM_MOTION_LIBRARY_LIMITS.maxHistory) {
    return invalid('registry.history', 'limit_exceeded', 'Too many rollback snapshots')
  }
  const history = record.history.map((candidate) =>
    snapshot(candidate as VerifiedTeamMotionLibrarySnapshot)
  )
  const digests = new Set<string>([accepted.verifiedDigest])
  history.forEach((candidate, index) => {
    matchingLibrary(accepted, candidate)
    if (digests.has(candidate.verifiedDigest)) {
      invalid(`registry.history[${index}]`, 'invalid_value', 'Duplicate verified snapshot')
    }
    digests.add(candidate.verifiedDigest)
  })
  let pending: TeamMotionLibraryReview | undefined
  if (record.pending !== undefined) {
    const pendingRecord = strictRecord(record.pending, 'registry.pending', [
      'candidate',
      'diff',
      'status'
    ])
    if (pendingRecord.status !== 'pending') {
      return invalid('registry.pending.status', 'invalid_value', 'Expected pending review')
    }
    const candidate = snapshot(
      required(pendingRecord, 'candidate', 'registry.pending') as VerifiedTeamMotionLibrarySnapshot
    )
    matchingLibrary(accepted, candidate)
    requireForwardLibraryVersion(accepted, candidate)
    const expectedDiff = diffTeamMotionLibraries(accepted, candidate)
    if (canonicalJSON(pendingRecord.diff) !== canonicalJSON(expectedDiff)) {
      return invalid(
        'registry.pending.diff',
        'invalid_value',
        'Review diff does not match snapshots'
      )
    }
    pending = { candidate, diff: expectedDiff, status: 'pending' }
  }
  return {
    version: TEAM_MOTION_REGISTRY_STATE_VERSION,
    accepted,
    history,
    ...(pending ? { pending } : {})
  }
}

function resolvedTokenValues(
  manifest: TeamMotionLibraryManifest,
  input: Readonly<Record<string, number>> = {}
): Record<string, number> {
  const tokens = manifest.tokens ?? []
  for (const key of Object.keys(input)) {
    if (!tokens.some(({ id }) => id === key)) {
      invalid(`tokens.${key}`, 'unknown_key', 'Unknown team Motion token')
    }
  }
  return Object.fromEntries(
    tokens.map((definition) => [
      definition.id,
      Object.hasOwn(input, definition.id)
        ? boundedNumber(
            input[definition.id],
            `tokens.${definition.id}`,
            definition.min,
            definition.max
          )
        : definition.defaultValue
    ])
  )
}

export function instantiateTeamMotionLibraryEntry(
  snapshotValue: VerifiedTeamMotionLibrarySnapshot,
  entryIdentifier: string,
  input: {
    roleMapping?: MotionRecipeInstantiationInput['roleMapping']
    parameters?: Record<string, number>
    tokens?: Record<string, number>
  } = {}
): TeamMotionLibraryInstantiation {
  const verified = snapshot(snapshotValue)
  const manifest = verified.manifest
  const candidate = manifest.entries.find((entry) => entryId(entry) === entryIdentifier)
  if (!candidate) return invalid('entry.id', 'invalid_value', 'Unknown team Motion entry')
  if (candidate.kind === 'preset') {
    return {
      kind: 'preset',
      entryId: candidate.preset.id,
      motion: instantiateUserMotionPreset(candidate.preset)
    }
  }
  if (!input.roleMapping) {
    return invalid('instance.roleMapping', 'invalid_value', 'Recipe role mapping is required')
  }
  const tokenValues = resolvedTokenValues(manifest, input.tokens)
  const tokenParameters = Object.fromEntries(
    (candidate.tokenBindings ?? []).map(({ tokenId, parameterId }) => [
      parameterId,
      tokenValues[tokenId]
    ])
  )
  const result = instantiateMotionRecipe(candidate.recipe, {
    roleMapping: input.roleMapping,
    parameters: { ...tokenParameters, ...input.parameters }
  })
  return { kind: 'recipe', entryId: candidate.recipe.id, result }
}
