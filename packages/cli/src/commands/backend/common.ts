import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

import type { CompilerTarget } from '@open-pencil/compiler'
import {
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  type BackendCompilationMode,
  type BackendProviderEmission,
  type BackendProviderPlan,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'
import {
  BACKEND_LIMITS,
  digestBackendApplication,
  evaluateProductionReleaseGates,
  normalizeBackendReleaseProviderAuthority,
  parseBackendApplicationSpecV1,
  validateBackendProductionGateResults,
  validateBackendReleaseReceipt,
  type BackendApplicationSpecV1,
  type BackendDiagnostic,
  type BackendProductionReadiness,
  type BackendReleaseEnvironment,
  type BackendReleaseProviderAuthorityV1,
  type BackendReleaseReceiptV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { readBoundedJSON } from '#cli/commands/bounded-input'
import { printError } from '#cli/format'

const BACKEND_JSON_MAX_BYTES = BACKEND_LIMITS.maxCanonicalBytes
const RECEIPT_JSON_MAX_BYTES = 256 * 1024
const GATES_JSON_MAX_BYTES = 64 * 1024
const CLI_REVIEWED_SUPABASE_DESCRIPTOR_DIGEST = '01VXHwtnQYE5uDgSIPC7i8jUD8mytXFHQgI8a_i7Qec'
const CLI_BACKEND_PROVIDER_AUTHORITY_FORMAT = 'openpencil.cli-backend-provider-authority.v1'
const COMPILER_TARGETS = new Set<string>([
  'react',
  'vue',
  'expo',
  'flutter',
  'wechat-miniprogram',
  'taro',
  'uni-app',
  'mpx'
])
const COMPILATION_MODES = new Set<string>(['preview', 'source-only-prototype', 'production'])
const RELEASE_ENVIRONMENTS = new Set<string>(['preview', 'staging', 'production'])

export const applicationArg = {
  type: 'positional',
  required: true,
  description: 'BackendApplicationSpecV1 JSON path'
} as const

export const backendProviderArg = {
  type: 'string',
  default: 'supabase',
  description: 'Reviewed Backend Provider id (currently: supabase)'
} as const

export const targetArg = {
  type: 'string',
  default: 'react',
  description:
    'Compiler target: react, vue, expo, flutter, wechat-miniprogram, taro, uni-app, or mpx'
} as const

export const modeArg = {
  type: 'string',
  default: 'production',
  description: 'Backend mode: preview, source-only-prototype, or production'
} as const

export const environmentArg = {
  type: 'string',
  default: 'production',
  description: 'Release environment: preview, staging, or production'
} as const

export const jsonArg = {
  type: 'boolean',
  default: false,
  description: 'Output JSON'
} as const

export const gatesArg = {
  type: 'string',
  description: 'Optional JSON array of strict production gate results'
} as const

export const receiptArg = {
  type: 'string',
  description: 'Optional secret-free Backend Release receipt JSON path'
} as const

export interface BackendPipelineOptions {
  readonly applicationPath: string
  readonly backendProvider: string
  readonly target: CompilerTarget
  readonly mode: BackendCompilationMode
}

export interface LocalBackendPlan {
  readonly application: BackendApplicationSpecV1
  readonly applicationDigest: string
  readonly selection: BackendProviderSelection
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly backendProviderTrustDomain: 'cli-builtin'
  readonly plan: BackendProviderPlan
  readonly diagnostics: readonly BackendDiagnostic[]
}

export interface LocalBackendEmission extends LocalBackendPlan {
  readonly emission: BackendProviderEmission
}

export interface ReceiptAudit {
  readonly provided: boolean
  readonly schemaValid: boolean
  readonly authorityMatchesLocalPlan: boolean
  readonly accepted: boolean
  readonly reason: string
  readonly binding: {
    readonly backendProvider: boolean
    readonly target: boolean
    readonly environment: boolean
    readonly applicationIrDigest: boolean
    readonly releasePlanDigestComparable: false
    readonly requiredReferences: boolean
    readonly documentAuthorityAvailable: false
    readonly compilerVersionAuthorityAvailable: false
    readonly artifactAuthorityAvailable: false
    readonly migrationAuthorityAvailable: false
  } | null
  readonly receipt: BackendReleaseReceiptV1 | null
  readonly diagnostics: readonly BackendDiagnostic[]
}

function diagnosticMessage(action: string, diagnostics: readonly BackendDiagnostic[]): string {
  const details = diagnostics
    .map((entry) => `${entry.code} (${entry.path}): ${entry.message}`)
    .join('\n')
  return `${action} failed closed.${details ? `\n${details}` : ''}`
}

export function resolveCompilerTarget(value: string): CompilerTarget {
  if (!COMPILER_TARGETS.has(value)) throw new Error(`Unsupported backend target: ${value}.`)
  return value as CompilerTarget
}

export function resolveCompilationMode(value: string): BackendCompilationMode {
  if (!COMPILATION_MODES.has(value)) throw new Error(`Unsupported backend mode: ${value}.`)
  return value as BackendCompilationMode
}

export function resolveReleaseEnvironment(value: string): BackendReleaseEnvironment {
  if (!RELEASE_ENVIRONMENTS.has(value)) {
    throw new Error(`Unsupported backend release environment: ${value}.`)
  }
  return value as BackendReleaseEnvironment
}

export async function loadBackendApplication(
  path: string
): Promise<{ application: BackendApplicationSpecV1; applicationDigest: string }> {
  const source = await readBoundedJSON(path, BACKEND_JSON_MAX_BYTES, 'Backend application')
  const parsed = parseBackendApplicationSpecV1(source)
  if (!parsed.ok) throw new Error(diagnosticMessage('Backend validation', parsed.diagnostics))
  return {
    application: parsed.value,
    applicationDigest: await digestBackendApplication(parsed.value)
  }
}

async function reviewedProvider(providerId: string): Promise<{
  selection: BackendProviderSelection
  backendProvider: BackendReleaseProviderAuthorityV1
}> {
  if (providerId !== 'supabase') {
    throw new Error(`Backend Provider '${providerId}' is not installed and reviewed by this CLI.`)
  }
  const descriptorDigest = await digestCanonicalManifest(SUPABASE_BACKEND_PROVIDER_DESCRIPTOR)
  if (descriptorDigest !== CLI_REVIEWED_SUPABASE_DESCRIPTOR_DIGEST) {
    throw new Error(
      'The built-in Backend Provider descriptor no longer matches the CLI review pin.'
    )
  }
  // The CLI reviews its compiled-in Provider descriptor directly. It is not an installed App
  // plugin package, so it must never borrow the App catalog's app-bundle digest/trust domain.
  const packageDigest = `sha256:${await digestCanonicalManifest({
    format: CLI_BACKEND_PROVIDER_AUTHORITY_FORMAT,
    publisherId: 'open-pencil',
    descriptorDigest
  })}`
  const selection: BackendProviderSelection = Object.freeze({
    descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest,
    enabled: true
  })
  const descriptor = selection.descriptor
  const backendProvider = normalizeBackendReleaseProviderAuthority({
    publisherId: 'open-pencil',
    packageDigest: selection.packageDigest,
    pluginId: descriptor.pluginId,
    contributionId: descriptor.contributionId,
    providerId: descriptor.providerId,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    contractVersion: descriptor.contractVersion,
    supportedModelVersions: descriptor.supportedModelVersions,
    capabilities: descriptor.capabilities,
    permissions: [],
    outputKinds: descriptor.outputs
  })
  return { selection, backendProvider }
}

export async function createLocalBackendPlan(
  options: BackendPipelineOptions
): Promise<LocalBackendPlan> {
  const [{ application, applicationDigest }, provider] = await Promise.all([
    loadBackendApplication(options.applicationPath),
    reviewedProvider(options.backendProvider)
  ])
  const registry = createBuiltinBackendProviderRegistry()
  const result = createBackendProviderPlan(registry, {
    selection: provider.selection,
    application,
    target: options.target,
    mode: options.mode
  })
  if (!result.ok) throw new Error(diagnosticMessage('Backend plan', result.diagnostics))
  return {
    application,
    applicationDigest,
    selection: provider.selection,
    backendProvider: provider.backendProvider,
    backendProviderTrustDomain: 'cli-builtin',
    plan: result.plan,
    diagnostics: result.diagnostics
  }
}

export async function createLocalBackendEmission(
  options: BackendPipelineOptions
): Promise<LocalBackendEmission> {
  const planned = await createLocalBackendPlan(options)
  const result = emitBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    plan: planned.plan,
    selection: planned.selection
  })
  if (!result.ok) throw new Error(diagnosticMessage('Backend emit', result.diagnostics))
  return { ...planned, emission: result.emission }
}

export async function loadProductionReadiness(
  path: string | undefined
): Promise<BackendProductionReadiness> {
  const source = path ? await readBoundedJSON(path, GATES_JSON_MAX_BYTES, 'Production gates') : []
  const parsed = validateBackendProductionGateResults(source)
  if (!parsed.ok)
    throw new Error(diagnosticMessage('Production gate validation', parsed.diagnostics))
  return evaluateProductionReleaseGates(parsed.value, new Date().toISOString())
}

function sameProviderAuthority(
  left: BackendReleaseProviderAuthorityV1,
  right: BackendReleaseProviderAuthorityV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function requiredReferences(emission: BackendProviderEmission): {
  environmentNames: string[]
  credentialRefs: string[]
} {
  const environmentNames = [
    ...new Set(
      emission.manifest.requiredSecrets
        .filter((secret) => secret.kind === 'environment')
        .map((secret) => secret.name)
    )
  ].sort()
  const credentialRefs = [
    ...new Set(
      emission.manifest.requiredSecrets
        .filter((secret) => secret.kind === 'credential')
        .map((secret) => secret.credentialRef)
    )
  ].sort()
  return { environmentNames, credentialRefs }
}

export async function auditReceipt(
  path: string | undefined,
  local: LocalBackendEmission,
  environment: BackendReleaseEnvironment
): Promise<ReceiptAudit> {
  if (!path) {
    return {
      provided: false,
      schemaValid: false,
      authorityMatchesLocalPlan: false,
      accepted: false,
      reason: 'No receipt was supplied; this CLI never fabricates an Apply receipt.',
      binding: null,
      receipt: null,
      diagnostics: []
    }
  }
  const source = await readBoundedJSON(path, RECEIPT_JSON_MAX_BYTES, 'Backend Release receipt')
  const validated = validateBackendReleaseReceipt(source)
  if (!validated.ok) {
    return {
      provided: true,
      schemaValid: false,
      authorityMatchesLocalPlan: false,
      accepted: false,
      reason: 'Receipt validation failed closed.',
      binding: null,
      receipt: null,
      diagnostics: validated.diagnostics
    }
  }
  const references = requiredReferences(local.emission)
  const binding = {
    backendProvider: sameProviderAuthority(validated.value.backendProvider, local.backendProvider),
    target: validated.value.target === local.plan.target,
    environment: validated.value.environment === environment,
    applicationIrDigest: validated.value.irDigest === local.applicationDigest,
    // A Compiler plan digest and a reducer-owned Host Release plan digest are different authority
    // domains. They become comparable only through a future bound review manifest.
    releasePlanDigestComparable: false,
    requiredReferences:
      sameStrings(validated.value.requiredEnvironmentNames, references.environmentNames) &&
      sameStrings(validated.value.requiredCredentialRefs, references.credentialRefs),
    documentAuthorityAvailable: false,
    compilerVersionAuthorityAvailable: false,
    artifactAuthorityAvailable: false,
    migrationAuthorityAvailable: false
  } as const
  const comparableMatches =
    binding.backendProvider &&
    binding.target &&
    binding.environment &&
    binding.applicationIrDigest &&
    binding.requiredReferences
  const authorityMatchesLocalPlan = false
  return {
    provided: true,
    schemaValid: true,
    authorityMatchesLocalPlan,
    accepted: false,
    reason: comparableMatches
      ? 'Comparable fields match, but this Compiler-only CLI has no document, compiler-version, artifact, migration, or reducer-owned Apply authority; receipt binding fails closed.'
      : 'Receipt document, plan, artifact, Provider, target, environment, or required-reference authority does not match this local emission.',
    binding,
    receipt: validated.value,
    diagnostics: []
  }
}

function safeDestination(root: string, path: string): string {
  const destination = resolve(root, path)
  if (!destination.startsWith(`${root}${sep}`)) {
    throw new Error(`Backend artifact path escaped the output directory: ${path}`)
  }
  return destination
}

export async function writeBackendEmission(
  outputPath: string,
  emission: BackendProviderEmission
): Promise<{ output: string; files: readonly string[] }> {
  const output = resolve(outputPath)
  await mkdir(dirname(output), { recursive: true })
  try {
    await mkdir(output)
  } catch {
    throw new Error(
      'Backend output directory must not already exist; existing files are never overwritten.'
    )
  }
  const files = [...emission.files.keys()].sort((left, right) => left.localeCompare(right, 'en'))
  for (const path of files) {
    const destination = safeDestination(output, path)
    await mkdir(dirname(destination), { recursive: true })
    const content = emission.files.get(path)
    if (content === undefined) throw new Error(`Backend artifact disappeared before write: ${path}`)
    await writeFile(destination, content, { flag: 'wx' })
  }
  return { output, files }
}

export async function runBackendCommandSafely(task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    printError(error)
    process.exitCode = 1
  }
}
