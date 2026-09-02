type UnknownRecord = Record<string, unknown>

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/u

export function invalid(path: string, message: string): never {
  throw new TypeError(`Invalid Supabase inspected schema at ${path}: ${message}`)
}

export function record(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(path, 'expected a plain object')
  }
  return value as UnknownRecord
}

export function exactRecord(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[] = allowed
): UnknownRecord {
  const source = record(value, path)
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) invalid(`${path}.${key}`, 'field is not allowed')
  }
  for (const key of required) {
    if (!Object.hasOwn(source, key)) invalid(`${path}.${key}`, 'field is required')
  }
  return source
}

export function array(value: unknown, path: string, limit: number): readonly unknown[] {
  if (!Array.isArray(value)) invalid(path, 'expected an array')
  if (value.length > limit) invalid(path, `exceeds the item limit of ${String(limit)}`)
  return value
}

export function oneOf<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values
): Values[number] {
  if (typeof value !== 'string' || !values.some((entry) => entry === value)) {
    return invalid(path, `expected one of ${values.join(', ')}`)
  }
  return value as Values[number]
}

export function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    return invalid(path, 'expected a bounded unquoted PostgreSQL identifier')
  }
  return value
}

export function stableId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    return invalid(path, 'expected a bounded stable identifier')
  }
  return value
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'expected a boolean')
  return value
}

export function optionalStableId(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stableId(value, path)
}

export function schema(value: unknown, path: string): 'public' {
  if (value !== 'public') invalid(path, 'only the exact public schema is supported')
  return 'public'
}

export function parseNamedObjectIdentity(
  source: UnknownRecord,
  path: string
): { readonly schema: 'public'; readonly name: string } {
  return {
    schema: schema(source.schema, `${path}.schema`),
    name: identifier(source.name, `${path}.name`)
  }
}

export function parseTableObjectIdentity(
  source: UnknownRecord,
  path: string
): { readonly schema: 'public'; readonly tableName: string; readonly name: string } {
  return {
    schema: schema(source.schema, `${path}.schema`),
    tableName: identifier(source.tableName, `${path}.tableName`),
    name: identifier(source.name, `${path}.name`)
  }
}

export function validateDigest(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SHA256_BASE64URL.test(value)) {
    invalid(path, 'expected a canonical SHA-256 base64url digest')
  }
  return value
}

export type { UnknownRecord }
