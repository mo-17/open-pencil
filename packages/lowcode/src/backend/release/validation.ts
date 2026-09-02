import { parseSha256Base64URL } from '@open-pencil/scene-graph'

import { containsBackendSecretLikeMaterial } from '../secret-boundary'
import type { BackendCredentialRef } from '../types'
import { isBackendCredentialRef } from '../validate'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u

export const RELEASE_MAX_LIST_ITEMS = 256
export const RELEASE_MAX_DESCRIPTION_LENGTH = 2_048

const RELEASE_MIGRATION_RISKS = ['low', 'medium', 'high', 'destructive'] as const

type ReleaseMigrationRisk = (typeof RELEASE_MIGRATION_RISKS)[number]

interface ReleaseMigrationOperationValue {
  readonly operationId: string
  readonly kind: string
  readonly risk: ReleaseMigrationRisk
  readonly checksum: string
}

interface ParsedReleaseMigrationOperation {
  readonly path: string
  readonly source: Record<string, unknown>
  readonly value: ReleaseMigrationOperationValue
}

interface ParsedReleaseMigration<Value extends ReleaseMigrationOperationValue> {
  readonly source: Record<string, unknown>
  readonly value: {
    readonly planId: string
    readonly planDigest: string
    readonly fromModelDigest: string | null
    readonly targetModelDigest: string
    readonly operations: readonly Value[]
  }
}

export function releaseIdentifier(value: string, path: string): string {
  if (!IDENTIFIER.test(value) || containsBackendSecretLikeMaterial(value)) {
    throw new TypeError(`${path} must be a bounded secret-free identifier`)
  }
  return value
}

export function releaseText(value: string, path: string, maxLength = 256): string {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    containsBackendSecretLikeMaterial(value)
  ) {
    throw new TypeError(
      `${path} must be non-empty, trimmed, secret-free, and at most ${maxLength} characters`
    )
  }
  return value
}

export function releaseDigest(value: string, path: string): string {
  if (value.length !== 43) {
    throw new TypeError(`${path} must be a canonical SHA-256 base64url digest`)
  }
  return parseSha256Base64URL(value, path)
}

export function releasePackageDigest(value: string, path: string): string {
  for (const prefix of ['sha256:', 'app-bundle-sha256:'] as const) {
    if (value.startsWith(prefix)) {
      releaseDigest(value.slice(prefix.length), path)
      return value
    }
  }
  return releaseDigest(value, path)
}

export function releaseTimestamp(value: string, path: string): string {
  const match = TIMESTAMP.exec(value)
  const calendar = match?.[1]
  const calendarDate = calendar ? new Date(`${calendar}T00:00:00.000Z`) : undefined
  if (
    !calendar ||
    !calendarDate ||
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== calendar ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(`${path} must be a UTC RFC 3339 timestamp`)
  }
  return value
}

export function releaseEnvironmentName(value: string, path: string): string {
  if (!ENVIRONMENT_NAME.test(value)) {
    throw new TypeError(`${path} must be a bounded environment variable name`)
  }
  return value
}

export function releaseCredentialRef(value: string, path: string): BackendCredentialRef {
  if (!isBackendCredentialRef(value)) {
    throw new TypeError(`${path} must be a host-issued opaque credential UUID handle`)
  }
  return value
}

export function sortedUniqueStrings(values: readonly string[], path: string): string[]
export function sortedUniqueStrings<Value extends string>(
  values: readonly string[],
  path: string,
  validate: (value: string, path: string) => Value
): Value[]
export function sortedUniqueStrings(
  values: readonly string[],
  path: string,
  validate: (value: string, path: string) => string = releaseIdentifier
): string[] {
  if (values.length > RELEASE_MAX_LIST_ITEMS) {
    throw new TypeError(`${path} exceeds the maximum item count`)
  }
  const normalized = values.map((value, index) => validate(value, `${path}[${index}]`)).sort()
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${path} must not contain duplicates`)
  }
  return normalized
}

export function sortedUniqueIntegers(values: readonly number[], path: string): number[] {
  if (values.length > RELEASE_MAX_LIST_ITEMS) {
    throw new TypeError(`${path} exceeds the maximum item count`)
  }
  const normalized = [...values].sort((left, right) => left - right)
  if (
    normalized.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new TypeError(`${path} must contain unique positive integer versions`)
  }
  return normalized
}

function isReleaseDataObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function plainDataRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isReleaseDataObject(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const prototype = Reflect.getPrototypeOf(value)
  if (![Object.prototype, null].includes(prototype)) {
    throw new TypeError(`${path} must be a plain data object`)
  }
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${path} must not contain symbol keys`)
  }
  const names = ownKeys as string[]
  const record: Record<string, unknown> = Object.create(null)
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path} must contain enumerable data property values only`)
    }
    record[name] = descriptor.value
  }
  return record
}

export function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
  requiredKeys: readonly string[] = keys
): Record<string, unknown> {
  const record = plainDataRecord(value, path)
  const allowed = new Set(keys)
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new TypeError(`${path} contains unsupported fields`)
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) throw new TypeError(`${path}.${key} is required`)
  }
  return record
}

export function stringValue(value: unknown, path: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`)
  return releaseText(value, path, maxLength)
}

export function nullableDigest(value: unknown, path: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new TypeError(`${path} must be null or a digest`)
  return releaseDigest(value, path)
}

export function nullableTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new TypeError(`${path} must be null or a timestamp`)
  return releaseTimestamp(value, path)
}

export function stringArray(value: unknown, path: string): string[]
export function stringArray<Value extends string>(
  value: unknown,
  path: string,
  validate: (value: string, path: string) => Value
): Value[]
export function stringArray(
  value: unknown,
  path: string,
  validate: (value: string, path: string) => string = releaseIdentifier
): string[] {
  const entries = exactArray(value, path)
  if (entries.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${path} must contain only strings`)
  }
  return sortedUniqueStrings(entries as string[], path, validate)
}

export function exactArray(
  value: unknown,
  path: string,
  maxItems = RELEASE_MAX_LIST_ITEMS
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must be a plain array`)
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  const length = lengthDescriptor?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > maxItems) {
    throw new TypeError(`${path} exceeds the maximum item count`)
  }
  const values: unknown[] = []
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${path} must not contain symbol keys`)
  }
  const names = ownKeys as string[]
  const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))])
  if (names.some((name) => !expected.has(name))) {
    throw new TypeError(`${path} must not contain named extension properties`)
  }
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path}[${index}] must be an enumerable data property`)
    }
    values.push(descriptor.value)
  }
  return values
}

export function parseReleaseMigrationOperationFields(
  value: unknown,
  index: number,
  keys: readonly string[]
): ParsedReleaseMigrationOperation {
  const path = `$.migration.operations[${index}]`
  const source = exactRecord(value, path, keys)
  if (
    typeof source.risk !== 'string' ||
    !RELEASE_MIGRATION_RISKS.includes(source.risk as ReleaseMigrationRisk)
  ) {
    throw new TypeError(`${path}.risk is not supported`)
  }
  return {
    path,
    source,
    value: {
      operationId: releaseIdentifier(
        stringValue(source.operationId, `${path}.operationId`),
        `${path}.operationId`
      ),
      kind: releaseIdentifier(stringValue(source.kind, `${path}.kind`), `${path}.kind`),
      risk: source.risk as ReleaseMigrationRisk,
      checksum: releaseDigest(stringValue(source.checksum, `${path}.checksum`), `${path}.checksum`)
    }
  }
}

export function parseReleaseMigrationFields<Value extends ReleaseMigrationOperationValue>(
  value: unknown,
  keys: readonly string[],
  parseOperation: (entry: unknown, index: number) => Value,
  maxItems = RELEASE_MAX_LIST_ITEMS
): ParsedReleaseMigration<Value> {
  const source = exactRecord(value, '$.migration', keys)
  const operations = exactArray(source.operations, '$.migration.operations', maxItems).map(
    parseOperation
  )
  if (new Set(operations.map((entry) => entry.operationId)).size !== operations.length) {
    throw new TypeError('$.migration.operations contains duplicate operation IDs')
  }
  return {
    source,
    value: {
      planId: releaseIdentifier(
        stringValue(source.planId, '$.migration.planId'),
        '$.migration.planId'
      ),
      planDigest: releaseDigest(
        stringValue(source.planDigest, '$.migration.planDigest'),
        '$.migration.planDigest'
      ),
      fromModelDigest: nullableDigest(source.fromModelDigest, '$.migration.fromModelDigest'),
      targetModelDigest: releaseDigest(
        stringValue(source.targetModelDigest, '$.migration.targetModelDigest'),
        '$.migration.targetModelDigest'
      ),
      operations
    }
  }
}
