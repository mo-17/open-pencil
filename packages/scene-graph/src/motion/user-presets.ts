import { MOTION_PRESET_CATEGORIES, type MotionPresetCategory } from './presets'
import { type MotionSpec, type MotionValidationIssue } from './types'
import { MotionValidationError, parseMotionSpec } from './validation'
import {
  assertMotionPortableValue,
  createMotionValidationHelpers,
  MotionIssueValidationError,
  normalizedMotionText
} from './validation-helpers'

export const USER_MOTION_PRESET_FORMAT = 'openpencil-motion-presets' as const
export const USER_MOTION_PRESET_SCHEMA_VERSION = 1 as const
export const USER_MOTION_PRESET_LIMITS = Object.freeze({
  maxPresets: 100,
  maxJsonBytes: 1_048_576,
  maxNameLength: 64,
  maxDescriptionLength: 256,
  minRevision: 1,
  maxRevision: 1_000
})

export const USER_MOTION_PRESET_CATEGORIES = Object.freeze([
  ...MOTION_PRESET_CATEGORIES,
  'custom'
] as const)

export type UserMotionPresetCategory = MotionPresetCategory | 'custom'
export type MotionPresetMergePolicy = 'error' | 'skip' | 'replace'

export interface UserMotionPreset {
  id: string
  revision: number
  name: string
  description?: string
  category: UserMotionPresetCategory
  motion: MotionSpec
}

export interface UserMotionPresetLibrary {
  format: typeof USER_MOTION_PRESET_FORMAT
  schemaVersion: typeof USER_MOTION_PRESET_SCHEMA_VERSION
  presets: UserMotionPreset[]
}

export interface UserMotionPresetCreateInput {
  id: string
  name: string
  description?: string
  category: UserMotionPresetCategory
  motion: MotionSpec
}

export interface UserMotionPresetUpdateInput {
  description?: string | null
  category?: UserMotionPresetCategory
  motion?: MotionSpec
}

export type UserMotionPresetValidationResult =
  | { success: true; value: UserMotionPresetLibrary }
  | { success: false; issues: MotionValidationIssue[] }

export class UserMotionPresetValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'UserMotionPresetValidationError'
  }
}

const USER_PRESET_ID = /^user-[A-Za-z0-9][A-Za-z0-9_-]{0,58}$/
const MERGE_POLICIES = new Set<MotionPresetMergePolicy>(['error', 'skip', 'replace'])

const { invalid, plainRecord, required, strictRecord } = createMotionValidationHelpers(
  (issues) => new UserMotionPresetValidationError(issues),
  { rejectSymbolFields: true }
)

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return invalid(path, 'invalid_type', 'Expected an integer')
  }
  if (value < min || value > max) {
    return invalid(path, 'out_of_range', `Expected a value from ${min} to ${max}`)
  }
  return value
}

function userPresetId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !USER_PRESET_ID.test(value)) {
    return invalid(
      path,
      'invalid_value',
      'Expected a safe user- identifier of at most 64 characters'
    )
  }
  return value
}

const normalizedText = (value: unknown, path: string, min: number, max: number) =>
  normalizedMotionText(value, path, min, max, invalid)

function presetCategory(value: unknown, path: string): UserMotionPresetCategory {
  if (
    typeof value !== 'string' ||
    !(USER_MOTION_PRESET_CATEGORIES as readonly string[]).includes(value)
  ) {
    return invalid(path, 'invalid_value', 'Unknown motion preset category')
  }
  return value as UserMotionPresetCategory
}

function parsePortableMotion(value: unknown, path: string): MotionSpec {
  let motion: MotionSpec
  try {
    motion = parseMotionSpec(value)
  } catch (error) {
    if (!(error instanceof MotionValidationError)) throw error
    throw new UserMotionPresetValidationError(
      error.issues.map((issue) => ({
        ...issue,
        path: `${path}${issue.path.slice('motion'.length)}`
      }))
    )
  }
  if (motion.preset !== undefined) {
    return invalid(`${path}.preset`, 'invalid_value', 'Portable preset motion must be a snapshot')
  }
  return motion
}

function canonicalPreset(
  id: string,
  revision: number,
  name: string,
  description: string | undefined,
  category: UserMotionPresetCategory,
  motion: MotionSpec
): UserMotionPreset {
  if (description === undefined) return { id, revision, name, category, motion }
  return { id, revision, name, description, category, motion }
}

function parsePreset(value: unknown, path: string, schemaVersion: 0 | 1): UserMotionPreset {
  const motionKey = schemaVersion === 0 ? 'spec' : 'motion'
  const allowedKeys =
    schemaVersion === 0
      ? ['id', 'revision', 'name', 'description', 'category', 'spec']
      : ['id', 'revision', 'name', 'description', 'category', 'motion']
  const record = strictRecord(value, path, allowedKeys)
  const id = userPresetId(required(record, 'id', path), `${path}.id`)
  const revision = integer(
    required(record, 'revision', path),
    `${path}.revision`,
    USER_MOTION_PRESET_LIMITS.minRevision,
    USER_MOTION_PRESET_LIMITS.maxRevision
  )
  const name = normalizedText(
    required(record, 'name', path),
    `${path}.name`,
    1,
    USER_MOTION_PRESET_LIMITS.maxNameLength
  )
  const description = Object.hasOwn(record, 'description')
    ? normalizedText(
        record.description,
        `${path}.description`,
        0,
        USER_MOTION_PRESET_LIMITS.maxDescriptionLength
      )
    : undefined
  const category =
    schemaVersion === 0 && !Object.hasOwn(record, 'category')
      ? 'custom'
      : presetCategory(required(record, 'category', path), `${path}.category`)
  const motion = parsePortableMotion(required(record, motionKey, path), `${path}.${motionKey}`)
  return canonicalPreset(id, revision, name, description, category, motion)
}

/** Deterministic identity key shared by validation and app-side duplicate checks. */
export function userMotionPresetNameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase()
}

function assertUniquePresets(presets: readonly UserMotionPreset[]): void {
  const ids = new Set<string>()
  const names = new Set<string>()
  presets.forEach((preset, index) => {
    if (ids.has(preset.id)) {
      invalid(`library.presets[${index}].id`, 'invalid_value', 'Preset ids must be unique')
    }
    ids.add(preset.id)
    const normalizedName = userMotionPresetNameKey(preset.name)
    if (names.has(normalizedName)) {
      invalid(`library.presets[${index}].name`, 'invalid_value', 'Preset names must be unique')
    }
    names.add(normalizedName)
  })
}

function canonicalJson(library: UserMotionPresetLibrary): string {
  return JSON.stringify(
    {
      format: USER_MOTION_PRESET_FORMAT,
      schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
      presets: library.presets.map((preset) =>
        canonicalPreset(
          preset.id,
          preset.revision,
          preset.name,
          preset.description,
          preset.category,
          preset.motion
        )
      )
    },
    null,
    2
  )
}

function jsonByteLength(json: string): number {
  return new TextEncoder().encode(json).byteLength
}

function assertJsonSize(json: string): void {
  if (jsonByteLength(json) > USER_MOTION_PRESET_LIMITS.maxJsonBytes) {
    invalid(
      'library',
      'limit_exceeded',
      `Preset library JSON may not exceed ${USER_MOTION_PRESET_LIMITS.maxJsonBytes} bytes`
    )
  }
}

/** Parse either the current portable format or schema v0 and return a fresh v1 snapshot. */
export function parseUserMotionPresetLibrary(value: unknown): UserMotionPresetLibrary {
  assertMotionPortableValue(value, 'library', { invalid, plainRecord })
  const record = strictRecord(value, 'library', ['format', 'schemaVersion', 'presets'])
  if (required(record, 'format', 'library') !== USER_MOTION_PRESET_FORMAT) {
    return invalid('library.format', 'invalid_value', 'Unknown motion preset file format')
  }
  const rawSchemaVersion = required(record, 'schemaVersion', 'library')
  if (typeof rawSchemaVersion !== 'number' || !Number.isInteger(rawSchemaVersion)) {
    return invalid('library.schemaVersion', 'invalid_type', 'Expected an integer')
  }
  if (rawSchemaVersion !== 0 && rawSchemaVersion !== USER_MOTION_PRESET_SCHEMA_VERSION) {
    return invalid('library.schemaVersion', 'invalid_value', 'Unsupported motion preset schema')
  }
  const rawPresets = required(record, 'presets', 'library')
  if (!Array.isArray(rawPresets)) {
    return invalid('library.presets', 'invalid_type', 'Expected an array')
  }
  if (rawPresets.length > USER_MOTION_PRESET_LIMITS.maxPresets) {
    return invalid(
      'library.presets',
      'limit_exceeded',
      `A library may contain at most ${USER_MOTION_PRESET_LIMITS.maxPresets} presets`
    )
  }
  const presets = Array.from(rawPresets, (preset, index) =>
    parsePreset(preset, `library.presets[${index}]`, rawSchemaVersion)
  )
  assertUniquePresets(presets)
  const library: UserMotionPresetLibrary = {
    format: USER_MOTION_PRESET_FORMAT,
    schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
    presets
  }
  assertJsonSize(canonicalJson(library))
  return library
}

export function validateUserMotionPresetLibrary(value: unknown): UserMotionPresetValidationResult {
  try {
    return { success: true, value: parseUserMotionPresetLibrary(value) }
  } catch (error) {
    if (error instanceof UserMotionPresetValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

export function parseUserMotionPresetLibraryJson(json: string): UserMotionPresetLibrary {
  if (typeof json !== 'string') invalid('library', 'invalid_type', 'Expected JSON text')
  assertJsonSize(json)
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return invalid('library', 'invalid_value', 'Invalid JSON')
  }
  return parseUserMotionPresetLibrary(value)
}

/** Serialize a canonical, stable-key-order v1 file. */
export function serializeUserMotionPresetLibrary(value: unknown): string {
  return canonicalJson(parseUserMotionPresetLibrary(value))
}

export function createUserMotionPresetLibrary(
  presets: readonly UserMotionPreset[] = []
): UserMotionPresetLibrary {
  return parseUserMotionPresetLibrary({
    format: USER_MOTION_PRESET_FORMAT,
    schemaVersion: USER_MOTION_PRESET_SCHEMA_VERSION,
    presets: [...presets]
  })
}

export function createUserMotionPreset(
  library: UserMotionPresetLibrary,
  input: UserMotionPresetCreateInput
): UserMotionPresetLibrary {
  const current = parseUserMotionPresetLibrary(library)
  const record = strictRecord(input, 'input', ['id', 'name', 'description', 'category', 'motion'])
  const candidate = canonicalPreset(
    userPresetId(required(record, 'id', 'input'), 'input.id'),
    1,
    normalizedText(
      required(record, 'name', 'input'),
      'input.name',
      1,
      USER_MOTION_PRESET_LIMITS.maxNameLength
    ),
    Object.hasOwn(record, 'description')
      ? normalizedText(
          record.description,
          'input.description',
          0,
          USER_MOTION_PRESET_LIMITS.maxDescriptionLength
        )
      : undefined,
    presetCategory(required(record, 'category', 'input'), 'input.category'),
    parsePortableMotion(required(record, 'motion', 'input'), 'input.motion')
  )
  return createUserMotionPresetLibrary([...current.presets, candidate])
}

function existingPresetIndex(library: UserMotionPresetLibrary, id: string): number {
  const safeId = userPresetId(id, 'preset.id')
  const index = library.presets.findIndex((preset) => preset.id === safeId)
  if (index === -1) invalid('preset.id', 'invalid_value', `Unknown user motion preset "${safeId}"`)
  return index
}

export function updateUserMotionPreset(
  library: UserMotionPresetLibrary,
  id: string,
  updates: UserMotionPresetUpdateInput
): UserMotionPresetLibrary {
  const current = parseUserMotionPresetLibrary(library)
  const index = existingPresetIndex(current, id)
  const record = strictRecord(updates, 'updates', ['description', 'category', 'motion'])
  if (Object.keys(record).length === 0) return current
  const preset = current.presets[index]
  if (preset.revision >= USER_MOTION_PRESET_LIMITS.maxRevision) {
    return invalid('preset.revision', 'limit_exceeded', 'Preset revision limit reached')
  }
  let description = preset.description
  if (Object.hasOwn(record, 'description')) {
    description =
      record.description === null
        ? undefined
        : normalizedText(
            record.description,
            'updates.description',
            0,
            USER_MOTION_PRESET_LIMITS.maxDescriptionLength
          )
  }
  const category = Object.hasOwn(record, 'category')
    ? presetCategory(record.category, 'updates.category')
    : preset.category
  const motion = Object.hasOwn(record, 'motion')
    ? parsePortableMotion(record.motion, 'updates.motion')
    : preset.motion
  const next = [...current.presets]
  next[index] = canonicalPreset(
    preset.id,
    preset.revision + 1,
    preset.name,
    description,
    category,
    motion
  )
  return createUserMotionPresetLibrary(next)
}

export function renameUserMotionPreset(
  library: UserMotionPresetLibrary,
  id: string,
  name: string
): UserMotionPresetLibrary {
  const current = parseUserMotionPresetLibrary(library)
  const index = existingPresetIndex(current, id)
  const nextName = normalizedText(name, 'preset.name', 1, USER_MOTION_PRESET_LIMITS.maxNameLength)
  const next = [...current.presets]
  next[index] = canonicalPreset(
    next[index].id,
    next[index].revision,
    nextName,
    next[index].description,
    next[index].category,
    next[index].motion
  )
  return createUserMotionPresetLibrary(next)
}

export function removeUserMotionPreset(
  library: UserMotionPresetLibrary,
  id: string
): UserMotionPresetLibrary {
  const current = parseUserMotionPresetLibrary(library)
  const index = existingPresetIndex(current, id)
  return createUserMotionPresetLibrary(
    current.presets.filter((_, presetIndex) => presetIndex !== index)
  )
}

export function mergeUserMotionPresetLibraries(
  base: UserMotionPresetLibrary,
  incoming: UserMotionPresetLibrary,
  policy: MotionPresetMergePolicy = 'error'
): UserMotionPresetLibrary {
  if (!MERGE_POLICIES.has(policy)) {
    return invalid('merge.policy', 'invalid_value', 'Unknown merge policy')
  }
  let merged = parseUserMotionPresetLibrary(base).presets
  const additions = parseUserMotionPresetLibrary(incoming).presets
  for (const preset of additions) {
    const idConflict = merged.some((candidate) => candidate.id === preset.id)
    const presetNameKey = userMotionPresetNameKey(preset.name)
    const nameConflict = merged.some(
      (candidate) => userMotionPresetNameKey(candidate.name) === presetNameKey
    )
    if (!idConflict && !nameConflict) {
      merged = [...merged, preset]
      continue
    }
    if (policy === 'error') {
      return invalid(
        'merge.incoming',
        'invalid_value',
        `Preset "${preset.id}" conflicts by id or name`
      )
    }
    if (policy === 'skip') continue
    merged = [
      ...merged.filter(
        (candidate) =>
          candidate.id !== preset.id && userMotionPresetNameKey(candidate.name) !== presetNameKey
      ),
      preset
    ]
  }
  return createUserMotionPresetLibrary(merged)
}

/** Create a node-ready snapshot while recording the user preset and revision it came from. */
export function instantiateUserMotionPreset(preset: UserMotionPreset): MotionSpec {
  const parsed = createUserMotionPresetLibrary([preset]).presets[0]
  return parseMotionSpec({
    ...parsed.motion,
    preset: { id: parsed.id, version: parsed.revision, parameters: {} }
  })
}
