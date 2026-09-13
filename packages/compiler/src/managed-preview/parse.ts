import { parseBackendApplicationSpecV1, type BackendDiagnostic } from '@open-pencil/lowcode/backend'

import { parsePreviewLocalBackendConnection } from '../local-backend-preview/connection'
import type {
  ManagedPreviewCommand,
  ManagedPreviewConfig,
  ManagedPreviewEvent,
  ManagedPreviewPhase,
  ManagedPreviewPlan,
  ManagedPreviewState
} from './protocol'

const PHASES = [
  'empty',
  'prepared',
  'installing',
  'building',
  'migrating',
  'starting',
  'running',
  'stopped',
  'blocked',
  'failed'
] as const
const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function invalid(): never {
  throw new Error('Invalid managed preview protocol data.')
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid()
  if (Reflect.ownKeys(value).length !== keys.length) return invalid()
  const output: Record<string, unknown> = {}
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key)
    if (!field?.enumerable || !('value' in field)) return invalid()
    output[key] = field.value
  }
  return output
}
function text(value: unknown, maximum = 2048): string {
  if (typeof value !== 'string' || value.length > maximum || /\p{Cc}/u.test(value)) return invalid()
  return value
}
function digest(value: unknown): string {
  const result = text(value, 43)
  if (!DIGEST.test(result)) return invalid()
  return result
}
function choice<const Values extends readonly string[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (!values.some((entry) => entry === value)) return invalid()
  return value as Values[number]
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid()
  return value
}
function port(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1024 || value > 65535)
    return invalid()
  return value
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 256 ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return invalid()
  const result: T[] = []
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index))
    if (!property?.enumerable || !('value' in property)) return invalid()
    result.push(parse(property.value))
  }
  return result
}
function id(value: unknown): string {
  const result = text(value, 128)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) return invalid()
  return result
}
export function parseManagedPreviewSessionId(value: unknown): string {
  const result = text(value, 36)
  if (!UUID.test(result)) return invalid()
  return result
}
export function parseManagedPreviewConfig(value: unknown): ManagedPreviewConfig {
  const source = record(value, [
    'previewPort',
    'apiPort',
    'dbPort',
    'audience',
    'jwksURL',
    'caFile'
  ])
  const config = {
    previewPort: port(source.previewPort),
    apiPort: port(source.apiPort),
    dbPort: port(source.dbPort),
    audience: text(source.audience, 512),
    jwksURL: text(source.jwksURL),
    caFile: text(source.caFile, 4096)
  }
  if (
    new Set([config.previewPort, config.apiPort, config.dbPort]).size !== 3 ||
    !config.audience ||
    config.audience.trim() !== config.audience
  )
    return invalid()
  let url: URL
  try {
    url = new URL(config.jwksURL)
  } catch {
    return invalid()
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== config.jwksURL
  )
    return invalid()
  return Object.freeze(config)
}
function diagnostic(value: unknown): BackendDiagnostic {
  const source = record(value, ['code', 'severity', 'path', 'message'])
  return {
    code: text(source.code, 128),
    severity: choice(source.severity, ['error', 'warning', 'info']),
    path: text(source.path),
    message: text(source.message)
  }
}
function plan(value: unknown): ManagedPreviewPlan {
  const source = record(value, [
    'planId',
    'kind',
    'fromApplicationDigest',
    'toApplicationDigest',
    'sql',
    'summary',
    'diagnostics',
    'requiresApproval'
  ])
  if (typeof source.sql !== 'string' || source.sql.length > 1024 * 1024) return invalid()
  return {
    planId: digest(source.planId),
    kind: choice(source.kind, ['initial', 'migration', 'runtime', 'blocked']),
    fromApplicationDigest:
      source.fromApplicationDigest === null ? null : digest(source.fromApplicationDigest),
    toApplicationDigest: digest(source.toApplicationDigest),
    sql: source.sql,
    summary: list(source.summary, (item) => text(item)),
    diagnostics: list(source.diagnostics, diagnostic),
    requiresApproval: bool(source.requiresApproval)
  }
}
function state(value: unknown): ManagedPreviewState {
  const source = record(value, [
    'sessionId',
    'phase',
    'initialized',
    'applicationId',
    'applicationDigest',
    'connection',
    'plan'
  ])
  return {
    sessionId: parseManagedPreviewSessionId(source.sessionId),
    phase: choice(source.phase, PHASES),
    initialized: bool(source.initialized),
    applicationId: source.applicationId === null ? null : text(source.applicationId, 128),
    applicationDigest: source.applicationDigest === null ? null : digest(source.applicationDigest),
    connection:
      source.connection === null ? null : parsePreviewLocalBackendConnection(source.connection),
    plan: source.plan === null ? null : plan(source.plan)
  }
}
export function parseManagedPreviewCommand(value: unknown): ManagedPreviewCommand {
  if (!value || typeof value !== 'object') return invalid()
  const command = Object.getOwnPropertyDescriptor(value, 'command')?.value
  const keys = ['version', 'id', 'command']
  if (command === 'prepare') keys.push('application', 'config')
  else if (command === 'setup' || command === 'apply') keys.push('planId')
  const source = record(value, keys)
  if (source.version !== 1) return invalid()
  const base = { version: 1 as const, id: id(source.id) }
  if (command === 'prepare') {
    const application = parseBackendApplicationSpecV1(source.application)
    if (!application.ok) return invalid()
    return {
      ...base,
      command,
      application: application.value,
      config: parseManagedPreviewConfig(source.config)
    }
  }
  if (command === 'setup' || command === 'apply')
    return { ...base, command, planId: digest(source.planId) }
  return { ...base, command: choice(command, ['start', 'stop', 'status', 'close']) }
}
export function parseManagedPreviewEvent(value: unknown): ManagedPreviewEvent {
  if (!value || typeof value !== 'object') return invalid()
  const type = Object.getOwnPropertyDescriptor(value, 'type')?.value
  let fields = ['id', 'code', 'message', 'state']
  if (type === 'ready') fields = ['sessionId']
  if (type === 'result') fields = ['id', 'state']
  if (type === 'progress') fields = ['id', 'phase', 'message']
  const source = record(value, ['version', 'type', ...fields])
  if (source.version !== 1) return invalid()
  if (type === 'ready')
    return { version: 1, type, sessionId: parseManagedPreviewSessionId(source.sessionId) }
  if (type === 'result') return { version: 1, type, id: id(source.id), state: state(source.state) }
  if (type === 'progress')
    return {
      version: 1,
      type,
      id: id(source.id),
      phase: choice(source.phase, PHASES) as ManagedPreviewPhase,
      message: text(source.message)
    }
  if (type === 'error')
    return {
      version: 1,
      type,
      id: source.id === null ? null : id(source.id),
      code: text(source.code, 128),
      message: text(source.message),
      state: source.state === null ? null : state(source.state)
    }
  return invalid()
}
