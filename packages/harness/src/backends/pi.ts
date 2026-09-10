import { createPi } from '@ai-sdk/harness-pi'
import type { PiAuthenticationMode } from '@ai-sdk/harness-pi'
import { HarnessAgent } from '@ai-sdk/harness/agent'
import type { HarnessAgentResumeSessionState, HarnessAgentSession } from '@ai-sdk/harness/agent'
// eslint-disable-next-line open-pencil/no-mixed-case-acronym-identifiers -- Preserve the external SDK export name.
import { getAiGatewayAuthFromEnv as getAIGatewayAuthFromEnv } from '@ai-sdk/harness/utils'
import { createJustBashSandbox } from '@ai-sdk/sandbox-just-bash'
import type { TextStreamPart, ToolSet } from 'ai'

import type { HarnessSessionConfiguration, JSONValue } from '../protocol'

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value }
}

function restoreEnvironment(previous: Map<string, string | undefined>): void {
  for (const [name, value] of previous) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
}

async function withEnvironment<T>(
  environment: Record<string, string>,
  run: () => Promise<T>
): Promise<T> {
  const previous = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(environment)) {
    previous.set(name, process.env[name])
    process.env[name] = value
  }
  try {
    return await run()
  } finally {
    restoreEnvironment(previous)
  }
}
import type { BackendEvent, BackendSession, HarnessBackend, HarnessResumeState } from './types'

export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface LegacyPiAuthOptions {
  gateway?: {
    apiKey?: string
    baseUrl?: string
  }
  customEnv?: Record<string, string>
}

export type PiHarnessAuthOptions = PiAuthenticationMode | LegacyPiAuthOptions

export interface PiHarnessBackendOptions {
  auth?: PiHarnessAuthOptions
  apiKey?: string
  model?: string
  thinkingLevel?: PiThinkingLevel
  agentDir?: string
  mcpServers?: Record<string, unknown>
  instructions?: string
  permissionMode?: 'allow-all' | 'allow-reads' | 'allow-edits'
}

interface NormalizedPiAuthOptions {
  auth?: PiAuthenticationMode
  environment: Record<string, string>
}

function isLegacyPiAuthOptions(value: unknown): value is LegacyPiAuthOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.hasOwn(value, 'gateway') || Object.hasOwn(value, 'customEnv'))
  )
}

function stringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be a string record`)
  }
  const result: Record<string, string> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new TypeError(`${field}.${name} must be a string`)
    result[name] = entry
  }
  return result
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  return value
}

function gatewayOptions(value: unknown): LegacyPiAuthOptions['gateway'] {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('auth.gateway must be an object')
  }
  return {
    ...optional('apiKey', optionalString(Reflect.get(value, 'apiKey'), 'auth.gateway.apiKey')),
    ...optional('baseUrl', optionalString(Reflect.get(value, 'baseUrl'), 'auth.gateway.baseUrl'))
  }
}

function defaultGatewayEnvironment(apiKey: string | undefined): Record<string, string> {
  return apiKey === undefined ? {} : { AI_GATEWAY_API_KEY: apiKey }
}

function normalizeLegacyPiAuthOptions(
  auth: LegacyPiAuthOptions,
  apiKey: string | undefined,
  ambientEnvironment: Record<string, string | undefined>
): NormalizedPiAuthOptions {
  const customEnvironment = stringRecord(auth.customEnv, 'auth.customEnv')
  if (customEnvironment && Object.values(customEnvironment).some((value) => value.length > 0)) {
    return { auth: customEnvironment, environment: {} }
  }

  const gateway = gatewayOptions(auth.gateway)
  const gatewayAPIKey = gateway?.apiKey
  const gatewayBaseURL = gateway?.baseUrl
  if ((gatewayAPIKey?.length ?? 0) > 0 || (gatewayBaseURL?.length ?? 0) > 0) {
    const ambientGateway = getAIGatewayAuthFromEnv({ env: ambientEnvironment })
    const resolvedAPIKey = gatewayAPIKey ?? apiKey ?? ambientGateway.apiKey
    return {
      auth: {
        ...(resolvedAPIKey === undefined ? {} : { AI_GATEWAY_API_KEY: resolvedAPIKey }),
        AI_GATEWAY_BASE_URL: gatewayBaseURL ?? ambientGateway.baseUrl
      },
      environment: {}
    }
  }

  return { environment: defaultGatewayEnvironment(apiKey) }
}

export function normalizePiAuthOptions(
  auth: PiHarnessAuthOptions | undefined,
  apiKey?: string,
  ambientEnvironment: Record<string, string | undefined> = process.env
): NormalizedPiAuthOptions {
  if (auth === undefined || typeof auth === 'string') {
    return { ...optional('auth', auth), environment: defaultGatewayEnvironment(apiKey) }
  }
  if (!isLegacyPiAuthOptions(auth)) return { auth, environment: {} }
  return normalizeLegacyPiAuthOptions(auth, apiKey, ambientEnvironment)
}

function asJSONValue(value: unknown): JSONValue {
  if (value === undefined || typeof value === 'bigint' || typeof value === 'function') return null
  try {
    const clone = structuredClone(value)
    JSON.stringify(clone)
    return clone as JSONValue
  } catch {
    return null
  }
}

function mapPart(part: TextStreamPart<ToolSet>): BackendEvent | undefined {
  if (part.type === 'text-delta') return { type: 'text-delta', text: part.text }
  if (part.type === 'reasoning-delta') return { type: 'reasoning-delta', text: part.text }
  if (part.type === 'tool-call') {
    return {
      type: 'tool-call',
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: asJSONValue(part.input)
    }
  }
  if (part.type === 'tool-result') {
    return {
      type: 'tool-result',
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: asJSONValue(part.output)
    }
  }
  if (part.type === 'finish') return { type: 'finish', finishReason: part.finishReason }
  if (part.type === 'error') {
    return {
      type: 'error',
      message: part.error instanceof Error ? part.error.message : String(part.error)
    }
  }
  return undefined
}

class PiBackendSession implements BackendSession {
  readonly sessionId: string
  readonly isResume: boolean

  constructor(
    private readonly agent: HarnessAgent,
    private readonly session: HarnessAgentSession
  ) {
    this.sessionId = session.sessionId
    this.isResume = session.isResume
  }

  async *runTurn(prompt: string, signal?: AbortSignal): AsyncIterable<BackendEvent> {
    const result = await this.agent.stream({ session: this.session, prompt, abortSignal: signal })
    for await (const part of result.fullStream) {
      const event = mapPart(part)
      if (event) yield event
    }
  }

  async stop(): Promise<HarnessResumeState> {
    return (await this.session.stop()) as HarnessResumeState
  }

  async destroy(): Promise<void> {
    await this.session.destroy()
  }
}

export class PiHarnessBackend implements HarnessBackend {
  readonly id = 'pi'
  readonly capabilities = {
    adapter: 'pi',
    sandboxes: ['just-bash'],
    structuredOutput: false,
    sessionResume: 'live-process',
    turnContinuation: true
  } as const

  constructor(private readonly defaults: PiHarnessBackendOptions = {}) {}

  async createSession(options: {
    sessionId: string
    resumeState?: HarnessResumeState
    configuration?: HarnessSessionConfiguration
    signal?: AbortSignal
  }): Promise<BackendSession> {
    const configuration = options.configuration
    if (!configuration) throw new Error('Harness configuration is required')
    const thinkingLevel =
      typeof configuration.settings?.thinkingLevel === 'string'
        ? (configuration.settings.thinkingLevel as PiThinkingLevel)
        : undefined
    const permissionMode =
      typeof configuration.settings?.permissionMode === 'string'
        ? (configuration.settings.permissionMode as PiHarnessBackendOptions['permissionMode'])
        : undefined
    const normalizedAuth = normalizePiAuthOptions(this.defaults.auth, this.defaults.apiKey)
    return withEnvironment(normalizedAuth.environment, async () => {
      const harness = createPi({
        ...optional('auth', normalizedAuth.auth),
        ...optional('model', configuration.model),
        ...optional('thinkingLevel', thinkingLevel ?? this.defaults.thinkingLevel),
        ...optional('agentDir', this.defaults.agentDir),
        ...optional('mcpServers', options.configuration?.mcpServers ?? this.defaults.mcpServers)
      })
      const agent = new HarnessAgent({
        harness,
        sandbox: createJustBashSandbox({ cwd: '/workspace' }),
        sandboxConfig: { workDir: 'workspace' },
        ...optional('instructions', configuration.instructions ?? this.defaults.instructions),
        permissionMode: permissionMode ?? this.defaults.permissionMode ?? 'allow-edits'
      })
      const sessionOptions: {
        sessionId: string
        resumeFrom?: HarnessAgentResumeSessionState
        abortSignal?: AbortSignal
      } = { sessionId: options.sessionId }
      if (options.resumeState !== undefined) {
        sessionOptions.resumeFrom = options.resumeState as HarnessAgentResumeSessionState
      }
      if (options.signal !== undefined) sessionOptions.abortSignal = options.signal
      const session = await agent.createSession(sessionOptions)
      return new PiBackendSession(agent, session)
    })
  }
}
