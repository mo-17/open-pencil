import {
  PLUGIN_RUNTIME_CAPABILITIES,
  type PluginRuntimeCapabilityV1
} from '@open-pencil/core/plugins'
import {
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64Url,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import { openIdb, runIdbReadonlyRequest, txDone } from '@/app/storage/idb-util'

export const PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION = 1 as const
export const PLUGIN_RUNTIME_POLICY_DATABASE_NAME = 'open-pencil-plugin-runtime-policy'
export const PLUGIN_RUNTIME_POLICY_LIMITS = Object.freeze({
  maxPlugins: 64,
  maxAuditEvents: 128,
  maxReasonCodeLength: 128
})

export type PluginRuntimeAuditAction =
  | 'grant'
  | 'revoke'
  | 'execute-succeeded'
  | 'execute-failed'
  | 'execute-blocked'

export interface PluginRuntimeAuditEventV1 {
  sequence: number
  occurredAt: string
  action: PluginRuntimeAuditAction
  runtimePackageDigest: string
  reasonCode: string | null
}

export interface PluginRuntimePolicyRecordV1 {
  schemaVersion: typeof PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION
  pluginId: string
  declarativeManifestDigest: string
  runtimePackageDigest: string
  grantedCapabilities: readonly PluginRuntimeCapabilityV1[]
  grantedAt: string | null
  revokedAt: string | null
  auditSequence: number
  audit: readonly PluginRuntimeAuditEventV1[]
}

export interface PluginRuntimePolicyStorage {
  get(pluginId: string): Promise<unknown>
  list(): Promise<unknown[]>
  put(record: unknown): Promise<void>
  delete(pluginId: string): Promise<void>
}

const POLICY_KEYS = new Set([
  'schemaVersion',
  'pluginId',
  'declarativeManifestDigest',
  'runtimePackageDigest',
  'grantedCapabilities',
  'grantedAt',
  'revokedAt',
  'auditSequence',
  'audit'
])
const AUDIT_KEYS = new Set([
  'sequence',
  'occurredAt',
  'action',
  'runtimePackageDigest',
  'reasonCode'
])
const ACTIONS = new Set<PluginRuntimeAuditAction>([
  'grant',
  'revoke',
  'execute-succeeded',
  'execute-failed',
  'execute-blocked'
])
const CAPABILITIES = new Set<string>(PLUGIN_RUNTIME_CAPABILITIES)
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function timestamp(value: unknown, path: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    throw new TypeError(`${path} must be a canonical UTC timestamp or null`)
  }
  try {
    if (new Date(value).toISOString() !== value) {
      throw new TypeError(`${path} must be a canonical UTC timestamp or null`)
    }
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith(path)) throw cause
    throw new TypeError(`${path} must be a canonical UTC timestamp or null`, { cause })
  }
  return value
}

function capabilities(value: unknown): readonly PluginRuntimeCapabilityV1[] {
  const parsed = parseBoundedManifestArray(
    value,
    'pluginRuntimePolicy.grantedCapabilities',
    PLUGIN_RUNTIME_CAPABILITIES.length
  ).map((entry, index) => {
    if (typeof entry !== 'string' || !CAPABILITIES.has(entry)) {
      throw new TypeError(`pluginRuntimePolicy.grantedCapabilities[${index}] is unsupported`)
    }
    return entry as PluginRuntimeCapabilityV1
  })
  if (
    new Set(parsed).size !== parsed.length ||
    [...parsed].sort().some((entry, i) => entry !== parsed[i])
  ) {
    throw new TypeError('pluginRuntimePolicy.grantedCapabilities must be unique and sorted')
  }
  return Object.freeze(parsed)
}

function reasonCode(value: unknown): string | null {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PLUGIN_RUNTIME_POLICY_LIMITS.maxReasonCodeLength ||
    !/^[a-z0-9-]+$/.test(value)
  ) {
    throw new TypeError('pluginRuntimePolicy.audit.reasonCode must be a bounded machine code')
  }
  return value
}

function auditEvent(
  value: unknown,
  index: number,
  firstSequence: number
): PluginRuntimeAuditEventV1 {
  const path = `pluginRuntimePolicy.audit[${index}]`
  const source = parseExactManifestRecord(value, path, AUDIT_KEYS, AUDIT_KEYS)
  if (!Number.isSafeInteger(source.sequence) || source.sequence !== firstSequence + index) {
    throw new TypeError(`${path}.sequence must be contiguous`)
  }
  if (
    typeof source.action !== 'string' ||
    !ACTIONS.has(source.action as PluginRuntimeAuditAction)
  ) {
    throw new TypeError(`${path}.action is unsupported`)
  }
  const occurredAt = timestamp(source.occurredAt, `${path}.occurredAt`)
  if (occurredAt === null) throw new TypeError(`${path}.occurredAt must not be null`)
  return Object.freeze({
    sequence: source.sequence,
    occurredAt,
    action: source.action as PluginRuntimeAuditAction,
    runtimePackageDigest: parseSha256Base64Url(
      source.runtimePackageDigest,
      `${path}.runtimePackageDigest`
    ),
    reasonCode: reasonCode(source.reasonCode)
  })
}

function assertAuditState(
  audit: readonly PluginRuntimeAuditEventV1[],
  auditSequence: number,
  runtimePackageDigest: string,
  grantedAt: string | null,
  revokedAt: string | null
): void {
  for (let index = 1; index < audit.length; index++) {
    if (Date.parse(audit[index].occurredAt) < Date.parse(audit[index - 1].occurredAt)) {
      throw new TypeError('pluginRuntimePolicy.audit timestamps must be monotonic')
    }
  }
  const stateEvents = audit.filter(
    (event) =>
      event.runtimePackageDigest === runtimePackageDigest &&
      (event.action === 'grant' || event.action === 'revoke')
  )
  const latestState = stateEvents.at(-1)
  const completeRetainedHistory = audit.length === auditSequence
  if (!latestState) {
    if (completeRetainedHistory && (grantedAt !== null || revokedAt !== null)) {
      throw new TypeError('pluginRuntimePolicy grant state is not backed by its audit history')
    }
    return
  }
  if (latestState.action === 'grant') {
    if (grantedAt !== latestState.occurredAt || revokedAt !== null) {
      throw new TypeError('pluginRuntimePolicy active grant disagrees with its audit history')
    }
    return
  }
  if (grantedAt === null || revokedAt !== latestState.occurredAt) {
    throw new TypeError('pluginRuntimePolicy revocation disagrees with its audit history')
  }
}

export function parsePluginRuntimePolicyRecord(value: unknown): PluginRuntimePolicyRecordV1 {
  const source = parseExactManifestRecord(value, 'pluginRuntimePolicy', POLICY_KEYS, POLICY_KEYS)
  if (source.schemaVersion !== PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION) {
    throw new TypeError('pluginRuntimePolicy.schemaVersion is unsupported')
  }
  const grantedAt = timestamp(source.grantedAt, 'pluginRuntimePolicy.grantedAt')
  const revokedAt = timestamp(source.revokedAt, 'pluginRuntimePolicy.revokedAt')
  const grantedCapabilities = capabilities(source.grantedCapabilities)
  if (grantedAt === null && grantedCapabilities.length > 0) {
    throw new TypeError('A runtime policy without a grant cannot contain capabilities')
  }
  if (revokedAt !== null && grantedAt === null) {
    throw new TypeError('A runtime policy cannot be revoked before it is granted')
  }
  if (grantedAt && revokedAt && Date.parse(revokedAt) < Date.parse(grantedAt)) {
    throw new TypeError('Runtime revocation cannot predate its grant')
  }
  if (!Number.isSafeInteger(source.auditSequence) || (source.auditSequence as number) < 0) {
    throw new TypeError('pluginRuntimePolicy.auditSequence must be a non-negative safe integer')
  }
  const auditValues = parseBoundedManifestArray(
    source.audit,
    'pluginRuntimePolicy.audit',
    PLUGIN_RUNTIME_POLICY_LIMITS.maxAuditEvents
  )
  const auditSequence = source.auditSequence as number
  if (auditValues.length > auditSequence) {
    throw new TypeError('pluginRuntimePolicy.audit contains impossible sequence history')
  }
  const firstAuditSequence = auditSequence - auditValues.length + 1
  const audit = auditValues.map((event, index) => auditEvent(event, index, firstAuditSequence))
  const runtimePackageDigest = parseSha256Base64Url(
    source.runtimePackageDigest,
    'pluginRuntimePolicy.runtimePackageDigest'
  )
  assertAuditState(audit, auditSequence, runtimePackageDigest, grantedAt, revokedAt)
  return Object.freeze({
    schemaVersion: PLUGIN_RUNTIME_POLICY_SCHEMA_VERSION,
    pluginId: identity(source.pluginId, 'pluginRuntimePolicy.pluginId'),
    declarativeManifestDigest: parseSha256Base64Url(
      source.declarativeManifestDigest,
      'pluginRuntimePolicy.declarativeManifestDigest'
    ),
    runtimePackageDigest,
    grantedCapabilities,
    grantedAt,
    revokedAt,
    auditSequence,
    audit: Object.freeze(audit)
  })
}

export function createMemoryPluginRuntimePolicyStorage(
  initial: readonly unknown[] = []
): PluginRuntimePolicyStorage {
  const records = new Map(
    initial.map((value) => {
      const record = parsePluginRuntimePolicyRecord(value)
      return [record.pluginId, record] as const
    })
  )
  return {
    async get(pluginId) {
      const value = records.get(pluginId)
      return value ? structuredClone(value) : null
    },
    async list() {
      return [...records.values()].map((value) => structuredClone(value))
    },
    async put(value) {
      const record = parsePluginRuntimePolicyRecord(value)
      if (
        !records.has(record.pluginId) &&
        records.size >= PLUGIN_RUNTIME_POLICY_LIMITS.maxPlugins
      ) {
        throw new Error('Plugin runtime policy storage is full')
      }
      records.set(record.pluginId, structuredClone(record))
    },
    async delete(pluginId) {
      records.delete(pluginId)
    }
  }
}

export function createIdbPluginRuntimePolicyStorage(
  databaseName = PLUGIN_RUNTIME_POLICY_DATABASE_NAME
): PluginRuntimePolicyStorage {
  const storeName = 'runtimePolicy'
  let databasePromise: Promise<IDBDatabase> | null = null
  function database(): Promise<IDBDatabase> {
    databasePromise ??= openIdb(databaseName, 1, (db) => {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'pluginId' })
      }
    })
    return databasePromise
  }
  return {
    async get(pluginId) {
      const db = await database()
      const value = await runIdbReadonlyRequest(db, storeName, (store) => store.get(pluginId))
      return value ?? null
    },
    async list() {
      const db = await database()
      return runIdbReadonlyRequest(db, storeName, (store) => store.getAll())
    },
    async put(value) {
      const record = parsePluginRuntimePolicyRecord(value)
      const db = await database()
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(record)
      await txDone(transaction)
    },
    async delete(pluginId) {
      const db = await database()
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).delete(pluginId)
      await txDone(transaction)
    }
  }
}
