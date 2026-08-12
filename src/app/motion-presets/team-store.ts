import {
  TEAM_MOTION_LIBRARY_LIMITS,
  acceptTeamMotionLibraryReview,
  createTeamMotionLibraryRegistry,
  exportTeamMotionPublicKey,
  importTeamMotionPublicKey,
  instantiateTeamMotionLibraryEntry,
  parseTeamMotionLibraryRegistryState,
  rejectTeamMotionLibraryReview,
  reviewTeamMotionLibraryUpdate,
  rollbackTeamMotionLibrary,
  verifyTeamMotionLibraryManifest,
  type TeamMotionLibraryInstantiation,
  type TeamMotionNumberToken,
  type TeamMotionLibraryRegistryState,
  type TeamMotionLibrarySource,
  type VerifiedTeamMotionLibrarySnapshot
} from '@open-pencil/scene-graph'

import packageJSON from '../../../package.json'
import {
  browserMotionPresetStorage,
  readMotionPresetStorage,
  writeMotionPresetStorage,
  type MotionPresetKeyValueStorage
} from './storage'

export const TEAM_MOTION_LIBRARY_STORAGE_KEY = 'open-pencil:team-motion-libraries:v1'
export const TEAM_MOTION_LIBRARY_STORE_LIMITS = Object.freeze({
  maxLibraries: 16,
  maxStoredBytes: 16_777_216,
  maxPublicKeyBytes: 32_768
})

const TEAM_MOTION_LIBRARY_STORE_FORMAT = 'openpencil-team-motion-library-settings' as const
const TEAM_MOTION_LIBRARY_STORE_VERSION = 1 as const

export interface StoredTeamMotionLibrary {
  readonly publicKeyPem: string
  readonly registry: TeamMotionLibraryRegistryState
}

export interface TeamMotionLibraryStoreSnapshot {
  readonly libraries: readonly StoredTeamMotionLibrary[]
  readonly ready: boolean
  readonly blocked: boolean
  readonly error: Error | null
}

export interface CreateTeamMotionLibraryStoreOptions {
  readonly storage?: MotionPresetKeyValueStorage | null
  readonly engineVersion?: string
  readonly loadSource?: (source: TeamMotionLibrarySource) => Promise<unknown>
  readonly fetchImpl?: typeof globalThis.fetch
}

type StoreListener = (snapshot: TeamMotionLibraryStoreSnapshot) => void

interface StoredEnvelope {
  format: typeof TEAM_MOTION_LIBRARY_STORE_FORMAT
  version: typeof TEAM_MOTION_LIBRARY_STORE_VERSION
  libraries: Array<{ publicKeyPem: string; registry: unknown }>
}

interface UnknownRecord {
  [key: string]: unknown
}

export function reconcileTeamMotionTokenValues(
  tokens: readonly TeamMotionNumberToken[],
  values: Record<string, number>
): Record<string, number> {
  const allowed = new Set(tokens.map(({ id }) => id))
  for (const id of Object.keys(values)) {
    if (!allowed.has(id)) Reflect.deleteProperty(values, id)
  }
  for (const token of tokens) {
    const current = values[token.id]
    values[token.id] =
      typeof current === 'number' && Number.isFinite(current)
        ? Math.min(token.max, Math.max(token.min, current))
        : token.defaultValue
  }
  return values
}

function jsonBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function exactKeys(value: UnknownRecord, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unknown ${label} field: ${key}`)
  }
}

function parseEnvelope(json: string): StoredEnvelope {
  if (jsonBytes(json) > TEAM_MOTION_LIBRARY_STORE_LIMITS.maxStoredBytes) {
    throw new Error('Saved team Motion libraries exceed the local storage limit.')
  }
  const value = record(JSON.parse(json), 'Team Motion library settings')
  exactKeys(value, ['format', 'version', 'libraries'], 'team Motion settings')
  if (
    value.format !== TEAM_MOTION_LIBRARY_STORE_FORMAT ||
    value.version !== TEAM_MOTION_LIBRARY_STORE_VERSION
  ) {
    throw new Error('Unsupported team Motion library settings format.')
  }
  if (!Array.isArray(value.libraries)) throw new Error('Team Motion libraries must be an array.')
  if (value.libraries.length > TEAM_MOTION_LIBRARY_STORE_LIMITS.maxLibraries) {
    throw new Error('Too many team Motion libraries are stored.')
  }
  return {
    format: TEAM_MOTION_LIBRARY_STORE_FORMAT,
    version: TEAM_MOTION_LIBRARY_STORE_VERSION,
    libraries: value.libraries.map((candidate, index) => {
      const entry = record(candidate, `Team Motion library ${index}`)
      exactKeys(entry, ['publicKeyPem', 'registry'], 'team Motion library')
      if (
        typeof entry.publicKeyPem !== 'string' ||
        jsonBytes(entry.publicKeyPem) > TEAM_MOTION_LIBRARY_STORE_LIMITS.maxPublicKeyBytes
      ) {
        throw new Error('Team Motion public key must be bounded PEM text.')
      }
      return { publicKeyPem: entry.publicKeyPem, registry: entry.registry }
    })
  }
}

async function verifyRegistry(
  value: unknown,
  publicKeyPem: string,
  engineVersion: string
): Promise<TeamMotionLibraryRegistryState> {
  const state = parseTeamMotionLibraryRegistryState(value)
  const publicKey = await importTeamMotionPublicKey(publicKeyPem)
  const expectedKeyId = state.accepted.manifest.publisher.keyId
  const verify = async (snapshot: VerifiedTeamMotionLibrarySnapshot) => {
    const verified = await verifyTeamMotionLibraryManifest(snapshot.manifest, publicKey, {
      expectedKeyId,
      engineVersion
    })
    if (
      verified.verifiedDigest !== snapshot.verifiedDigest ||
      verified.verifiedKeyId !== snapshot.verifiedKeyId
    ) {
      throw new Error('Verified Team Motion registry snapshot metadata does not match manifest')
    }
  }
  await verify(state.accepted)
  await Promise.all(state.history.map(verify))
  if (state.pending) await verify(state.pending.candidate)
  return state
}

async function defaultLoadSource(
  source: TeamMotionLibrarySource,
  fetchImpl: typeof globalThis.fetch
): Promise<unknown> {
  if (source.kind !== 'url') {
    throw new Error('Paste the next signed manifest to review file-based team libraries.')
  }
  const sourceURL = new URL(source.ref)
  if (sourceURL.protocol !== 'https:') {
    throw new Error('Team Motion URL sources must use HTTPS.')
  }
  const response = await fetchImpl(sourceURL, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`Team Motion source returned HTTP ${response.status}.`)
  if (response.url && new URL(response.url).protocol !== 'https:') {
    throw new Error('Team Motion source redirects must remain on HTTPS.')
  }
  const announced = Number(response.headers.get('content-length'))
  if (Number.isFinite(announced) && announced > TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes) {
    throw new Error('Team Motion source exceeds the manifest size limit.')
  }
  const chunks: Uint8Array[] = []
  let byteLength = 0
  if (response.body) {
    const reader = response.body.getReader()
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      byteLength += result.value.byteLength
      if (byteLength > TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes) {
        await reader.cancel()
        throw new Error('Team Motion source exceeds the manifest size limit.')
      }
      chunks.push(result.value)
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer())
    byteLength = bytes.byteLength
    chunks.push(bytes)
  }
  if (byteLength > TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes) {
    throw new Error('Team Motion source exceeds the manifest size limit.')
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

function cloneLibrary(value: StoredTeamMotionLibrary): StoredTeamMotionLibrary {
  return {
    publicKeyPem: value.publicKeyPem,
    registry: parseTeamMotionLibraryRegistryState(value.registry)
  }
}

export function createTeamMotionLibraryStore(options: CreateTeamMotionLibraryStoreOptions = {}) {
  const storage = options.storage === undefined ? browserMotionPresetStorage() : options.storage
  const engineVersion = options.engineVersion ?? packageJSON.version
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const loadSource =
    options.loadSource ??
    ((source: TeamMotionLibrarySource) => defaultLoadSource(source, fetchImpl))
  const listeners = new Set<StoreListener>()
  let libraries: StoredTeamMotionLibrary[] = []
  let ready = false
  let blocked = false
  let error: Error | null = null
  let revision = 0
  let activeLoad: Promise<TeamMotionLibraryStoreSnapshot> | null = null

  function snapshot(): TeamMotionLibraryStoreSnapshot {
    return {
      libraries: libraries.map(cloneLibrary),
      ready,
      blocked,
      error
    }
  }

  function notify(): void {
    const value = snapshot()
    for (const listener of listeners) listener(value)
  }

  function requireWritable(): void {
    if (!ready) throw new Error('Team Motion libraries are still loading.')
    if (blocked) throw new Error('Stored team Motion data is preserved until it can be verified.')
  }

  function requireUsable(): void {
    if (!ready) throw new Error('Team Motion libraries are still loading.')
    if (blocked) throw new Error('Stored team Motion data could not be verified.')
  }

  function assertRevision(expectedRevision: number): void {
    if (revision !== expectedRevision) {
      throw new Error('Team Motion libraries changed during this operation. Please try again.')
    }
  }

  function serialize(next: readonly StoredTeamMotionLibrary[]): string {
    const value = `${JSON.stringify(
      {
        format: TEAM_MOTION_LIBRARY_STORE_FORMAT,
        version: TEAM_MOTION_LIBRARY_STORE_VERSION,
        libraries: next
      },
      null,
      2
    )}\n`
    if (jsonBytes(value) > TEAM_MOTION_LIBRARY_STORE_LIMITS.maxStoredBytes) {
      throw new Error('Team Motion libraries exceed the local storage limit.')
    }
    return value
  }

  function commit(next: readonly StoredTeamMotionLibrary[], expectedRevision = revision): void {
    requireWritable()
    assertRevision(expectedRevision)
    const writeError = writeMotionPresetStorage(
      storage,
      serialize(next),
      TEAM_MOTION_LIBRARY_STORAGE_KEY
    )
    if (writeError) throw writeError
    libraries = next.map(cloneLibrary)
    revision += 1
    error = null
    notify()
  }

  async function performLoad(): Promise<TeamMotionLibraryStoreSnapshot> {
    const result = readMotionPresetStorage(storage, TEAM_MOTION_LIBRARY_STORAGE_KEY)
    if (result.error) {
      error = result.error
      blocked = true
      ready = true
      revision += 1
      notify()
      return snapshot()
    }
    if (result.value === null) {
      libraries = []
      error = null
      blocked = false
      ready = true
      revision += 1
      notify()
      return snapshot()
    }
    try {
      const envelope = parseEnvelope(result.value)
      const verified = await Promise.all(
        envelope.libraries.map(async (candidate) => ({
          publicKeyPem: await exportTeamMotionPublicKey(
            await importTeamMotionPublicKey(candidate.publicKeyPem)
          ),
          registry: await verifyRegistry(candidate.registry, candidate.publicKeyPem, engineVersion)
        }))
      )
      const ids = new Set<string>()
      for (const library of verified) {
        const id = library.registry.accepted.manifest.library.id
        if (ids.has(id)) throw new Error(`Duplicate team Motion library: ${id}`)
        ids.add(id)
      }
      libraries = verified
      error = null
      blocked = false
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause))
      blocked = true
    }
    ready = true
    revision += 1
    notify()
    return snapshot()
  }

  function load(): Promise<TeamMotionLibraryStoreSnapshot> {
    if (activeLoad) return activeLoad
    ready = false
    const pending = Promise.resolve()
      .then(performLoad)
      .finally(() => {
        activeLoad = null
      })
    activeLoad = pending
    notify()
    return pending
  }

  function findLibrary(id: string): StoredTeamMotionLibrary {
    const library = libraries.find(
      (candidate) => candidate.registry.accepted.manifest.library.id === id
    )
    if (!library) throw new Error(`Unknown team Motion library: ${id}`)
    return library
  }

  async function stageManifest(
    manifestJSON: string,
    publicKeyPem: string
  ): Promise<TeamMotionLibraryRegistryState> {
    requireWritable()
    const expectedRevision = revision
    if (jsonBytes(manifestJSON) > TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes) {
      throw new Error('Team Motion manifest exceeds the size limit.')
    }
    const publicKey = await importTeamMotionPublicKey(publicKeyPem)
    const canonicalKey = await exportTeamMotionPublicKey(publicKey)
    const rawManifest: unknown = JSON.parse(manifestJSON)
    const candidate = await verifyTeamMotionLibraryManifest(rawManifest, publicKey, {
      engineVersion
    })
    const id = candidate.manifest.library.id
    const current = libraries.find(
      (library) => library.registry.accepted.manifest.library.id === id
    )
    let registry: TeamMotionLibraryRegistryState
    if (!current) {
      if (libraries.length >= TEAM_MOTION_LIBRARY_STORE_LIMITS.maxLibraries) {
        throw new Error('Team Motion library count limit exceeded.')
      }
      registry = createTeamMotionLibraryRegistry(candidate)
      commit([...libraries, { publicKeyPem: canonicalKey, registry }], expectedRevision)
      return registry
    }
    if (current.publicKeyPem !== canonicalKey) {
      throw new Error('Team Motion signing key rotation requires an explicit new library identity.')
    }
    await verifyRegistry(current.registry, current.publicKeyPem, engineVersion)
    registry = reviewTeamMotionLibraryUpdate(current.registry, candidate)
    commit(
      libraries.map((library) =>
        library.registry.accepted.manifest.library.id === id ? { ...library, registry } : library
      ),
      expectedRevision
    )
    return registry
  }

  async function checkSource(id: string): Promise<TeamMotionLibraryRegistryState> {
    requireWritable()
    const expectedRevision = revision
    const current = findLibrary(id)
    const manifest = await loadSource(current.registry.accepted.manifest.source)
    assertRevision(expectedRevision)
    return stageManifest(JSON.stringify(manifest), current.publicKeyPem)
  }

  async function mutateVerified(
    id: string,
    mutate: (state: TeamMotionLibraryRegistryState) => TeamMotionLibraryRegistryState
  ): Promise<TeamMotionLibraryRegistryState> {
    requireWritable()
    const expectedRevision = revision
    const current = findLibrary(id)
    const verified = await verifyRegistry(current.registry, current.publicKeyPem, engineVersion)
    const registry = mutate(verified)
    commit(
      libraries.map((library) =>
        library.registry.accepted.manifest.library.id === id ? { ...library, registry } : library
      ),
      expectedRevision
    )
    return registry
  }

  function instantiate(
    libraryId: string,
    entryId: string,
    input: Parameters<typeof instantiateTeamMotionLibraryEntry>[2] = {}
  ): TeamMotionLibraryInstantiation {
    requireUsable()
    return instantiateTeamMotionLibraryEntry(
      findLibrary(libraryId).registry.accepted,
      entryId,
      input
    )
  }

  function remove(id: string): void {
    requireWritable()
    findLibrary(id)
    commit(libraries.filter((library) => library.registry.accepted.manifest.library.id !== id))
  }

  function subscribe(listener: StoreListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    snapshot,
    subscribe,
    load,
    stageManifest,
    checkSource,
    accept: (id: string) => mutateVerified(id, acceptTeamMotionLibraryReview),
    reject: (id: string) => mutateVerified(id, rejectTeamMotionLibraryReview),
    rollback: (id: string, digest: string) =>
      mutateVerified(id, (state) => rollbackTeamMotionLibrary(state, digest)),
    instantiate,
    remove
  }
}
