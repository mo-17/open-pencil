import { browserCredentialStorage } from '@/app/settings/credentials/storage'

export const SUPABASE_STAGING_TARGET_STORAGE_KEY = 'open-pencil:supabase-staging-target:v1'

export const SUPABASE_STAGING_TARGET_SCHEMA_VERSION = 1 as const

const PROJECT_REF_PATTERN = /^[a-z]{20}$/u
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SECRET_LIKE_ACCOUNT_ID_PATTERN = /^(?:anon$|service_role$|sbp_|sb_publishable_|sb_secret_)/iu
const JWT_LIKE_ACCOUNT_ID_PATTERN = /^eyJ/u
const MAX_SERIALIZED_BYTES = 2 * 1024

const BINDING_KEYS = ['schemaVersion', 'projectRef', 'accountId', 'boundAt'] as const
const BIND_INPUT_KEYS = [
  'projectRef',
  'accountId',
  'projectRefConfirmation',
  'confirmedIndependentStaging'
] as const

type DataRecord = Record<string, unknown>

export interface SupabaseStagingTargetBindingV1 {
  readonly schemaVersion: typeof SUPABASE_STAGING_TARGET_SCHEMA_VERSION
  readonly projectRef: string
  readonly accountId: string
  readonly boundAt: string
}

export interface BindSupabaseStagingTargetInput {
  readonly projectRef: string
  readonly accountId: string
  readonly projectRefConfirmation: string
  readonly confirmedIndependentStaging: true
}

export interface SupabaseStagingTargetStore {
  read(): SupabaseStagingTargetBindingV1 | null
  bind(input: BindSupabaseStagingTargetInput): SupabaseStagingTargetBindingV1
  clear(): void
}

function invalidBinding(): TypeError {
  return new TypeError('Stored Supabase staging target binding is invalid')
}

function invalidConfirmation(): TypeError {
  return new TypeError('Supabase staging target confirmation is invalid')
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): DataRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null

  let keys: readonly PropertyKey[]
  try {
    keys = Reflect.ownKeys(value)
  } catch {
    return null
  }
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return null
  }

  for (const key of expectedKeys) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return null
    }
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null
  }

  try {
    // Descriptor checks above reject accessors without invoking them. structuredClone then rejects
    // Proxy objects before the validated record is read and copied below.
    structuredClone(value)
  } catch {
    return null
  }
  return value as DataRecord
}

function validProjectRef(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_REF_PATTERN.test(value)
}

function validAccountId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ACCOUNT_ID_PATTERN.test(value) &&
    !SECRET_LIKE_ACCOUNT_ID_PATTERN.test(value) &&
    !JWT_LIKE_ACCOUNT_ID_PATTERN.test(value)
  )
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function parseBindingInput(value: unknown): BindSupabaseStagingTargetInput {
  const record = exactDataRecord(value, BIND_INPUT_KEYS)
  if (
    !record ||
    !validProjectRef(record.projectRef) ||
    !validAccountId(record.accountId) ||
    record.projectRefConfirmation !== record.projectRef ||
    record.confirmedIndependentStaging !== true
  ) {
    throw invalidConfirmation()
  }
  return Object.freeze({
    projectRef: record.projectRef,
    accountId: record.accountId,
    projectRefConfirmation: record.projectRefConfirmation,
    confirmedIndependentStaging: true
  })
}

export function parseSupabaseStagingTargetBinding(value: unknown): SupabaseStagingTargetBindingV1 {
  const record = exactDataRecord(value, BINDING_KEYS)
  if (
    !record ||
    record.schemaVersion !== SUPABASE_STAGING_TARGET_SCHEMA_VERSION ||
    !validProjectRef(record.projectRef) ||
    !validAccountId(record.accountId) ||
    !canonicalTimestamp(record.boundAt)
  ) {
    throw invalidBinding()
  }
  return Object.freeze({
    schemaVersion: SUPABASE_STAGING_TARGET_SCHEMA_VERSION,
    projectRef: record.projectRef,
    accountId: record.accountId,
    boundAt: record.boundAt
  })
}

export function parseSupabaseStagingTargetBindingJSON(
  value: string
): SupabaseStagingTargetBindingV1 {
  if (typeof value !== 'string' || value.length === 0 || utf8Bytes(value) > MAX_SERIALIZED_BYTES) {
    throw invalidBinding()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw invalidBinding()
  }
  return parseSupabaseStagingTargetBinding(parsed)
}

export function serializeSupabaseStagingTargetBinding(
  value: SupabaseStagingTargetBindingV1
): string {
  const serialized = JSON.stringify(parseSupabaseStagingTargetBinding(value))
  if (utf8Bytes(serialized) > MAX_SERIALIZED_BYTES) throw invalidBinding()
  return serialized
}

function defaultStorage(): Storage {
  const storage = browserCredentialStorage()
  if (!storage) throw new TypeError('Supabase staging target storage is unavailable')
  return storage
}

export function createSupabaseStagingTargetStore(
  storage: Storage = defaultStorage(),
  now: () => string = () => new Date().toISOString()
): SupabaseStagingTargetStore {
  return Object.freeze({
    read(): SupabaseStagingTargetBindingV1 | null {
      const stored = storage.getItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)
      return stored === null ? null : parseSupabaseStagingTargetBindingJSON(stored)
    },

    bind(input: BindSupabaseStagingTargetInput): SupabaseStagingTargetBindingV1 {
      const confirmed = parseBindingInput(input)
      const binding = parseSupabaseStagingTargetBinding({
        schemaVersion: SUPABASE_STAGING_TARGET_SCHEMA_VERSION,
        projectRef: confirmed.projectRef,
        accountId: confirmed.accountId,
        boundAt: now()
      })
      storage.setItem(
        SUPABASE_STAGING_TARGET_STORAGE_KEY,
        serializeSupabaseStagingTargetBinding(binding)
      )
      return binding
    },

    clear(): void {
      storage.removeItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)
    }
  })
}
