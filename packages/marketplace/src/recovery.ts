/* eslint-disable max-lines -- Backup format parsing, trust verification, and offline generation preparation form one recovery boundary. */
import { Database } from 'bun:sqlite'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { constants, type Dirent } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  parseMarketplaceSnapshotBytes,
  parsePluginCatalogBytes,
  parsePluginRuntimeIndexBytes,
  verifyMarketplaceCatalog,
  verifyMarketplaceRuntimeIndex,
  verifyMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'
import {
  canonicalManifestValue,
  importEd25519PublicKeyPem,
  parseExactManifestRecord,
  parseSha256Base64URL,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import {
  inspectMarketplaceArtifact,
  type MarketplaceArtifact,
  type MarketplaceArtifactStore
} from './artifacts'
import { marketplaceAuditPayloadDigest, verifyMarketplaceAuditChain } from './audit'
import {
  assertMarketplaceSqliteSchema,
  MARKETPLACE_INCOMPLETE_GENERATION_FILE,
  MARKETPLACE_SQLITE_SCHEMA_VERSION,
  marketplaceGenerationReservationPath
} from './sqlite-layout'
import type { SqliteMarketplaceRepository } from './sqlite-repository'
import {
  parseMarketplacePublicURL,
  parseMarketplaceState,
  parseMarketplaceTimestamp,
  type MarketplacePublicationV1,
  type MarketplaceStateV1
} from './types'

export const MARKETPLACE_BACKUP_FORMAT = 'openpencil-marketplace-backup' as const
export const MARKETPLACE_BACKUP_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_BACKUP_LIMITS = Object.freeze({
  maxManifestBytes: 16 * 1024 * 1024,
  maxDatabaseBytes: 128 * 1024 * 1024,
  maxArtifactEntries: 100_000,
  minIntegritySecretBytes: 32,
  maxIntegritySecretBytes: 1_024
})

export interface MarketplaceBackupIntegrityKey {
  readonly keyId: string
  readonly secret: Uint8Array
}

export interface MarketplaceBackupRootTrust {
  readonly keyId: string
  readonly publicKey: CryptoKey
}

export interface MarketplaceBackupArtifactV1 {
  readonly digest: string
  readonly byteLength: number
}

export interface MarketplaceBackupPublicationCheckpointV1 {
  readonly sequence: number
  readonly snapshotDigest: string
  readonly snapshotArtifactDigest: string
  readonly auditSequence: number
  readonly auditHead: string
}

export interface MarketplaceBackupManifestV1 {
  readonly format: typeof MARKETPLACE_BACKUP_FORMAT
  readonly schemaVersion: typeof MARKETPLACE_BACKUP_SCHEMA_VERSION
  readonly marketplaceId: string
  readonly publicBaseUrl: string
  readonly createdAt: string
  readonly rootKeyId: string
  readonly rootPublicKeyFingerprint: string
  readonly database: {
    readonly path: 'marketplace.sqlite'
    readonly digest: string
    readonly byteLength: number
  }
  readonly artifacts: readonly MarketplaceBackupArtifactV1[]
  readonly checkpoint: {
    readonly auditSequence: number
    readonly auditHead: string | null
    readonly latestPublication: MarketplaceBackupPublicationCheckpointV1 | null
  }
  readonly integrity: {
    readonly algorithm: 'HMAC-SHA256'
    readonly keyId: string
    readonly digest: string
  }
}

export interface MarketplaceRecoveryVerificationOptions {
  readonly marketplaceId: string
  readonly publicBaseUrl: string
  readonly root: MarketplaceBackupRootTrust
  readonly now?: () => Date
}

export interface CreateMarketplaceBackupOptions extends MarketplaceRecoveryVerificationOptions {
  readonly repository: SqliteMarketplaceRepository
  readonly artifacts: MarketplaceArtifactStore
  readonly destination: string
  readonly integrity: MarketplaceBackupIntegrityKey
}

export interface VerifyMarketplaceBackupOptions extends MarketplaceRecoveryVerificationOptions {
  readonly source: string
  readonly integrity: MarketplaceBackupIntegrityKey
}

export interface PrepareMarketplaceRestoreOptions extends VerifyMarketplaceBackupOptions {
  readonly destination: string
}

export interface VerifiedMarketplaceBackup {
  readonly manifest: MarketplaceBackupManifestV1
  readonly state: MarketplaceStateV1
  readonly stale: boolean
}

interface VerifiedRecoveryState {
  readonly state: MarketplaceStateV1
  readonly artifacts: readonly MarketplaceBackupArtifactV1[]
  readonly stale: boolean
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const MANIFEST_FILE = 'manifest.json'
const DATABASE_FILE = 'marketplace.sqlite'
const ARTIFACT_DIRECTORY = 'artifacts'
const ROOT_ENTRIES = Object.freeze([ARTIFACT_DIRECTORY, MANIFEST_FILE, DATABASE_FILE])

function identity(value: string, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value
}

function publicBaseURL(value: string): string {
  const parsed = new URL(parseMarketplacePublicURL(value, 'Marketplace backup public base URL'))
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError('Marketplace backup public base URL must be an HTTPS origin')
  }
  return parsed.href
}

function currentTime(now: (() => Date) | undefined): string {
  const date = (now ?? (() => new Date()))()
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Marketplace backup clock must return a valid Date')
  }
  return parseMarketplaceTimestamp(date.toISOString(), 'Marketplace backup time')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

function parseIntegrityKey(value: MarketplaceBackupIntegrityKey): MarketplaceBackupIntegrityKey {
  const keyId = identity(value.keyId, 'Marketplace backup integrity key id')
  if (!(value.secret instanceof Uint8Array)) {
    throw new TypeError('Marketplace backup integrity secret must be bytes')
  }
  if (
    value.secret.byteLength < MARKETPLACE_BACKUP_LIMITS.minIntegritySecretBytes ||
    value.secret.byteLength > MARKETPLACE_BACKUP_LIMITS.maxIntegritySecretBytes
  ) {
    throw new TypeError(
      'Marketplace backup integrity secret must contain between 32 and 1024 bytes'
    )
  }
  return Object.freeze({ keyId, secret: new Uint8Array(value.secret) })
}

function parseRootTrust(value: MarketplaceBackupRootTrust): MarketplaceBackupRootTrust {
  const keyId = identity(value.keyId, 'Marketplace backup root key id')
  if (value.publicKey.type !== 'public' || value.publicKey.algorithm.name !== 'Ed25519') {
    throw new TypeError('Marketplace backup root trust must contain an Ed25519 public key')
  }
  return Object.freeze({ keyId, publicKey: value.publicKey })
}

async function rootFingerprint(key: CryptoKey): Promise<string> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', key))
  return `sha256-${sha256(spki)}`
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(canonicalManifestValue(value))}\n`)
}

function unsignedManifest(value: MarketplaceBackupManifestV1) {
  const { integrity: _integrity, ...unsigned } = value
  return unsigned
}

function manifestHMAC(value: Omit<MarketplaceBackupManifestV1, 'integrity'>, secret: Uint8Array) {
  return createHmac('sha256', secret).update(canonicalBytes(value)).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

function exactRecord(value: unknown, path: string, keys: readonly string[]) {
  const exactKeys = new Set(keys)
  return parseExactManifestRecord(value, path, exactKeys, exactKeys)
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function boundedString(value: unknown, path: string, maximum = 2_048): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    encoder.encode(value).byteLength > maximum
  ) {
    throw new TypeError(`${path} must be non-empty bounded text`)
  }
  return value
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${path} must be a bounded integer`)
  }
  return value as number
}

function nullableDigest(value: unknown, path: string): string | null {
  return value === null ? null : parseSha256Base64URL(value, path)
}

function parseArtifact(value: unknown, path: string): MarketplaceBackupArtifactV1 {
  const source = exactRecord(value, path, ['byteLength', 'digest'])
  return Object.freeze({
    digest: parseSha256Base64URL(source.digest, `${path}.digest`),
    byteLength: integer(source.byteLength, `${path}.byteLength`, 1)
  })
}

function parsePublicationCheckpoint(
  value: unknown,
  path: string
): MarketplaceBackupPublicationCheckpointV1 | null {
  if (value === null) return null
  const source = exactRecord(value, path, [
    'auditHead',
    'auditSequence',
    'sequence',
    'snapshotArtifactDigest',
    'snapshotDigest'
  ])
  return Object.freeze({
    sequence: integer(source.sequence, `${path}.sequence`, 1),
    snapshotDigest: parseSha256Base64URL(source.snapshotDigest, `${path}.snapshotDigest`),
    snapshotArtifactDigest: parseSha256Base64URL(
      source.snapshotArtifactDigest,
      `${path}.snapshotArtifactDigest`
    ),
    auditSequence: integer(source.auditSequence, `${path}.auditSequence`, 1),
    auditHead: parseSha256Base64URL(source.auditHead, `${path}.auditHead`)
  })
}

export function parseMarketplaceBackupManifest(value: unknown): MarketplaceBackupManifestV1 {
  const source = exactRecord(value, 'Marketplace backup manifest', [
    'artifacts',
    'checkpoint',
    'createdAt',
    'database',
    'format',
    'integrity',
    'marketplaceId',
    'publicBaseUrl',
    'rootKeyId',
    'rootPublicKeyFingerprint',
    'schemaVersion'
  ])
  if (source.format !== MARKETPLACE_BACKUP_FORMAT) {
    throw new TypeError(`Marketplace backup format must be ${MARKETPLACE_BACKUP_FORMAT}`)
  }
  if (source.schemaVersion !== MARKETPLACE_BACKUP_SCHEMA_VERSION) {
    throw new TypeError('Marketplace backup schema version is not supported')
  }
  if (
    !Array.isArray(source.artifacts) ||
    source.artifacts.length > MARKETPLACE_BACKUP_LIMITS.maxArtifactEntries
  ) {
    throw new TypeError('Marketplace backup artifacts are not a bounded array')
  }
  const artifacts = source.artifacts.map((entry, index) =>
    parseArtifact(entry, `Marketplace backup manifest.artifacts[${index}]`)
  )
  const sorted = [...artifacts].sort((left, right) => compareText(left.digest, right.digest))
  if (
    artifacts.some((entry, index) => entry.digest !== sorted[index]?.digest) ||
    new Set(artifacts.map(({ digest }) => digest)).size !== artifacts.length
  ) {
    throw new TypeError('Marketplace backup artifacts must be unique and sorted by digest')
  }
  const database = exactRecord(source.database, 'Marketplace backup manifest.database', [
    'byteLength',
    'digest',
    'path'
  ])
  if (database.path !== DATABASE_FILE) {
    throw new TypeError(`Marketplace backup database.path must be ${DATABASE_FILE}`)
  }
  const checkpoint = exactRecord(source.checkpoint, 'Marketplace backup manifest.checkpoint', [
    'auditHead',
    'auditSequence',
    'latestPublication'
  ])
  const auditSequence = integer(
    checkpoint.auditSequence,
    'Marketplace backup manifest.checkpoint.auditSequence'
  )
  const auditHead = nullableDigest(
    checkpoint.auditHead,
    'Marketplace backup manifest.checkpoint.auditHead'
  )
  if ((auditSequence === 0) !== (auditHead === null)) {
    throw new TypeError('Marketplace backup audit checkpoint is incomplete')
  }
  const integrity = exactRecord(source.integrity, 'Marketplace backup manifest.integrity', [
    'algorithm',
    'digest',
    'keyId'
  ])
  if (integrity.algorithm !== 'HMAC-SHA256') {
    throw new TypeError('Marketplace backup integrity algorithm is not supported')
  }
  const fingerprint = boundedString(
    source.rootPublicKeyFingerprint,
    'Marketplace backup root public key fingerprint',
    128
  )
  if (!/^sha256-[A-Za-z0-9_-]{43}$/.test(fingerprint)) {
    throw new TypeError('Marketplace backup root public key fingerprint is invalid')
  }
  return Object.freeze({
    format: MARKETPLACE_BACKUP_FORMAT,
    schemaVersion: MARKETPLACE_BACKUP_SCHEMA_VERSION,
    marketplaceId: identity(
      boundedString(source.marketplaceId, 'Marketplace backup marketplaceId', 128),
      'Marketplace backup marketplaceId'
    ),
    publicBaseUrl: publicBaseURL(
      boundedString(source.publicBaseUrl, 'Marketplace backup publicBaseUrl')
    ),
    createdAt: parseMarketplaceTimestamp(source.createdAt, 'Marketplace backup createdAt'),
    rootKeyId: identity(
      boundedString(source.rootKeyId, 'Marketplace backup rootKeyId', 128),
      'Marketplace backup rootKeyId'
    ),
    rootPublicKeyFingerprint: fingerprint,
    database: Object.freeze({
      path: DATABASE_FILE,
      digest: parseSha256Base64URL(database.digest, 'Marketplace backup database.digest'),
      byteLength: integer(database.byteLength, 'Marketplace backup database.byteLength', 1)
    }),
    artifacts: Object.freeze(artifacts),
    checkpoint: Object.freeze({
      auditSequence,
      auditHead,
      latestPublication: parsePublicationCheckpoint(
        checkpoint.latestPublication,
        'Marketplace backup manifest.checkpoint.latestPublication'
      )
    }),
    integrity: Object.freeze({
      algorithm: 'HMAC-SHA256',
      keyId: identity(
        boundedString(integrity.keyId, 'Marketplace backup integrity.keyId', 128),
        'Marketplace backup integrity.keyId'
      ),
      digest: parseSha256Base64URL(integrity.digest, 'Marketplace backup integrity.digest')
    })
  })
}

function ownedArtifactDigest(urlValue: string, publicBase: string, path: string): string {
  const prefix = new URL('/v1/artifacts/', publicBase).href
  if (!urlValue.startsWith(prefix)) {
    throw new Error(`${path} is not owned by this Marketplace artifact store`)
  }
  const suffix = urlValue.slice(prefix.length)
  if (suffix.includes('/') || suffix.includes('?') || suffix.includes('#')) {
    throw new Error(`${path} is not an immutable Marketplace artifact URL`)
  }
  return parseSha256Base64URL(suffix, `${path} artifact digest`)
}

function addOwnedArtifact(
  digests: Set<string>,
  digest: string,
  url: string,
  publicBase: string,
  path: string
): void {
  const parsed = parseSha256Base64URL(digest, `${path} digest`)
  if (ownedArtifactDigest(url, publicBase, path) !== parsed) {
    throw new Error(`${path} URL does not match its artifact digest`)
  }
  digests.add(parsed)
}

export function marketplaceReferencedArtifactDigests(
  stateValue: unknown,
  publicBaseURLValue: string
): readonly string[] {
  const state = parseMarketplaceState(stateValue)
  const publicBase = publicBaseURL(publicBaseURLValue)
  const digests = new Set<string>()
  for (const submission of state.submissions) {
    addOwnedArtifact(
      digests,
      submission.artifactDigest,
      submission.manifestUrl,
      publicBase,
      `Submission ${submission.id} manifest`
    )
    if (submission.runtimeCoordinate) {
      digests.add(
        ownedArtifactDigest(
          submission.runtimeCoordinate.packageUrl,
          publicBase,
          `Submission ${submission.id} runtime`
        )
      )
    }
    for (const revision of submission.revisionHistory) {
      addOwnedArtifact(
        digests,
        revision.artifactDigest,
        revision.manifestUrl,
        publicBase,
        `Submission ${submission.id} revision ${revision.revision} manifest`
      )
      if (revision.runtimeCoordinate) {
        digests.add(
          ownedArtifactDigest(
            revision.runtimeCoordinate.packageUrl,
            publicBase,
            `Submission ${submission.id} revision ${revision.revision} runtime`
          )
        )
      }
    }
  }
  for (const release of state.releases) {
    addOwnedArtifact(
      digests,
      release.artifactDigest,
      release.manifestUrl,
      publicBase,
      `Release ${release.submissionId} manifest`
    )
    if (release.runtimeCoordinate) {
      digests.add(
        ownedArtifactDigest(
          release.runtimeCoordinate.packageUrl,
          publicBase,
          `Release ${release.submissionId} runtime`
        )
      )
    }
  }
  for (const publication of state.publications) {
    digests.add(publication.snapshotArtifactDigest)
    for (const catalog of publication.catalogs) digests.add(catalog.artifactDigest)
    if (publication.runtimeIndexArtifactDigest) digests.add(publication.runtimeIndexArtifactDigest)
  }
  if (digests.size > MARKETPLACE_BACKUP_LIMITS.maxArtifactEntries) {
    throw new RangeError('Marketplace backup artifact closure exceeds its entry limit')
  }
  return Object.freeze([...digests].sort(compareText))
}

async function requiredArtifact(
  artifacts: MarketplaceArtifactStore,
  digest: string,
  label: string
): Promise<MarketplaceArtifact> {
  const artifact = await artifacts.get(digest)
  if (!artifact) throw new Error(`${label} is missing: ${digest}`)
  return artifact
}

function publicationCheckpoint(publication: MarketplacePublicationV1 | undefined) {
  if (!publication) return null
  if (!publication.auditHead || publication.auditSequence === 0) {
    throw new Error('Marketplace publication does not have an audit checkpoint')
  }
  return Object.freeze({
    sequence: publication.sequence,
    snapshotDigest: publication.snapshotDigest,
    snapshotArtifactDigest: publication.snapshotArtifactDigest,
    auditSequence: publication.auditSequence,
    auditHead: publication.auditHead
  })
}

type ParsedMarketplaceSnapshot = ReturnType<typeof parseMarketplaceSnapshotBytes>
type VerifiedMarketplaceSnapshot = Awaited<ReturnType<typeof verifyMarketplaceSnapshot>>

async function verifyPublicationSnapshot(
  publication: MarketplacePublicationV1,
  artifacts: MarketplaceArtifactStore,
  marketplaceId: string,
  root: MarketplaceBackupRootTrust
): Promise<{
  snapshot: ParsedMarketplaceSnapshot
  verifiedSnapshot: VerifiedMarketplaceSnapshot
}> {
  if (!publication.auditHead || publication.auditSequence === 0) {
    throw new Error(`Marketplace publication ${publication.sequence} has no audit anchor`)
  }
  const snapshotArtifact = await requiredArtifact(
    artifacts,
    publication.snapshotArtifactDigest,
    `Marketplace publication ${publication.sequence} snapshot artifact`
  )
  const snapshot = parseMarketplaceSnapshotBytes(snapshotArtifact.bytes)
  if (
    snapshot.integrity.digest !== publication.snapshotDigest ||
    snapshot.sequence !== publication.sequence ||
    snapshot.generatedAt !== publication.publishedAt ||
    snapshot.auditHead.sequence !== publication.auditSequence ||
    snapshot.auditHead.headDigest !== publication.auditHead
  ) {
    throw new Error(
      `Marketplace publication ${publication.sequence} snapshot anchor is inconsistent`
    )
  }
  const verifiedSnapshot = await verifyMarketplaceSnapshot(snapshot, root.publicKey, {
    expectedMarketplaceId: marketplaceId,
    expectedKeyId: root.keyId,
    now: snapshot.generatedAt
  })
  if (verifiedSnapshot.verifiedDigest !== publication.snapshotDigest) {
    throw new Error(
      `Marketplace publication ${publication.sequence} snapshot digest is inconsistent`
    )
  }
  return { snapshot, verifiedSnapshot }
}

async function verifyPublicationCatalogs(
  publication: MarketplacePublicationV1,
  artifacts: MarketplaceArtifactStore,
  publicBase: string,
  snapshot: ParsedMarketplaceSnapshot,
  verifiedSnapshot: VerifiedMarketplaceSnapshot
): Promise<void> {
  const references = new Map(snapshot.catalogs.map((catalog) => [catalog.channel, catalog]))
  if (references.size !== publication.catalogs.length) {
    throw new Error(`Marketplace publication ${publication.sequence} catalog set is inconsistent`)
  }
  for (const catalogRecord of publication.catalogs) {
    const reference = references.get(catalogRecord.channel)
    if (
      !reference ||
      reference.digest !== catalogRecord.catalogDigest ||
      ownedArtifactDigest(
        reference.url,
        publicBase,
        `Marketplace publication ${publication.sequence} ${catalogRecord.channel} catalog`
      ) !== catalogRecord.artifactDigest
    ) {
      throw new Error(
        `Marketplace publication ${publication.sequence} ${catalogRecord.channel} catalog anchor is inconsistent`
      )
    }
    const artifact = await requiredArtifact(
      artifacts,
      catalogRecord.artifactDigest,
      `Marketplace publication ${publication.sequence} ${catalogRecord.channel} catalog artifact`
    )
    const catalog = parsePluginCatalogBytes(artifact.bytes)
    if (catalog.integrity.digest !== catalogRecord.catalogDigest) {
      throw new Error(
        `Marketplace publication ${publication.sequence} ${catalogRecord.channel} catalog digest is inconsistent`
      )
    }
    await verifyMarketplaceCatalog(catalog, {
      snapshot: verifiedSnapshot,
      channel: catalogRecord.channel,
      now: snapshot.generatedAt
    })
  }
}

async function verifyPublicationRuntime(
  publication: MarketplacePublicationV1,
  artifacts: MarketplaceArtifactStore,
  publicBase: string,
  snapshot: ParsedMarketplaceSnapshot,
  verifiedSnapshot: VerifiedMarketplaceSnapshot
): Promise<void> {
  const hasRuntime = publication.runtimeIndexArtifactDigest !== null
  if (hasRuntime !== Boolean(snapshot.runtimeIndex)) {
    throw new Error(
      `Marketplace publication ${publication.sequence} runtime index set is inconsistent`
    )
  }
  if (
    snapshot.runtimeIndex &&
    publication.runtimeIndexArtifactDigest &&
    publication.runtimeIndexDigest
  ) {
    if (
      snapshot.runtimeIndex.digest !== publication.runtimeIndexDigest ||
      ownedArtifactDigest(
        snapshot.runtimeIndex.url,
        publicBase,
        `Marketplace publication ${publication.sequence} runtime index`
      ) !== publication.runtimeIndexArtifactDigest
    ) {
      throw new Error(
        `Marketplace publication ${publication.sequence} runtime index anchor is inconsistent`
      )
    }
    const artifact = await requiredArtifact(
      artifacts,
      publication.runtimeIndexArtifactDigest,
      `Marketplace publication ${publication.sequence} runtime index artifact`
    )
    const index = parsePluginRuntimeIndexBytes(artifact.bytes)
    if (index.integrity.digest !== publication.runtimeIndexDigest) {
      throw new Error(
        `Marketplace publication ${publication.sequence} runtime digest is inconsistent`
      )
    }
    await verifyMarketplaceRuntimeIndex(index, {
      snapshot: verifiedSnapshot,
      now: snapshot.generatedAt
    })
  }
}

async function verifyPublicationAudit(
  state: MarketplaceStateV1,
  publication: MarketplacePublicationV1
): Promise<void> {
  if (!publication.auditHead) {
    throw new Error(`Marketplace publication ${publication.sequence} has no audit anchor`)
  }
  const event = state.auditEvents.at(publication.auditSequence)
  const expectedPayloadDigest = await marketplaceAuditPayloadDigest({
    auditHead: publication.auditHead,
    auditSequence: publication.auditSequence,
    sequence: publication.sequence,
    snapshotArtifactDigest: publication.snapshotArtifactDigest,
    snapshotDigest: publication.snapshotDigest
  })
  if (
    !event ||
    event.sequence !== publication.auditSequence + 1 ||
    event.previousHash !== publication.auditHead ||
    event.action !== 'publication.recorded' ||
    event.subject !== 'publication:global' ||
    event.time !== publication.publishedAt ||
    event.payloadDigest !== expectedPayloadDigest
  ) {
    throw new Error(
      `Marketplace publication ${publication.sequence} audit event anchor is inconsistent`
    )
  }
}

async function verifyPublication(
  state: MarketplaceStateV1,
  publication: MarketplacePublicationV1,
  artifacts: MarketplaceArtifactStore,
  marketplaceId: string,
  publicBase: string,
  root: MarketplaceBackupRootTrust
): Promise<string> {
  const { snapshot, verifiedSnapshot } = await verifyPublicationSnapshot(
    publication,
    artifacts,
    marketplaceId,
    root
  )
  await verifyPublicationCatalogs(publication, artifacts, publicBase, snapshot, verifiedSnapshot)
  await verifyPublicationRuntime(publication, artifacts, publicBase, snapshot, verifiedSnapshot)
  await verifyPublicationAudit(state, publication)
  return snapshot.expiresAt
}

export async function verifyMarketplaceRecoveryState(
  stateValue: unknown,
  artifacts: MarketplaceArtifactStore,
  options: MarketplaceRecoveryVerificationOptions
): Promise<VerifiedRecoveryState> {
  const state = parseMarketplaceState(stateValue)
  await verifyMarketplaceAuditChain(state.auditEvents)
  for (const key of state.publisherKeys) await importEd25519PublicKeyPem(key.publicKeyPem)
  const marketplaceId = identity(options.marketplaceId, 'Marketplace recovery marketplace id')
  const publicBase = publicBaseURL(options.publicBaseUrl)
  const root = parseRootTrust(options.root)
  const expirations: string[] = []
  for (const publication of state.publications) {
    expirations.push(
      await verifyPublication(state, publication, artifacts, marketplaceId, publicBase, root)
    )
  }
  const entries: MarketplaceBackupArtifactV1[] = []
  for (const digest of marketplaceReferencedArtifactDigests(state, publicBase)) {
    const artifact = await requiredArtifact(artifacts, digest, 'Marketplace referenced artifact')
    entries.push(Object.freeze({ digest, byteLength: artifact.byteLength }))
  }
  const now = Date.parse(currentTime(options.now))
  const latestExpiry = expirations.at(-1)
  return Object.freeze({
    state,
    artifacts: Object.freeze(entries),
    stale: latestExpiry === undefined ? false : Date.parse(latestExpiry) < now
  })
}

async function boundedRegularFile(
  path: string,
  maximum: number,
  label: string
): Promise<Uint8Array> {
  if (!constants.O_NOFOLLOW) {
    throw new Error(`${label} cannot be read safely because O_NOFOLLOW is unavailable`)
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat({ bigint: true })
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(maximum)
    ) {
      throw new Error(
        `${label} must be a single-link non-symlink regular file within its byte limit`
      )
    }
    const bytes = new Uint8Array(await handle.readFile())
    const after = await handle.stat({ bigint: true })
    if (
      bytes.byteLength !== Number(before.size) ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== before.nlink ||
      after.size !== before.size
    ) {
      throw new Error(`${label} changed while it was read`)
    }
    return bytes
  } finally {
    await handle.close()
  }
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`)
  }
}

async function assertCompleteGeneration(path: string, label: string): Promise<void> {
  const canonical = await realpath(path)
  const markers = new Set(
    [path, canonical].flatMap((generation) => [
      marketplaceGenerationReservationPath(generation),
      join(generation, MARKETPLACE_INCOMPLETE_GENERATION_FILE)
    ])
  )
  for (const marker of markers) {
    try {
      await lstat(marker)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new Error(`${label} is incomplete or reserved`)
  }
}

async function boundedDirectoryEntries(
  path: string,
  maximum: number,
  overflowMessage: string
): Promise<Dirent[]> {
  const directory = await opendir(path)
  const entries: Dirent[] = []
  try {
    let entry = await directory.read()
    while (entry !== null) {
      if (entries.length >= maximum) throw new Error(overflowMessage)
      entries.push(entry)
      entry = await directory.read()
    }
    return entries
  } finally {
    await directory.close()
  }
}

async function readBackupState(databaseBytes: Uint8Array): Promise<MarketplaceStateV1> {
  const database = Database.deserialize(databaseBytes, { readonly: true, strict: true })
  try {
    const quickCheck = database
      .query<Record<string, string>, []>('PRAGMA quick_check')
      .all()
      .flatMap((row) => Object.values(row))
    if (quickCheck.length !== 1 || quickCheck[0] !== 'ok') {
      throw new Error('Marketplace backup SQLite quick_check failed')
    }
    assertMarketplaceSqliteSchema(database, 'Marketplace backup SQLite')
    const stateRowCounts = database
      .query<{ count: number; expected: number }, []>(
        'SELECT COUNT(*) AS count, SUM(CASE WHEN id = 1 THEN 1 ELSE 0 END) AS expected FROM marketplace_state'
      )
      .get()
    if (stateRowCounts?.count !== 1 || stateRowCounts.expected !== 1) {
      throw new Error('Marketplace backup SQLite must contain exactly one state row')
    }
    // Force schema validation for the replay table even when it currently has no rows.
    database.query('SELECT publisher_id, nonce, expires_at FROM marketplace_nonces LIMIT 1').get()
    const row = database
      .query<{ schema_version: number; state_json: string }, []>(
        'SELECT schema_version, state_json FROM marketplace_state WHERE id = 1'
      )
      .get()
    if (!row || row.schema_version !== MARKETPLACE_SQLITE_SCHEMA_VERSION) {
      throw new Error('Marketplace backup SQLite schema version is invalid')
    }
    return parseMarketplaceState(JSON.parse(row.state_json))
  } finally {
    database.close(false)
  }
}

function fileArtifactStore(root: string): MarketplaceArtifactStore {
  return {
    async put() {
      throw new Error('Marketplace backup artifact store is read-only')
    },
    async get(digestValue) {
      const digest = parseSha256Base64URL(digestValue, 'Marketplace backup artifact digest')
      try {
        const bytes = await boundedRegularFile(
          join(root, `${digest}.blob`),
          8 * 1024 * 1024,
          `Marketplace backup artifact ${digest}`
        )
        return inspectMarketplaceArtifact(bytes, digest)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    }
  }
}

async function readManifest(source: string): Promise<MarketplaceBackupManifestV1> {
  const bytes = await boundedRegularFile(
    join(source, MANIFEST_FILE),
    MARKETPLACE_BACKUP_LIMITS.maxManifestBytes,
    'Marketplace backup manifest'
  )
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new Error('Marketplace backup manifest must contain canonical UTF-8 JSON')
  }
  const manifest = parseMarketplaceBackupManifest(value)
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes(manifest)))) {
    throw new Error('Marketplace backup manifest is not canonical')
  }
  return manifest
}

async function assertExactBackupLayout(
  source: string,
  manifest: MarketplaceBackupManifestV1
): Promise<void> {
  await assertDirectory(source, 'Marketplace backup source')
  const rootEntries = await boundedDirectoryEntries(
    source,
    ROOT_ENTRIES.length,
    'Marketplace backup contains unexpected root entries'
  )
  if (
    rootEntries.some((entry) => entry.isSymbolicLink()) ||
    rootEntries
      .map(({ name }) => name)
      .sort(compareText)
      .join('\n') !== ROOT_ENTRIES.join('\n')
  ) {
    throw new Error('Marketplace backup contains unexpected root entries')
  }
  const artifactRoot = join(source, ARTIFACT_DIRECTORY)
  await assertDirectory(artifactRoot, 'Marketplace backup artifact directory')
  const artifactEntries = await boundedDirectoryEntries(
    artifactRoot,
    manifest.artifacts.length,
    'Marketplace backup contains an unexpected artifact or is missing an artifact'
  )
  const expected = manifest.artifacts.map(({ digest }) => `${digest}.blob`)
  const actual = artifactEntries.map(({ name }) => name).sort(compareText)
  if (
    artifactEntries.some((entry) => entry.isSymbolicLink() || !entry.isFile()) ||
    actual.join('\n') !== expected.join('\n')
  ) {
    throw new Error('Marketplace backup contains an unexpected artifact or is missing an artifact')
  }
}

export async function verifyMarketplaceBackup(
  options: VerifyMarketplaceBackupOptions
): Promise<VerifiedMarketplaceBackup> {
  const source = resolve(options.source)
  const marketplaceId = identity(options.marketplaceId, 'Marketplace backup marketplace id')
  const expectedPublicBaseURL = publicBaseURL(options.publicBaseUrl)
  const root = parseRootTrust(options.root)
  const integrity = parseIntegrityKey(options.integrity)
  await assertDirectory(source, 'Marketplace backup source')
  await assertCompleteGeneration(source, 'Marketplace backup generation')
  const manifest = await readManifest(source)
  if (
    manifest.marketplaceId !== marketplaceId ||
    manifest.publicBaseUrl !== expectedPublicBaseURL ||
    manifest.rootKeyId !== root.keyId ||
    manifest.rootPublicKeyFingerprint !== (await rootFingerprint(root.publicKey))
  ) {
    throw new Error('Marketplace backup authority does not match the expected deployment')
  }
  if (manifest.integrity.keyId !== integrity.keyId) {
    throw new Error('Marketplace backup integrity key id does not match')
  }
  if (
    !safeEqual(
      manifest.integrity.digest,
      manifestHMAC(unsignedManifest(manifest), integrity.secret)
    )
  ) {
    throw new Error('Marketplace backup integrity verification failed')
  }
  await assertExactBackupLayout(source, manifest)
  const databaseBytes = await boundedRegularFile(
    join(source, DATABASE_FILE),
    MARKETPLACE_BACKUP_LIMITS.maxDatabaseBytes,
    'Marketplace backup database'
  )
  if (
    databaseBytes.byteLength !== manifest.database.byteLength ||
    sha256(databaseBytes) !== manifest.database.digest
  ) {
    throw new Error('Marketplace backup database digest or length does not match its manifest')
  }
  const state = await readBackupState(databaseBytes)
  const verified = await verifyMarketplaceRecoveryState(
    state,
    fileArtifactStore(join(source, ARTIFACT_DIRECTORY)),
    options
  )
  if (
    verified.artifacts.length !== manifest.artifacts.length ||
    verified.artifacts.some(
      (artifact, index) =>
        artifact.digest !== manifest.artifacts[index]?.digest ||
        artifact.byteLength !== manifest.artifacts[index]?.byteLength
    )
  ) {
    throw new Error('Marketplace backup artifact closure does not match its manifest')
  }
  const latestPublication = publicationCheckpoint(state.publications.at(-1))
  if (
    manifest.checkpoint.auditSequence !== state.auditEvents.length ||
    manifest.checkpoint.auditHead !== (state.auditEvents.at(-1)?.eventHash ?? null) ||
    JSON.stringify(manifest.checkpoint.latestPublication) !== JSON.stringify(latestPublication)
  ) {
    throw new Error('Marketplace backup checkpoint does not match its verified state')
  }
  return Object.freeze({ manifest, state: verified.state, stale: verified.stale })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function resolveNewGenerationPath(pathValue: string, label: string): Promise<string> {
  const lexicalPath = resolve(pathValue)
  if (await pathExists(lexicalPath)) throw new Error(`${label} already exists`)
  let existingParent = dirname(lexicalPath)
  while (!(await pathExists(existingParent))) {
    const parent = dirname(existingParent)
    if (parent === existingParent) {
      throw new Error(`${label} does not have a resolvable parent directory`)
    }
    existingParent = parent
  }
  const metadata = await lstat(existingParent)
  if (!metadata.isDirectory() && !metadata.isSymbolicLink()) {
    throw new Error(`${label} parent must resolve from a directory`)
  }
  const canonicalParent = await realpath(existingParent)
  const canonicalPath = resolve(canonicalParent, relative(existingParent, lexicalPath))
  if (await pathExists(canonicalPath)) throw new Error(`${label} already exists`)
  return canonicalPath
}

function isWithin(path: string, possibleParent: string): boolean {
  const pathFromParent = relative(possibleParent, path)
  return (
    pathFromParent === '' ||
    (pathFromParent !== '..' &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  )
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

async function durableWrite(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function stageDirectory(destination: string): Promise<{ parent: string; stage: string }> {
  const parent = dirname(destination)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const stage = join(parent, `.${basename(destination)}.${randomUUID()}.tmp`)
  await mkdir(stage, { mode: 0o700 })
  await mkdir(join(stage, ARTIFACT_DIRECTORY), { mode: 0o700 })
  return { parent, stage }
}

interface MarketplaceDirectoryIdentity {
  readonly device: bigint
  readonly inode: bigint
}

async function directoryIdentity(
  path: string,
  label: string
): Promise<MarketplaceDirectoryIdentity> {
  const metadata = await lstat(path, { bigint: true })
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must remain a non-symlink directory`)
  }
  return Object.freeze({ device: metadata.dev, inode: metadata.ino })
}

async function assertDirectoryIdentity(
  path: string,
  expected: MarketplaceDirectoryIdentity,
  label: string
): Promise<void> {
  const current = await directoryIdentity(path, label)
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw new Error(`${label} changed while the generation was promoted`)
  }
}

async function promoteBackupGeneration(
  stage: string,
  destination: string,
  parent: string,
  label: string
): Promise<void> {
  const reservation = marketplaceGenerationReservationPath(destination)
  await durableWrite(reservation, encoder.encode('incomplete\n'))
  await syncDirectory(parent)
  try {
    await mkdir(destination, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`${label} already exists; its reservation was not overwritten`)
    }
    throw error
  }
  const identity = await directoryIdentity(destination, label)
  const marker = join(destination, MARKETPLACE_INCOMPLETE_GENERATION_FILE)
  await durableWrite(marker, encoder.encode('incomplete\n'))
  await syncDirectory(destination)
  await syncDirectory(parent)

  await assertDirectoryIdentity(destination, identity, label)
  await rename(join(stage, ARTIFACT_DIRECTORY), join(destination, ARTIFACT_DIRECTORY))
  await assertDirectoryIdentity(destination, identity, label)
  await rename(join(stage, DATABASE_FILE), join(destination, DATABASE_FILE))
  await assertDirectoryIdentity(destination, identity, label)
  await rename(join(stage, MANIFEST_FILE), join(destination, MANIFEST_FILE))
  await syncDirectory(destination)
  await assertDirectoryIdentity(destination, identity, label)
  await unlink(marker)
  await syncDirectory(destination)
  await unlink(reservation)
  await syncDirectory(parent)
}

async function writeBackupGeneration(
  stage: string,
  databaseBytes: Uint8Array,
  artifacts: readonly MarketplaceBackupArtifactV1[],
  artifactBytes: (digest: string) => Promise<Uint8Array>,
  manifest: MarketplaceBackupManifestV1
): Promise<void> {
  await durableWrite(join(stage, DATABASE_FILE), databaseBytes)
  const artifactRoot = join(stage, ARTIFACT_DIRECTORY)
  for (const artifact of artifacts) {
    const inspected = inspectMarketplaceArtifact(
      await artifactBytes(artifact.digest),
      artifact.digest
    )
    if (inspected.byteLength !== artifact.byteLength) {
      throw new Error(`Marketplace backup artifact ${artifact.digest} changed while copied`)
    }
    await durableWrite(join(artifactRoot, `${artifact.digest}.blob`), inspected.bytes)
  }
  await syncDirectory(artifactRoot)
  await durableWrite(join(stage, MANIFEST_FILE), canonicalBytes(manifest))
  await syncDirectory(stage)
}

export async function createMarketplaceBackup(
  options: CreateMarketplaceBackupOptions
): Promise<MarketplaceBackupManifestV1> {
  const destination = await resolveNewGenerationPath(
    options.destination,
    'Marketplace backup destination'
  )
  const marketplaceId = identity(options.marketplaceId, 'Marketplace backup marketplace id')
  const expectedPublicBaseURL = publicBaseURL(options.publicBaseUrl)
  const root = parseRootTrust(options.root)
  const integrity = parseIntegrityKey(options.integrity)
  const checkpoint = await options.repository.checkpoint()
  const verified = await verifyMarketplaceRecoveryState(checkpoint.state, options.artifacts, {
    marketplaceId,
    publicBaseUrl: expectedPublicBaseURL,
    root,
    ...(options.now ? { now: options.now } : {})
  })
  if (checkpoint.databaseBytes.byteLength > MARKETPLACE_BACKUP_LIMITS.maxDatabaseBytes) {
    throw new RangeError('Marketplace backup database exceeds its byte limit')
  }
  const unsigned = Object.freeze({
    format: MARKETPLACE_BACKUP_FORMAT,
    schemaVersion: MARKETPLACE_BACKUP_SCHEMA_VERSION,
    marketplaceId,
    publicBaseUrl: expectedPublicBaseURL,
    createdAt: currentTime(options.now),
    rootKeyId: root.keyId,
    rootPublicKeyFingerprint: await rootFingerprint(root.publicKey),
    database: Object.freeze({
      path: DATABASE_FILE,
      digest: sha256(checkpoint.databaseBytes),
      byteLength: checkpoint.databaseBytes.byteLength
    }),
    artifacts: verified.artifacts,
    checkpoint: Object.freeze({
      auditSequence: verified.state.auditEvents.length,
      auditHead: verified.state.auditEvents.at(-1)?.eventHash ?? null,
      latestPublication: publicationCheckpoint(verified.state.publications.at(-1))
    })
  }) satisfies Omit<MarketplaceBackupManifestV1, 'integrity'>
  const manifest = parseMarketplaceBackupManifest({
    ...unsigned,
    integrity: {
      algorithm: 'HMAC-SHA256',
      keyId: integrity.keyId,
      digest: manifestHMAC(unsigned, integrity.secret)
    }
  })
  const { parent, stage } = await stageDirectory(destination)
  try {
    await writeBackupGeneration(
      stage,
      checkpoint.databaseBytes,
      verified.artifacts,
      async (digest) =>
        (await requiredArtifact(options.artifacts, digest, 'Marketplace referenced artifact'))
          .bytes,
      manifest
    )
    await verifyMarketplaceBackup({
      source: stage,
      marketplaceId,
      publicBaseUrl: expectedPublicBaseURL,
      root,
      integrity,
      ...(options.now ? { now: options.now } : {})
    })
    await promoteBackupGeneration(stage, destination, parent, 'Marketplace backup destination')
    return manifest
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

export async function prepareMarketplaceRestore(
  options: PrepareMarketplaceRestoreOptions
): Promise<VerifiedMarketplaceBackup> {
  const source = resolve(options.source)
  const lexicalDestination = resolve(options.destination)
  if (pathsOverlap(source, lexicalDestination)) {
    throw new Error(
      'Marketplace restore source and destination must not overlap; in-place restore is forbidden'
    )
  }
  const sourceRealPath = await realpath(source)
  const destination = await resolveNewGenerationPath(
    options.destination,
    'Marketplace restore destination'
  )
  if (pathsOverlap(sourceRealPath, destination)) {
    throw new Error(
      'Marketplace restore source and destination must not overlap; in-place restore is forbidden'
    )
  }
  const verified = await verifyMarketplaceBackup(options)
  const databaseBytes = await boundedRegularFile(
    join(source, DATABASE_FILE),
    MARKETPLACE_BACKUP_LIMITS.maxDatabaseBytes,
    'Marketplace backup database'
  )
  const { parent, stage } = await stageDirectory(destination)
  try {
    await writeBackupGeneration(
      stage,
      databaseBytes,
      verified.manifest.artifacts,
      (digest) =>
        boundedRegularFile(
          join(source, ARTIFACT_DIRECTORY, `${digest}.blob`),
          8 * 1024 * 1024,
          `Marketplace backup artifact ${digest}`
        ),
      verified.manifest
    )
    const staged = await verifyMarketplaceBackup({ ...options, source: stage })
    await promoteBackupGeneration(stage, destination, parent, 'Marketplace restore destination')
    return staged
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
