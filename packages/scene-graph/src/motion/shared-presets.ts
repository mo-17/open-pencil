import { type MotionSpec, type MotionValidationIssue } from './types'
import {
  USER_MOTION_PRESET_FORMAT,
  USER_MOTION_PRESET_LIMITS,
  USER_MOTION_PRESET_SCHEMA_VERSION,
  UserMotionPresetValidationError,
  instantiateUserMotionPreset,
  parseUserMotionPresetLibrary,
  type UserMotionPreset
} from './user-presets'
import { parseMotionSpec } from './validation'
import {
  assertMotionPortableValue,
  createMotionValidationHelpers,
  MotionIssueValidationError,
  normalizedMotionText,
  parseMotionSourceReference
} from './validation-helpers'

export const SHARED_MOTION_PRESET_MANIFEST_FORMAT = 'openpencil-shared-motion-presets' as const
export const SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION = 1 as const

export const SHARED_MOTION_PRESET_LIMITS = Object.freeze({
  maxLibraries: 8,
  maxAggregateJsonBytes: 4_194_304,
  maxManifestJsonBytes: USER_MOTION_PRESET_LIMITS.maxJsonBytes + 16_384,
  maxIdentifierLength: 64,
  maxNameLength: 128,
  maxSourceRefLength: 2_048,
  maxSourceVersionLength: 64
})

export type SharedMotionPresetSource = { kind: 'file'; ref: string } | { kind: 'url'; ref: string }

export interface SharedMotionPresetIdentity {
  id: string
  name: string
}

export type SharedMotionPresetPublisher = SharedMotionPresetIdentity

export type SharedMotionPresetLibraryProvenance = SharedMotionPresetIdentity

export interface SharedMotionPresetManifest {
  format: typeof SHARED_MOTION_PRESET_MANIFEST_FORMAT
  schemaVersion: typeof SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION
  publisher: SharedMotionPresetPublisher
  library: SharedMotionPresetLibraryProvenance
  source: SharedMotionPresetSource
  readonly: true
  sourceVersion: string
  presets: UserMotionPreset[]
}

/** Accepted shared data plus the newest source version observed by an explicit check. */
export interface SharedMotionPresetLibraryState {
  manifest: SharedMotionPresetManifest
  sourceVersion: string
  updateAvailable: boolean
}

export type SharedMotionPresetUpdateStatus = 'new' | 'up-to-date' | 'update-available'

export interface SharedMotionPresetUpdateCheck {
  libraryId: string
  status: SharedMotionPresetUpdateStatus
  acceptedVersion?: string
  sourceVersion: string
  updateAvailable: boolean
}

export type SharedMotionPresetManifestValidationResult =
  | { success: true; value: SharedMotionPresetManifest }
  | { success: false; issues: MotionValidationIssue[] }

export class SharedMotionPresetValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'SharedMotionPresetValidationError'
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const { invalid, plainRecord, required, strictRecord } = createMotionValidationHelpers(
  (issues) => new SharedMotionPresetValidationError(issues),
  { rejectSymbolFields: true }
)

const normalizedText = (value: unknown, path: string, min: number, max: number) =>
  normalizedMotionText(value, path, min, max, invalid)

function safeIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    return invalid(
      path,
      'invalid_value',
      `Expected a safe identifier of at most ${SHARED_MOTION_PRESET_LIMITS.maxIdentifierLength} characters`
    )
  }
  return value
}

function safeSourceVersion(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SAFE_VERSION.test(value)) {
    return invalid(
      path,
      'invalid_value',
      `Expected a safe source version of at most ${SHARED_MOTION_PRESET_LIMITS.maxSourceVersionLength} characters`
    )
  }
  return value
}

function parseIdentity(value: unknown, path: string): SharedMotionPresetIdentity {
  const record = strictRecord(value, path, ['id', 'name'])
  return {
    id: safeIdentifier(required(record, 'id', path), `${path}.id`),
    name: normalizedText(
      required(record, 'name', path),
      `${path}.name`,
      1,
      SHARED_MOTION_PRESET_LIMITS.maxNameLength
    )
  }
}

function sourceRef(value: unknown, path: string): string {
  const ref = normalizedText(value, path, 1, SHARED_MOTION_PRESET_LIMITS.maxSourceRefLength)
  if (/\p{Cc}/u.test(ref)) invalid(path, 'invalid_value', 'Control characters are not supported')
  return ref
}

function parseSource(value: unknown, path: string): SharedMotionPresetSource {
  const record = strictRecord(value, path, ['kind', 'ref'])
  const kind = required(record, 'kind', path)
  const ref = sourceRef(required(record, 'ref', path), `${path}.ref`)
  return parseMotionSourceReference(
    kind,
    ref,
    path,
    invalid,
    'Expected an HTTP(S) URL without embedded credentials'
  )
}

function parsePresets(value: unknown, path: string): UserMotionPreset[] {
  if (!Array.isArray(value)) return invalid(path, 'invalid_type', 'Expected an array')
  try {
    return parseUserMotionPresetLibrary({
      format: USER_MOTION_PRESET_FORMAT,
      schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
      presets: value
    }).presets
  } catch (error) {
    if (!(error instanceof UserMotionPresetValidationError)) throw error
    throw new SharedMotionPresetValidationError(
      error.issues.map((issue) => ({
        ...issue,
        path: issue.path.replace(/^library\.presets/, path)
      }))
    )
  }
}

function canonicalManifest(manifest: SharedMotionPresetManifest): SharedMotionPresetManifest {
  return {
    format: SHARED_MOTION_PRESET_MANIFEST_FORMAT,
    schemaVersion: SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
    publisher: { ...manifest.publisher },
    library: { ...manifest.library },
    source: { ...manifest.source },
    readonly: manifest.readonly,
    sourceVersion: manifest.sourceVersion,
    presets: parsePresets(manifest.presets, 'manifest.presets')
  }
}

function canonicalJson(manifest: SharedMotionPresetManifest): string {
  return `${JSON.stringify(canonicalManifest(manifest), null, 2)}\n`
}

function jsonByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertManifestJsonSize(json: string): void {
  if (jsonByteLength(json) > SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes) {
    invalid(
      'manifest',
      'limit_exceeded',
      `Shared motion preset manifest JSON may not exceed ${SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes} bytes`
    )
  }
}

export function parseSharedMotionPresetManifest(value: unknown): SharedMotionPresetManifest {
  assertMotionPortableValue(value, 'manifest', { invalid, plainRecord })
  const record = strictRecord(value, 'manifest', [
    'format',
    'schemaVersion',
    'publisher',
    'library',
    'source',
    'readonly',
    'sourceVersion',
    'presets'
  ])
  if (required(record, 'format', 'manifest') !== SHARED_MOTION_PRESET_MANIFEST_FORMAT) {
    return invalid('manifest.format', 'invalid_value', 'Unknown shared motion preset format')
  }
  if (
    required(record, 'schemaVersion', 'manifest') !== SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION
  ) {
    return invalid('manifest.schemaVersion', 'invalid_value', 'Unsupported manifest schema')
  }
  const readonly = required(record, 'readonly', 'manifest')
  if (readonly !== true) {
    return invalid('manifest.readonly', 'invalid_value', 'Shared preset libraries must be readonly')
  }
  const manifest: SharedMotionPresetManifest = {
    format: SHARED_MOTION_PRESET_MANIFEST_FORMAT,
    schemaVersion: SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
    publisher: parseIdentity(required(record, 'publisher', 'manifest'), 'manifest.publisher'),
    library: parseIdentity(required(record, 'library', 'manifest'), 'manifest.library'),
    source: parseSource(required(record, 'source', 'manifest'), 'manifest.source'),
    readonly,
    sourceVersion: safeSourceVersion(
      required(record, 'sourceVersion', 'manifest'),
      'manifest.sourceVersion'
    ),
    presets: parsePresets(required(record, 'presets', 'manifest'), 'manifest.presets')
  }
  assertManifestJsonSize(canonicalJson(manifest))
  return manifest
}

export function validateSharedMotionPresetManifest(
  value: unknown
): SharedMotionPresetManifestValidationResult {
  try {
    return { success: true, value: parseSharedMotionPresetManifest(value) }
  } catch (error) {
    if (error instanceof SharedMotionPresetValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

export function parseSharedMotionPresetManifestJson(json: string): SharedMotionPresetManifest {
  if (typeof json !== 'string') invalid('manifest', 'invalid_type', 'Expected JSON text')
  assertManifestJsonSize(json)
  try {
    return parseSharedMotionPresetManifest(JSON.parse(json))
  } catch (error) {
    if (error instanceof SharedMotionPresetValidationError) throw error
    return invalid('manifest', 'invalid_value', 'Invalid JSON')
  }
}

export function serializeSharedMotionPresetManifest(value: unknown): string {
  return canonicalJson(parseSharedMotionPresetManifest(value))
}

function sameSource(left: SharedMotionPresetSource, right: SharedMotionPresetSource): boolean {
  return left.kind === right.kind && left.ref === right.ref
}

function assertMatchingIdentity(
  accepted: SharedMotionPresetManifest,
  source: SharedMotionPresetManifest
): void {
  if (accepted.library.id !== source.library.id) {
    invalid('manifest.library.id', 'invalid_value', 'Shared library id does not match')
  }
  if (accepted.publisher.id !== source.publisher.id) {
    invalid('manifest.publisher.id', 'invalid_value', 'Shared publisher id does not match')
  }
  if (!sameSource(accepted.source, source.source)) {
    invalid('manifest.source', 'invalid_value', 'Shared library source does not match')
  }
}

export function parseSharedMotionPresetLibraryState(
  value: unknown
): SharedMotionPresetLibraryState {
  assertMotionPortableValue(value, 'sharedLibrary', { invalid, plainRecord })
  const record = strictRecord(value, 'sharedLibrary', [
    'manifest',
    'sourceVersion',
    'updateAvailable'
  ])
  const manifest = parseSharedMotionPresetManifest(required(record, 'manifest', 'sharedLibrary'))
  const sourceVersion = safeSourceVersion(
    required(record, 'sourceVersion', 'sharedLibrary'),
    'sharedLibrary.sourceVersion'
  )
  const updateAvailable = required(record, 'updateAvailable', 'sharedLibrary')
  if (typeof updateAvailable !== 'boolean') {
    return invalid('sharedLibrary.updateAvailable', 'invalid_type', 'Expected a boolean')
  }
  if (updateAvailable === (sourceVersion === manifest.sourceVersion)) {
    return invalid(
      'sharedLibrary.updateAvailable',
      'invalid_value',
      'Update state does not match the accepted and source versions'
    )
  }
  return { manifest, sourceVersion, updateAvailable }
}

export function checkSharedMotionPresetLibraryUpdate(
  current: SharedMotionPresetLibraryState | null,
  sourceValue: unknown
): SharedMotionPresetUpdateCheck {
  const source = parseSharedMotionPresetManifest(sourceValue)
  if (current === null) {
    return {
      libraryId: source.library.id,
      status: 'new',
      sourceVersion: source.sourceVersion,
      updateAvailable: true
    }
  }
  const acceptedState = parseSharedMotionPresetLibraryState(current)
  assertMatchingIdentity(acceptedState.manifest, source)
  const updateAvailable = acceptedState.manifest.sourceVersion !== source.sourceVersion
  if (!updateAvailable && canonicalJson(acceptedState.manifest) !== canonicalJson(source)) {
    invalid(
      'manifest.sourceVersion',
      'invalid_value',
      'Shared library content changed without a source version change'
    )
  }
  return {
    libraryId: source.library.id,
    status: updateAvailable ? 'update-available' : 'up-to-date',
    acceptedVersion: acceptedState.manifest.sourceVersion,
    sourceVersion: source.sourceVersion,
    updateAvailable
  }
}

/** Record a source check without replacing the accepted manifest. */
export function noteSharedMotionPresetLibraryUpdate(
  current: SharedMotionPresetLibraryState,
  sourceValue: unknown
): SharedMotionPresetLibraryState {
  const acceptedState = parseSharedMotionPresetLibraryState(current)
  const check = checkSharedMotionPresetLibraryUpdate(acceptedState, sourceValue)
  return parseSharedMotionPresetLibraryState({
    manifest: acceptedState.manifest,
    sourceVersion: check.sourceVersion,
    updateAvailable: check.updateAvailable
  })
}

/** Explicitly accept one source snapshot. No existing accepted state is mutated. */
export function acceptSharedMotionPresetLibraryUpdate(
  current: SharedMotionPresetLibraryState | null,
  sourceValue: unknown
): SharedMotionPresetLibraryState {
  const source = parseSharedMotionPresetManifest(sourceValue)
  if (current !== null) {
    const acceptedState = parseSharedMotionPresetLibraryState(current)
    assertMatchingIdentity(acceptedState.manifest, source)
    checkSharedMotionPresetLibraryUpdate(acceptedState, source)
  }
  return parseSharedMotionPresetLibraryState({
    manifest: source,
    sourceVersion: source.sourceVersion,
    updateAvailable: false
  })
}

/** Instantiate a complete portable snapshot with bounded shared-library provenance. */
export function instantiateSharedMotionPreset(
  value: SharedMotionPresetLibraryState | SharedMotionPresetManifest,
  presetId: string
): MotionSpec {
  const manifest = Object.hasOwn(value, 'manifest')
    ? parseSharedMotionPresetLibraryState(value).manifest
    : parseSharedMotionPresetManifest(value)
  const preset = manifest.presets.find((candidate) => candidate.id === presetId)
  if (!preset) {
    return invalid('preset.id', 'invalid_value', `Unknown shared motion preset "${presetId}"`)
  }
  const snapshot = instantiateUserMotionPreset(preset)
  return parseMotionSpec({
    ...snapshot,
    preset: {
      ...snapshot.preset,
      parameters: {
        publisherId: manifest.publisher.id,
        libraryId: manifest.library.id,
        sourceVersion: manifest.sourceVersion
      }
    }
  })
}
