import type { ServerDeploymentInstructions } from '@open-pencil/compiler/build'

import {
  deployRuntimeConfigSnapshot,
  type DeployEnvironment,
  type DeployRuntimeConfig
} from './history'

export type DeployCommandProvider = 'netlify' | 'vercel' | 'cloudflare'

export type DeployServerDeploymentNotice = ServerDeploymentInstructions

export interface DeployCliResult {
  provider: DeployCommandProvider
  url: string
  deployId: string
  fileCount: number
  environment: DeployEnvironment
  serverDeployment?: DeployServerDeploymentNotice
}

const TOKEN_ENV: Record<DeployCommandProvider, string> = {
  netlify: 'NETLIFY_AUTH_TOKEN',
  vercel: 'VERCEL_TOKEN',
  cloudflare: 'CLOUDFLARE_API_TOKEN'
}

export const OPENPENCIL_DEPLOY_RUNTIME_MODE_ENV = 'OPENPENCIL_DEPLOY_RUNTIME_MODE'
export const OPENPENCIL_DEPLOY_SUPABASE_URL_ENV = 'OPENPENCIL_DEPLOY_SUPABASE_URL'
export const OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY_ENV = 'OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY'
export const OPENPENCIL_DEPLOY_SUPABASE_SCHEMA_ENV = 'OPENPENCIL_DEPLOY_SUPABASE_SCHEMA'
export const OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET_ENV = 'OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET'

const SERVER_DEPLOYMENT_WARNING =
  'Server workflows were generated but were not deployed. OpenPencil does not upload server code or configure server secrets automatically.'
const SERVER_DEPLOYMENT_COMMAND_PREFIXES = [
  'bun open-pencil build ',
  'supabase functions deploy openpencil-runtime --workdir '
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`Deploy output has an invalid ${label}.`)
  }
  return value
}

function parseServerDeployment(value: unknown): DeployServerDeploymentNotice | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || value.required !== true) {
    throw new Error('Deploy output has an invalid server deployment notice.')
  }
  const warning = boundedString(value.warning, 'server deployment warning', 512)
  if (warning !== SERVER_DEPLOYMENT_WARNING) {
    throw new Error('Deploy output has an unrecognized server deployment warning.')
  }
  const artifactDirectory = boundedString(
    value.artifactDirectory,
    'server artifact directory',
    4096
  )
  if (!Array.isArray(value.commands) || value.commands.length === 0 || value.commands.length > 4) {
    throw new Error('Deploy output has invalid server deployment commands.')
  }
  const commands = value.commands.map((command) => {
    const parsed = boundedString(command, 'server deployment command', 8192)
    if (!SERVER_DEPLOYMENT_COMMAND_PREFIXES.some((prefix) => parsed.startsWith(prefix))) {
      throw new Error('Deploy output has an unrecognized server deployment command.')
    }
    return parsed
  })
  return { required: true, warning, artifactDirectory, commands }
}

/** Parse the CLI sidecar response before it reaches the UI. The desktop app
 * only accepts the documented, non-secret result shape and never executes
 * server deployment instructions returned by the child process. */
export function parseDeployCliResult(raw: string): DeployCliResult {
  if (raw.length === 0 || raw.length > 1024 * 1024) {
    throw new Error('Deploy output is empty or too large.')
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Could not parse deploy output.')
  }
  if (!isRecord(value)) throw new Error('Deploy output must be an object.')

  const provider = value.provider
  if (provider !== 'netlify' && provider !== 'vercel' && provider !== 'cloudflare') {
    throw new Error('Deploy output has an invalid provider.')
  }
  const environment = value.environment
  if (environment !== 'preview' && environment !== 'staging' && environment !== 'production') {
    throw new Error('Deploy output has an invalid environment.')
  }
  const url = boundedString(value.url, 'URL', 4096)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Deploy output has an invalid URL.')
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Deploy output has an invalid URL protocol.')
  }
  const deployId = boundedString(value.deployId, 'deploy ID', 1024)
  const fileCount = value.fileCount
  if (!Number.isSafeInteger(fileCount) || (fileCount as number) < 0) {
    throw new Error('Deploy output has an invalid file count.')
  }

  return {
    provider,
    url,
    deployId,
    fileCount: fileCount as number,
    environment,
    serverDeployment: parseServerDeployment(value.serverDeployment)
  }
}

/** Build the child-process environment without putting provider credentials or
 * runtime configuration in argv. Undefined runtime overrides stay absent so
 * the compiler's design-time fallback remains active. */
export function buildDeployProcessEnv(
  provider: DeployCommandProvider,
  token: string,
  runtimeConfig?: DeployRuntimeConfig
): Record<string, string> {
  const env: Record<string, string> = {
    [TOKEN_ENV[provider]]: token,
    [OPENPENCIL_DEPLOY_RUNTIME_MODE_ENV]: 'explicit',
    [OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET_ENV]: '1'
  }
  const safeRuntimeConfig = deployRuntimeConfigSnapshot(runtimeConfig)
  if (safeRuntimeConfig?.supabaseUrl) {
    env[OPENPENCIL_DEPLOY_SUPABASE_URL_ENV] = safeRuntimeConfig.supabaseUrl
  }
  if (safeRuntimeConfig?.supabaseAnonKey) {
    env[OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY_ENV] = safeRuntimeConfig.supabaseAnonKey
  }
  if (safeRuntimeConfig?.supabaseSchema) {
    env[OPENPENCIL_DEPLOY_SUPABASE_SCHEMA_ENV] = safeRuntimeConfig.supabaseSchema
  }
  return env
}
