import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSFieldType } from '../dto'

function parameterType(type: string): string {
  if (type === 'integer') return 'number'
  return type === 'boolean' ? 'boolean' : 'string'
}

export function nestJSClientCommands(application: BackendApplicationSpecV1) {
  const types: string[] = []
  const commands = (application.commands?.commands ?? []).map((command, index) => {
    const name = 'Command' + index
    const result = command.steps.find(
      (step) => step.kind !== 'assert' && step.resultName === command.return.resultName
    )
    if (!result || result.kind === 'assert') throw new Error('Missing command return source.')
    const entity = application.dataModel.entities.find((entry) => entry.id === result.entityId)
    if (!entity) throw new Error('Missing command return entity.')
    types.push(
      `export type ${name}Parameters = { ${command.parameters.map((parameter) => `${JSON.stringify(parameter.name)}: ${parameterType(parameter.type)}`).join('; ')} }`,
      `export type ${name}Result = { ${command.return.fields
        .map((id) => {
          const field = entity.fields.find((entry) => entry.id === id)
          if (!field) throw new Error('Missing command return field.')
          return `${JSON.stringify(id)}: ${nestJSFieldType(field, application.dataModel)}${field.nullable ? ' | null' : ''}`
        })
        .join('; ')} }`
    )
    return `${JSON.stringify(command.id)}: (body: ${name}Parameters, options: NestJSCommandOptions) => command<${name}Result>(${JSON.stringify(command.path)}, normalizeCommandParameters(body, ${JSON.stringify(command.parameters)}), options)`
  })
  return { types: types.join('\n'), entries: commands.join(',\n      ') }
}

/** Only finite status codes enter business branches; response bodies and SQL errors stay private. */
export const NESTJS_COMMAND_CLIENT_HELPERS = String.raw`
export interface NestJSCommandOptions { idempotencyKey: string; signal?: AbortSignal }
const COMMAND_TIMEOUT_MS = 30_000
export type BackendCommandErrorCode = 'invalid-request' | 'authentication-required' | 'forbidden' | 'not-found' | 'conflict' | 'unavailable' | 'request-failed'
export class BackendCommandError extends Error {
  readonly code: BackendCommandErrorCode
  constructor(readonly status: number) {
    super('Backend command failed.')
    this.name = 'BackendCommandError'
    this.code = status === 400 ? 'invalid-request' : status === 401 ? 'authentication-required' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 409 ? 'conflict' : status === 503 ? 'unavailable' : 'request-failed'
  }
}
export function commandError(value: unknown): BackendCommandError {
  return value instanceof BackendCommandError ? value : new BackendCommandError(0)
}
export function validCommandKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(value)
}
type CommandParameter = { name: string; type: string; required?: boolean; min?: number; max?: number; maxLength?: number }
export function normalizeCommandParameters(value: unknown, parameters: readonly CommandParameter[]): Record<string, string | number | boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new BackendCommandError(400)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== parameters.length || keys.some((key) => typeof key !== 'string' || !parameters.some((parameter) => parameter.name === key))) throw new BackendCommandError(400)
  const result: Record<string, string | number | boolean> = Object.create(null)
  for (const parameter of [...parameters].sort((left, right) => left.name.localeCompare(right.name))) {
    const descriptor = Object.getOwnPropertyDescriptor(value, parameter.name)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new BackendCommandError(400)
    const item: unknown = descriptor.value
    if (parameter.type === 'uuid') {
      if (typeof item !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) throw new BackendCommandError(400)
      result[parameter.name] = item.toLowerCase()
    } else if (parameter.type === 'integer') {
      if (typeof item !== 'number' || !Number.isInteger(item) || item < (parameter.min ?? -2147483648) || item > (parameter.max ?? 2147483647)) throw new BackendCommandError(400)
      result[parameter.name] = item === 0 ? 0 : item
    } else if (parameter.type === 'boolean') {
      if (typeof item !== 'boolean') throw new BackendCommandError(400)
      result[parameter.name] = item
    } else if (parameter.type === 'string') {
      if (typeof item !== 'string' || item.length > (parameter.maxLength ?? 512) || item.includes('\u0000') || /[\uD800-\uDFFF]/u.test(item.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))) throw new BackendCommandError(400)
      result[parameter.name] = item
    } else throw new BackendCommandError(400)
  }
  return result
}
`

export const NESTJS_COMMAND_CLIENT_METHOD = String.raw`
  async function command<T>(path: string, body: object, options: NestJSCommandOptions): Promise<T> {
    if (!options || !validCommandKey(options.idempotencyKey)) throw new BackendCommandError(400)
    if (options.signal?.aborted) throw new BackendCommandError(0)
    const controller = new AbortController()
    let timedOut = false
    let rejectInterrupted: (error: BackendCommandError) => void = () => undefined
    const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject })
    const abort = () => { rejectInterrupted(new BackendCommandError(0)); controller.abort() }
    options.signal?.addEventListener('abort', abort, { once: true })
    const deadline = setTimeout(() => {
      timedOut = true
      rejectInterrupted(new BackendCommandError(503))
      controller.abort()
    }, COMMAND_TIMEOUT_MS)
    const execute = async (): Promise<T> => {
      const token = await optionsToken()
      if (controller.signal.aborted) throw new BackendCommandError(timedOut ? 503 : 0)
      if (typeof token !== 'string' || !token || /[\r\n]/u.test(token)) throw new BackendCommandError(401)
      const response = await transport(base + path, {
        method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new BackendCommandError(response.status)
      const data: unknown = await response.json()
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new BackendCommandError(0)
      return data as T
    }
    try { return await Promise.race([execute(), interrupted]) }
    catch (error) { throw commandError(error) }
    finally { clearTimeout(deadline); options.signal?.removeEventListener('abort', abort) }
  }
`
