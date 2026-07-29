import {
  MOTION_PRESET_IDS,
  SHARED_MOTION_PRESET_LIMITS,
  USER_MOTION_PRESET_FORMAT,
  USER_MOTION_PRESET_LIMITS,
  USER_MOTION_PRESET_SCHEMA_VERSION,
  acceptSharedMotionPresetLibraryUpdate,
  checkSharedMotionPresetLibraryUpdate,
  cloneMotionSpec,
  createUserMotionPreset,
  createUserMotionPresetLibrary,
  instantiateSharedMotionPreset,
  instantiateUserMotionPreset,
  isMotionPresetId,
  mergeUserMotionPresetLibraries,
  noteSharedMotionPresetLibraryUpdate,
  parseSharedMotionPresetLibraryState,
  parseSharedMotionPresetManifest,
  parseUserMotionPresetLibrary,
  removeUserMotionPreset,
  renameUserMotionPreset,
  serializeUserMotionPresetLibrary,
  userMotionPresetNameKey,
  updateUserMotionPreset,
  type MotionPresetMergePolicy,
  type MotionSpec,
  type SharedMotionPresetLibraryState,
  type SharedMotionPresetUpdateCheck,
  type UserMotionPreset,
  type UserMotionPresetCategory,
  type UserMotionPresetLibrary
} from '@open-pencil/scene-graph'

import {
  browserMotionPresetStorage,
  readMotionPresetStorage,
  removeMotionPresetStorage,
  writeMotionPresetStorage,
  type MotionPresetKeyValueStorage
} from './storage'
import {
  isUserMotionPresetKey,
  motionUserPresetIdFromKey,
  userMotionPresetKey,
  type MotionPresetLibraryKey
} from './types'

export type MotionPresetLibraryStoreErrorCode =
  | 'read-failed'
  | 'invalid-json'
  | 'future-schema'
  | 'invalid-library'
  | 'write-failed'
  | 'blocked'
  | 'unknown-preset'
  | 'unknown-library'
  | 'duplicate-name'

export class MotionPresetLibraryStoreError extends Error {
  constructor(
    readonly code: MotionPresetLibraryStoreErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MotionPresetLibraryStoreError'
  }
}

export interface MotionPresetLibraryStoreSnapshot {
  readonly library: UserMotionPresetLibrary
  readonly sharedLibraries: readonly SharedMotionPresetLibraryState[]
  readonly favorites: readonly MotionPresetLibraryKey[]
  readonly blocked: boolean
  readonly error: MotionPresetLibraryStoreError | null
}

export interface CreateLocalMotionPresetInput {
  readonly id?: string
  readonly name: string
  readonly description?: string
  readonly category?: UserMotionPresetCategory
  readonly motion: MotionSpec
}

export interface UpdateLocalMotionPresetInput {
  readonly description?: string | null
  readonly category?: UserMotionPresetCategory
  readonly motion?: MotionSpec
}

export interface EditLocalMotionPresetInput {
  readonly name: string
  readonly description?: string | null
  readonly category: UserMotionPresetCategory
  readonly motion?: MotionSpec
}

export interface CreateMotionPresetLibraryStoreOptions {
  readonly storage?: MotionPresetKeyValueStorage | null
  readonly createId?: () => string
}

interface ParsedStoredLibrary {
  library: UserMotionPresetLibrary
  sharedLibraries: SharedMotionPresetLibraryState[]
  favorites: MotionPresetLibraryKey[]
}

interface UnknownRecord {
  [key: string]: unknown
}

type StoreListener = (snapshot: MotionPresetLibraryStoreSnapshot) => void

const LOCAL_MOTION_PRESET_STORAGE_FORMAT = 'openpencil-motion-preset-settings' as const
const LOCAL_MOTION_PRESET_STORAGE_SCHEMA_VERSION = 2 as const
const LEGACY_LOCAL_MOTION_PRESET_STORAGE_MAX_BYTES = USER_MOTION_PRESET_LIMITS.maxJsonBytes + 16_384
const LOCAL_MOTION_PRESET_STORAGE_MAX_BYTES =
  USER_MOTION_PRESET_LIMITS.maxJsonBytes +
  SHARED_MOTION_PRESET_LIMITS.maxAggregateJsonBytes +
  32_768
const LOCAL_MOTION_PRESET_MAX_FAVORITES =
  MOTION_PRESET_IDS.length + USER_MOTION_PRESET_LIMITS.maxPresets
const LOCAL_MOTION_PRESET_MAX_FAVORITE_KEY_LENGTH = 80
const PORTABLE_LIBRARY_KEYS = ['format', 'schemaVersion', 'presets', 'favorites'] as const
const LOCAL_LIBRARY_V1_KEYS = ['format', 'schemaVersion', 'library', 'favorites'] as const
const LOCAL_LIBRARY_V2_KEYS = [
  'format',
  'schemaVersion',
  'library',
  'favorites',
  'sharedLibraries'
] as const

function objectRecord(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? (value as UnknownRecord) : null
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[],
  message: string
): UnknownRecord {
  const record = objectRecord(value)
  if (!record) throw storeError('invalid-library', message)
  for (const key of Object.keys(record)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw storeError('invalid-library', `Unsafe motion preset library field: ${key}`)
    }
    if (!allowedKeys.includes(key)) {
      throw storeError('invalid-library', `Unknown motion preset library field: ${key}`)
    }
  }
  return record
}

function storeError(
  code: MotionPresetLibraryStoreErrorCode,
  message: string,
  cause?: unknown
): MotionPresetLibraryStoreError {
  return new MotionPresetLibraryStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause }
  )
}

function asStoreError(error: unknown): MotionPresetLibraryStoreError {
  return error instanceof MotionPresetLibraryStoreError
    ? error
    : storeError(
        'invalid-library',
        error instanceof Error ? error.message : 'Invalid motion preset library.',
        error
      )
}

function userPresetById(
  library: UserMotionPresetLibrary,
  id: string
): UserMotionPreset | undefined {
  return library.presets.find((preset) => preset.id === id)
}

function sharedLibraryById(
  libraries: readonly SharedMotionPresetLibraryState[],
  id: string
): SharedMotionPresetLibraryState | undefined {
  return libraries.find((entry) => entry.manifest.library.id === id)
}

function parseSharedLibraries(value: unknown): SharedMotionPresetLibraryState[] {
  const rawLibraries = value ?? []
  if (!Array.isArray(rawLibraries)) {
    throw storeError('invalid-library', 'Shared motion preset libraries must be an array.')
  }
  if (rawLibraries.length > SHARED_MOTION_PRESET_LIMITS.maxLibraries) {
    throw storeError(
      'invalid-library',
      `At most ${SHARED_MOTION_PRESET_LIMITS.maxLibraries} shared motion preset libraries are supported.`
    )
  }
  let libraries: SharedMotionPresetLibraryState[]
  try {
    libraries = rawLibraries.map(parseSharedMotionPresetLibraryState)
  } catch (cause) {
    throw storeError(
      'invalid-library',
      cause instanceof Error ? cause.message : 'Invalid shared motion preset library.',
      cause
    )
  }
  const ids = new Set<string>()
  for (const entry of libraries) {
    const id = entry.manifest.library.id
    if (ids.has(id)) {
      throw storeError('invalid-library', `Duplicate shared motion preset library: ${id}`)
    }
    ids.add(id)
  }
  const bytes = new TextEncoder().encode(JSON.stringify(libraries)).byteLength
  if (bytes > SHARED_MOTION_PRESET_LIMITS.maxAggregateJsonBytes) {
    throw storeError(
      'invalid-library',
      `Shared motion preset data may not exceed ${SHARED_MOTION_PRESET_LIMITS.maxAggregateJsonBytes} bytes.`
    )
  }
  return libraries
}

function portableMotionSnapshot(motion: MotionSpec): MotionSpec {
  const snapshot = cloneMotionSpec(motion)
  delete snapshot.preset
  return snapshot
}

function favoriteSortKey(key: MotionPresetLibraryKey): string {
  return key.startsWith('builtin:') ? `0:${key}` : `1:${key}`
}

function sortedFavorites(values: Iterable<MotionPresetLibraryKey>): MotionPresetLibraryKey[] {
  return [...new Set(values)].sort((left, right) =>
    favoriteSortKey(left).localeCompare(favoriteSortKey(right), 'en')
  )
}

function isKnownFavoriteKey(key: string, library: UserMotionPresetLibrary): boolean {
  if (key.startsWith('builtin:')) return isMotionPresetId(key.slice('builtin:'.length))
  return (
    isUserMotionPresetKey(key) && Boolean(userPresetById(library, motionUserPresetIdFromKey(key)))
  )
}

function assertLocalJsonSize(json: string): void {
  if (new TextEncoder().encode(json).byteLength > LOCAL_MOTION_PRESET_STORAGE_MAX_BYTES) {
    throw storeError(
      'invalid-library',
      `Motion preset data may not exceed ${LOCAL_MOTION_PRESET_STORAGE_MAX_BYTES} bytes.`
    )
  }
}

function localJsonByteLength(json: string): number {
  return new TextEncoder().encode(json).byteLength
}

function assertLegacyLocalJsonSize(json: string): void {
  if (localJsonByteLength(json) > LEGACY_LOCAL_MOTION_PRESET_STORAGE_MAX_BYTES) {
    throw storeError(
      'invalid-library',
      `Motion preset data may not exceed ${LEGACY_LOCAL_MOTION_PRESET_STORAGE_MAX_BYTES} bytes.`
    )
  }
}

function parseFavorites(
  value: unknown,
  library: UserMotionPresetLibrary
): MotionPresetLibraryKey[] {
  const rawFavorites = value ?? []
  if (!Array.isArray(rawFavorites) || !rawFavorites.every((key) => typeof key === 'string')) {
    throw storeError('invalid-library', 'Motion preset favorites must be an array of keys.')
  }
  if (rawFavorites.length > LOCAL_MOTION_PRESET_MAX_FAVORITES) {
    throw storeError(
      'invalid-library',
      `Motion preset favorites may contain at most ${LOCAL_MOTION_PRESET_MAX_FAVORITES} keys.`
    )
  }
  for (const key of rawFavorites) {
    if (Array.from(key).length > LOCAL_MOTION_PRESET_MAX_FAVORITE_KEY_LENGTH) {
      throw storeError('invalid-library', 'Motion preset favorite keys are too long.')
    }
    if (!isKnownFavoriteKey(key, library)) {
      throw storeError('invalid-library', `Unknown motion preset favorite: ${key}`)
    }
  }
  return sortedFavorites(rawFavorites as MotionPresetLibraryKey[])
}

function storedLibraryKeys(localEnvelope: boolean, localSchema: unknown): readonly string[] {
  if (!localEnvelope) return PORTABLE_LIBRARY_KEYS
  return localSchema === LOCAL_MOTION_PRESET_STORAGE_SCHEMA_VERSION
    ? LOCAL_LIBRARY_V2_KEYS
    : LOCAL_LIBRARY_V1_KEYS
}

function assertStoredLibrarySchema(record: UnknownRecord, localEnvelope: boolean): void {
  if (localEnvelope) {
    if (
      typeof record.schemaVersion === 'number' &&
      record.schemaVersion > LOCAL_MOTION_PRESET_STORAGE_SCHEMA_VERSION
    ) {
      throw storeError(
        'future-schema',
        `This local motion preset data uses unsupported schema version ${record.schemaVersion}.`
      )
    }
    if (
      record.schemaVersion !== 1 &&
      record.schemaVersion !== LOCAL_MOTION_PRESET_STORAGE_SCHEMA_VERSION
    ) {
      throw storeError('invalid-library', 'Unsupported local motion preset data schema.')
    }
    return
  }

  if (record.format !== USER_MOTION_PRESET_FORMAT) {
    throw storeError('invalid-library', 'Unknown motion preset file format.')
  }
  if (
    typeof record.schemaVersion === 'number' &&
    record.schemaVersion > USER_MOTION_PRESET_SCHEMA_VERSION
  ) {
    throw storeError(
      'future-schema',
      `This motion preset library uses unsupported schema version ${record.schemaVersion}.`
    )
  }
}

function parseStoredUserLibrary(
  record: UnknownRecord,
  localEnvelope: boolean
): UserMotionPresetLibrary {
  try {
    return localEnvelope
      ? parseUserMotionPresetLibrary(record.library)
      : parseUserMotionPresetLibrary({
          format: record.format,
          schemaVersion: record.schemaVersion,
          presets: record.presets
        })
  } catch (cause) {
    throw storeError(
      'invalid-library',
      cause instanceof Error ? cause.message : 'The saved motion preset library is invalid.',
      cause
    )
  }
}

function parseStoredLibrary(json: string): ParsedStoredLibrary {
  assertLocalJsonSize(json)
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (cause) {
    assertLegacyLocalJsonSize(json)
    throw storeError('invalid-json', 'The saved motion preset library is not valid JSON.', cause)
  }

  const candidate = objectRecord(value)
  if (!candidate) {
    throw storeError('invalid-library', 'The saved motion preset library must be an object.')
  }

  const localEnvelope = candidate.format === LOCAL_MOTION_PRESET_STORAGE_FORMAT
  const localSchema = localEnvelope ? candidate.schemaVersion : undefined
  if (!localEnvelope || localSchema !== LOCAL_MOTION_PRESET_STORAGE_SCHEMA_VERSION) {
    assertLegacyLocalJsonSize(json)
  }
  const record = strictRecord(
    candidate,
    storedLibraryKeys(localEnvelope, localSchema),
    'The saved motion preset library must be an object.'
  )
  assertStoredLibrarySchema(record, localEnvelope)
  const library = parseStoredUserLibrary(record, localEnvelope)

  return {
    library,
    sharedLibraries:
      localEnvelope && record.schemaVersion === LOCAL_MOTION_PRESET_STORAGE_SCHEMA_VERSION
        ? parseSharedLibraries(record.sharedLibraries)
        : [],
    favorites: parseFavorites(record.favorites, library)
  }
}

export function serializeLocalMotionPresetLibrary(
  library: UserMotionPresetLibrary,
  favorites: readonly MotionPresetLibraryKey[],
  sharedLibraries: readonly SharedMotionPresetLibraryState[] = []
): string {
  const parsedLibrary = parseUserMotionPresetLibrary(library)
  const canonical = JSON.parse(serializeUserMotionPresetLibrary(parsedLibrary)) as UnknownRecord
  const parsedFavorites = parseFavorites([...favorites], parsedLibrary)
  const parsedSharedLibraries = parseSharedLibraries([...sharedLibraries])
  return `${JSON.stringify(
    {
      format: LOCAL_MOTION_PRESET_STORAGE_FORMAT,
      schemaVersion: LOCAL_MOTION_PRESET_STORAGE_SCHEMA_VERSION,
      library: canonical,
      favorites: parsedFavorites,
      sharedLibraries: parsedSharedLibraries
    },
    null,
    2
  )}\n`
}

function defaultCreateId(): string {
  if (!('crypto' in globalThis) || typeof globalThis.crypto.randomUUID !== 'function') {
    throw storeError(
      'invalid-library',
      'Secure random identifiers are unavailable in this runtime.'
    )
  }
  return `user-${globalThis.crypto.randomUUID()}`
}

export function createMotionPresetLibraryStore(
  options: CreateMotionPresetLibraryStoreOptions = {}
) {
  const storage = options.storage === undefined ? browserMotionPresetStorage() : options.storage
  const createId = options.createId ?? defaultCreateId
  const listeners = new Set<StoreListener>()
  let library = createUserMotionPresetLibrary()
  let sharedLibraries: SharedMotionPresetLibraryState[] = []
  let favorites: MotionPresetLibraryKey[] = []
  let blocked = false
  let error: MotionPresetLibraryStoreError | null = null

  function snapshot(): MotionPresetLibraryStoreSnapshot {
    return {
      library: parseUserMotionPresetLibrary(library),
      sharedLibraries: parseSharedLibraries(sharedLibraries),
      favorites: [...favorites],
      blocked,
      error
    }
  }

  function notify(): void {
    const value = snapshot()
    for (const listener of listeners) listener(value)
  }

  function setError(next: MotionPresetLibraryStoreError | null, nextBlocked = blocked): void {
    error = next
    blocked = nextBlocked
    notify()
  }

  function load(): MotionPresetLibraryStoreSnapshot {
    const result = readMotionPresetStorage(storage)
    if (result.error) {
      setError(storeError('read-failed', result.error.message, result.error), true)
      return snapshot()
    }
    if (result.value === null) {
      library = createUserMotionPresetLibrary()
      sharedLibraries = []
      favorites = []
      blocked = false
      error = null
      notify()
      return snapshot()
    }
    try {
      const parsed = parseStoredLibrary(result.value)
      library = parsed.library
      sharedLibraries = parsed.sharedLibraries
      favorites = parsed.favorites
      blocked = false
      error = null
    } catch (cause) {
      error = asStoreError(cause)
      blocked = true
    }
    notify()
    return snapshot()
  }

  function assertWritable(): void {
    if (!blocked) return
    throw storeError(
      'blocked',
      'The local motion preset library is preserved because its stored data could not be read. Import a valid library before editing.'
    )
  }

  function commit(
    nextLibrary: UserMotionPresetLibrary,
    nextFavorites: Iterable<MotionPresetLibraryKey>,
    nextSharedLibraries: readonly SharedMotionPresetLibraryState[] = sharedLibraries
  ): MotionPresetLibraryStoreSnapshot {
    const nextFavoriteList = sortedFavorites(nextFavorites)
    const nextSharedLibraryList = parseSharedLibraries([...nextSharedLibraries])
    const writeError = writeMotionPresetStorage(
      storage,
      serializeLocalMotionPresetLibrary(nextLibrary, nextFavoriteList, nextSharedLibraryList)
    )
    if (writeError) {
      const failure = storeError('write-failed', writeError.message, writeError)
      setError(failure, blocked)
      throw failure
    }
    library = nextLibrary
    sharedLibraries = nextSharedLibraryList
    favorites = nextFavoriteList
    blocked = false
    error = null
    notify()
    return snapshot()
  }

  function assertUniqueName(name: string, exceptId?: string): void {
    const candidate = userMotionPresetNameKey(name)
    if (!candidate) throw storeError('invalid-library', 'Motion preset name cannot be empty.')
    const duplicate = library.presets.some(
      (preset) => preset.id !== exceptId && userMotionPresetNameKey(preset.name) === candidate
    )
    if (duplicate)
      throw storeError('duplicate-name', `A motion preset named “${name.trim()}” already exists.`)
  }

  function requireUserPreset(id: string): UserMotionPreset {
    const preset = userPresetById(library, id)
    if (!preset) throw storeError('unknown-preset', `Unknown user motion preset: ${id}`)
    return preset
  }

  function publicUserPreset(id: string): UserMotionPreset {
    const preset = createUserMotionPresetLibrary([requireUserPreset(id)]).presets[0]
    return preset
  }

  function createPreset(input: CreateLocalMotionPresetInput): UserMotionPreset {
    assertWritable()
    assertUniqueName(input.name)
    const id = input.id ?? createId()
    const nextLibrary = createUserMotionPreset(library, {
      id,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      category: input.category ?? 'custom',
      motion: portableMotionSnapshot(input.motion)
    })
    commit(nextLibrary, favorites)
    return publicUserPreset(id)
  }

  function updatePreset(id: string, updates: UpdateLocalMotionPresetInput): UserMotionPreset {
    assertWritable()
    requireUserPreset(id)
    const nextLibrary = updateUserMotionPreset(library, id, {
      ...updates,
      ...(updates.motion === undefined ? {} : { motion: portableMotionSnapshot(updates.motion) })
    })
    commit(nextLibrary, favorites)
    return publicUserPreset(id)
  }

  function renamePreset(id: string, name: string): UserMotionPreset {
    assertWritable()
    requireUserPreset(id)
    assertUniqueName(name, id)
    const nextLibrary = renameUserMotionPreset(library, id, name)
    commit(nextLibrary, favorites)
    return publicUserPreset(id)
  }

  function editPreset(id: string, updates: EditLocalMotionPresetInput): UserMotionPreset {
    assertWritable()
    requireUserPreset(id)
    assertUniqueName(updates.name, id)
    const renamed = renameUserMotionPreset(library, id, updates.name)
    const nextLibrary = updateUserMotionPreset(renamed, id, {
      description: updates.description ?? null,
      category: updates.category,
      ...(updates.motion === undefined ? {} : { motion: portableMotionSnapshot(updates.motion) })
    })
    commit(nextLibrary, favorites)
    return publicUserPreset(id)
  }

  function deletePreset(id: string): MotionPresetLibraryStoreSnapshot {
    assertWritable()
    requireUserPreset(id)
    const nextLibrary = removeUserMotionPreset(library, id)
    const deletedKey = userMotionPresetKey(id)
    return commit(
      nextLibrary,
      favorites.filter((key) => key !== deletedKey)
    )
  }

  function toggleFavorite(key: MotionPresetLibraryKey): MotionPresetLibraryStoreSnapshot {
    assertWritable()
    if (!isKnownFavoriteKey(key, library)) {
      throw storeError('unknown-preset', `Unknown motion preset favorite: ${key}`)
    }
    const next = new Set(favorites)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return commit(library, next)
  }

  function importJson(
    json: string,
    policy: MotionPresetMergePolicy = 'error'
  ): MotionPresetLibraryStoreSnapshot {
    const incoming = parseStoredLibrary(json)
    const baseLibrary = blocked ? createUserMotionPresetLibrary() : library
    const baseFavorites = blocked ? [] : favorites
    let merged: UserMotionPresetLibrary
    try {
      merged = mergeUserMotionPresetLibraries(baseLibrary, incoming.library, policy)
    } catch (cause) {
      const failure = asStoreError(cause)
      setError(failure, blocked)
      throw failure
    }
    const mergedFavorites = [...baseFavorites, ...incoming.favorites].filter((key) =>
      isKnownFavoriteKey(key, merged)
    )
    return commit(merged, mergedFavorites)
  }

  function exportJson(): string {
    assertWritable()
    return serializeUserMotionPresetLibrary(library)
  }

  function instantiatePreset(id: string): MotionSpec {
    return instantiateUserMotionPreset(requireUserPreset(id))
  }

  function checkSharedLibrary(value: unknown): SharedMotionPresetUpdateCheck {
    const source = parseSharedMotionPresetManifest(value)
    const id = source.library.id
    const current = sharedLibraryById(sharedLibraries, id) ?? null
    const check = checkSharedMotionPresetLibraryUpdate(current, source)
    if (current) {
      const next = sharedLibraries.map((entry) =>
        entry.manifest.library.id === id
          ? noteSharedMotionPresetLibraryUpdate(entry, source)
          : entry
      )
      commit(library, favorites, next)
    }
    return check
  }

  function acceptSharedLibrary(value: unknown): SharedMotionPresetLibraryState {
    assertWritable()
    const source = parseSharedMotionPresetManifest(value)
    const id = source.library.id
    const current = sharedLibraryById(sharedLibraries, id) ?? null
    const accepted = acceptSharedMotionPresetLibraryUpdate(current, source)
    const next = current
      ? sharedLibraries.map((entry) => (entry.manifest.library.id === id ? accepted : entry))
      : [...sharedLibraries, accepted]
    commit(library, favorites, next)
    return parseSharedMotionPresetLibraryState(accepted)
  }

  function removeSharedLibrary(id: string): MotionPresetLibraryStoreSnapshot {
    assertWritable()
    if (!sharedLibraryById(sharedLibraries, id)) {
      throw storeError('unknown-library', `Unknown shared motion preset library: ${id}`)
    }
    return commit(
      library,
      favorites,
      sharedLibraries.filter((entry) => entry.manifest.library.id !== id)
    )
  }

  function instantiateSharedPreset(libraryId: string, presetId: string): MotionSpec {
    const shared = sharedLibraryById(sharedLibraries, libraryId)
    if (!shared) {
      throw storeError('unknown-library', `Unknown shared motion preset library: ${libraryId}`)
    }
    return instantiateSharedMotionPreset(shared, presetId)
  }

  function reset(): MotionPresetLibraryStoreSnapshot {
    const removeError = removeMotionPresetStorage(storage)
    if (removeError) {
      const failure = storeError('write-failed', removeError.message, removeError)
      setError(failure, blocked)
      throw failure
    }
    library = createUserMotionPresetLibrary()
    sharedLibraries = []
    favorites = []
    blocked = false
    error = null
    notify()
    return snapshot()
  }

  function subscribe(listener: StoreListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  load()

  return {
    snapshot,
    subscribe,
    reload: load,
    createPreset,
    updatePreset,
    editPreset,
    renamePreset,
    deletePreset,
    toggleFavorite,
    importJson,
    exportJson,
    instantiatePreset,
    checkSharedLibrary,
    acceptSharedLibrary,
    removeSharedLibrary,
    instantiateSharedPreset,
    reset
  }
}
