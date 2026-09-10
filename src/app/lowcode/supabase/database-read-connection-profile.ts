import { canonicalManifestJSON, digestCanonicalManifest } from '@open-pencil/scene-graph'

export const SUPABASE_DATABASE_READ_CONNECTION_PROFILE_FORMAT =
  'openpencil.supabase-database-read-connection-profile.v1' as const

export const SUPABASE_DATABASE_READ_CONNECTION_MODES = Object.freeze([
  'direct',
  'supavisor-session'
] as const)

export type SupabaseDatabaseReadConnectionMode =
  (typeof SUPABASE_DATABASE_READ_CONNECTION_MODES)[number]

export interface SupabaseDatabaseReadConnectionProfileV1 {
  readonly format: typeof SUPABASE_DATABASE_READ_CONNECTION_PROFILE_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly projectRef: string
  readonly accountId: string
  readonly mode: SupabaseDatabaseReadConnectionMode
  readonly host: string
  readonly port: 5432
  readonly database: 'postgres'
  readonly user: string
  readonly tlsMode: 'verify-full'
}

export type SupabaseDatabaseReadConnectionProfileInputV1 = Readonly<
  {
    projectRef: string
    accountId: string
  } & (
    | { mode: 'direct' }
    | {
        mode: 'supavisor-session'
        sessionPoolerHost: string
      }
  )
>

const PROFILE_KEYS = Object.freeze([
  'format',
  'version',
  'providerId',
  'environment',
  'projectRef',
  'accountId',
  'mode',
  'host',
  'port',
  'database',
  'user',
  'tlsMode'
] as const)

const DIRECT_INPUT_KEYS = Object.freeze(['projectRef', 'accountId', 'mode'] as const)
const SESSION_INPUT_KEYS = Object.freeze([
  'projectRef',
  'accountId',
  'mode',
  'sessionPoolerHost'
] as const)
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SECRET_LIKE_ACCOUNT_ID = /^(?:anon$|service_role$|sbp_|sb_publishable_|sb_secret_)/iu
const JWT_LIKE_ACCOUNT_ID = /^eyJ/u
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const SESSION_POOLER_SUFFIX = '.pooler.supabase.com'

interface SupabaseDatabaseReadConnectionProfileRecord {
  [key: string]: unknown
}

function fail(message: string): never {
  throw new TypeError(`Supabase database-read connection profile ${message}`)
}

function record(value: unknown): SupabaseDatabaseReadConnectionProfileRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('must be a plain object.')
  }
  let prototype: object | null
  let descriptors: PropertyDescriptorMap
  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return fail('could not be inspected safely.')
  }
  if (![Object.prototype, null].includes(prototype)) return fail('must be a plain object.')
  const keys = Reflect.ownKeys(descriptors)
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !descriptors[key]?.enumerable ||
        !Object.hasOwn(descriptors[key] ?? {}, 'value')
    )
  ) {
    return fail('must contain only enumerable data fields.')
  }
  const snapshot = Object.create(null) as SupabaseDatabaseReadConnectionProfileRecord
  for (const key of keys as string[]) snapshot[key] = descriptors[key]?.value
  return snapshot
}

function requireExactKeys(
  value: SupabaseDatabaseReadConnectionProfileRecord,
  expected: readonly string[]
): void {
  const actual = Object.keys(value).sort()
  const canonicalExpected = [...expected].sort()
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    fail('contains missing or unsupported fields.')
  }
}

function projectRef(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_REF.test(value)) {
    return fail('projectRef must contain exactly 20 lowercase ASCII letters.')
  }
  return value
}

function accountId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !STABLE_ACCOUNT_ID.test(value) ||
    SECRET_LIKE_ACCOUNT_ID.test(value) ||
    JWT_LIKE_ACCOUNT_ID.test(value)
  ) {
    return fail('accountId is invalid.')
  }
  return value
}

function sessionPoolerHost(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    value.trim() !== value ||
    !value.endsWith(SESSION_POOLER_SUFFIX)
  ) {
    return fail('session pooler host is invalid.')
  }
  const labels = value.split('.')
  if (labels.length < 4 || labels.some((label) => !DNS_LABEL.test(label))) {
    return fail('session pooler host is invalid.')
  }
  return value
}

function directHost(project: string): string {
  return `db.${project}.supabase.co`
}

function expectedUser(mode: SupabaseDatabaseReadConnectionMode, project: string): string {
  return mode === 'direct' ? 'postgres' : `postgres.${project}`
}

function normalizedProfile(
  project: string,
  account: string,
  mode: SupabaseDatabaseReadConnectionMode,
  host: string
): SupabaseDatabaseReadConnectionProfileV1 {
  return Object.freeze({
    format: SUPABASE_DATABASE_READ_CONNECTION_PROFILE_FORMAT,
    version: 1,
    providerId: 'supabase',
    environment: 'staging',
    projectRef: project,
    accountId: account,
    mode,
    host,
    port: 5432,
    database: 'postgres',
    user: expectedUser(mode, project),
    tlsMode: 'verify-full'
  })
}

/**
 * Creates a bounded non-secret profile. Passwords, DSNs, arbitrary connection options, ports, and
 * TLS overrides are intentionally absent from the input shape.
 */
export function createSupabaseDatabaseReadConnectionProfileV1(
  value: SupabaseDatabaseReadConnectionProfileInputV1
): SupabaseDatabaseReadConnectionProfileV1 {
  const input = record(value)
  const mode = input.mode
  if (mode !== 'direct' && mode !== 'supavisor-session') {
    return fail('mode is invalid.')
  }
  requireExactKeys(input, mode === 'direct' ? DIRECT_INPUT_KEYS : SESSION_INPUT_KEYS)
  const project = projectRef(input.projectRef)
  const account = accountId(input.accountId)
  const host = mode === 'direct' ? directHost(project) : sessionPoolerHost(input.sessionPoolerHost)
  return normalizedProfile(project, account, mode, host)
}

/** Strictly parses the canonical persisted profile and rejects endpoint or TLS substitution. */
export function parseSupabaseDatabaseReadConnectionProfileV1(
  value: unknown
): SupabaseDatabaseReadConnectionProfileV1 {
  const input = record(value)
  requireExactKeys(input, PROFILE_KEYS)
  if (
    input.format !== SUPABASE_DATABASE_READ_CONNECTION_PROFILE_FORMAT ||
    input.version !== 1 ||
    input.providerId !== 'supabase' ||
    input.environment !== 'staging' ||
    (input.mode !== 'direct' && input.mode !== 'supavisor-session') ||
    input.port !== 5432 ||
    input.database !== 'postgres' ||
    input.tlsMode !== 'verify-full'
  ) {
    return fail('contains an invalid fixed field.')
  }
  const project = projectRef(input.projectRef)
  const account = accountId(input.accountId)
  let host: string
  if (input.mode === 'direct') {
    if (input.host !== directHost(project)) {
      return fail('direct host does not match projectRef.')
    }
    host = input.host
  } else {
    host = sessionPoolerHost(input.host)
  }
  if (input.user !== expectedUser(input.mode, project)) {
    return fail('database user does not match mode and projectRef.')
  }
  return normalizedProfile(project, account, input.mode, host)
}

export function serializeSupabaseDatabaseReadConnectionProfileV1(value: unknown): string {
  return canonicalManifestJSON(parseSupabaseDatabaseReadConnectionProfileV1(value))
}

export async function digestSupabaseDatabaseReadConnectionProfileV1(
  value: unknown
): Promise<string> {
  return digestCanonicalManifest(parseSupabaseDatabaseReadConnectionProfileV1(value))
}
