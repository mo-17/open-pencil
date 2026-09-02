import {
  lowerLegacySupabaseApplication,
  type BackendDiagnostic,
  type LegacyBackendGraph
} from '@open-pencil/lowcode/backend'

import {
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  SUPABASE_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  type BackendCompilationMode,
  type BackendProviderSelection
} from '../backend'
import type { CompilerBackendProviderRequest, CompilerOptions, CompileWarning } from '../types'

const BUILTIN_BACKEND_REGISTRY = createBuiltinBackendProviderRegistry()
const COMPILER_BUNDLED_SUPABASE_SELECTION = Object.freeze({
  descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  packageDigest: SUPABASE_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
  enabled: true
}) satisfies BackendProviderSelection

export interface CompiledBackendArtifacts {
  readonly files: ReadonlyMap<string, string | Uint8Array>
  readonly warnings: readonly CompileWarning[]
}

export class BackendProviderCompilationError extends Error {
  readonly diagnostics: readonly BackendDiagnostic[]

  constructor(diagnostics: readonly BackendDiagnostic[]) {
    const codes = [...new Set(diagnostics.map((entry) => entry.code))].sort()
    super(`Backend Provider compilation failed closed: ${codes.join(', ')}`)
    this.name = 'BackendProviderCompilationError'
    this.diagnostics = Object.freeze([...diagnostics])
  }
}

const EXPLICIT_BACKEND_PROVIDER_REQUEST_KEYS = Object.freeze(['selection', 'application'] as const)

type ExplicitBackendProviderRequestResult =
  | Readonly<{ ok: true; request?: CompilerBackendProviderRequest }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

function compilationDiagnostic(code: string, path: string, message: string): BackendDiagnostic {
  return Object.freeze({ code, severity: 'error', path, message })
}

/** Snapshot only exact own data properties before the Provider parsers inspect nested values. */
function explicitBackendProviderRequest(
  options: CompilerOptions
): ExplicitBackendProviderRequestResult {
  let value: unknown
  try {
    value = options.backendProvider
  } catch {
    value = null
  }
  if (value === undefined) return { ok: true }
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('request must be plain data')
    }
    const prototype = Object.getPrototypeOf(value)
    const keys = Reflect.ownKeys(value)
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.length !== EXPLICIT_BACKEND_PROVIDER_REQUEST_KEYS.length ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !EXPLICIT_BACKEND_PROVIDER_REQUEST_KEYS.includes(
            key as (typeof EXPLICIT_BACKEND_PROVIDER_REQUEST_KEYS)[number]
          )
      )
    ) {
      throw new TypeError('request must contain exact fields')
    }
    const data = Object.create(null) as Record<
      (typeof EXPLICIT_BACKEND_PROVIDER_REQUEST_KEYS)[number],
      unknown
    >
    for (const key of EXPLICIT_BACKEND_PROVIDER_REQUEST_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError('request fields must be enumerable data properties')
      }
      data[key] = descriptor.value
    }
    return {
      ok: true,
      request: Object.freeze({
        selection: data.selection,
        application: data.application
      }) as CompilerBackendProviderRequest
    }
  } catch {
    return {
      ok: false,
      diagnostics: [
        compilationDiagnostic(
          'backend-provider-request-invalid',
          '$.options.backendProvider',
          'Explicit Backend Provider request must contain exactly selection and application as plain data.'
        )
      ]
    }
  }
}

function compilationMode(options: CompilerOptions): BackendCompilationMode {
  return options.backendCompilationMode ?? (options.devMode ? 'preview' : 'production')
}

function hasLegacyBackendIntent(
  graph: LegacyBackendGraph,
  lowered: ReturnType<typeof lowerLegacySupabaseApplication>
): boolean {
  const root = graph.getNode(graph.rootId)
  return (
    Boolean(root?.lowcodeSupabaseConfig) ||
    (root?.lowcodeServerWorkflows?.length ?? 0) > 0 ||
    lowered.spec.dataModel.entities.length > 0 ||
    lowered.spec.workflows.workflows.length > 0 ||
    lowered.spec.capabilities.length > 0 ||
    lowered.spec.secrets.length > 0
  )
}

function uniqueDiagnostics(
  diagnostics: readonly BackendDiagnostic[]
): readonly BackendDiagnostic[] {
  const unique = new Map<string, BackendDiagnostic>()
  for (const entry of diagnostics) {
    const key = `${entry.code}\u0000${entry.severity}\u0000${entry.path}\u0000${entry.message}`
    if (!unique.has(key)) unique.set(key, entry)
  }
  return Object.freeze([...unique.values()])
}

function compileWarnings(diagnostics: readonly BackendDiagnostic[]): readonly CompileWarning[] {
  return Object.freeze(
    diagnostics.map((entry) => ({
      code: entry.code,
      message: `Backend Provider ${entry.severity}: ${entry.message} (${entry.path})`
    }))
  )
}

function blockedCompilation(
  loweringDiagnostics: readonly BackendDiagnostic[],
  providerDiagnostics: readonly BackendDiagnostic[]
): never {
  throw new BackendProviderCompilationError(
    uniqueDiagnostics([...loweringDiagnostics, ...providerDiagnostics])
  )
}

/**
 * Backend bridge for the real Compiler entrypoint. An explicit Host-resolved
 * request is authoritative; legacy Supabase lowering is used only when that
 * request is absent. The trusted Provider receives only normalized Backend IR.
 * Planning or emission failures stop the compile with structured diagnostics;
 * a production build can never silently ship only the frontend half.
 */
export function compileBackendArtifacts(
  graph: LegacyBackendGraph,
  options: CompilerOptions,
  occupiedPaths: readonly string[]
): CompiledBackendArtifacts | null {
  const lowered = lowerLegacySupabaseApplication(graph)
  const legacyIntent = hasLegacyBackendIntent(graph, lowered)
  const explicit = explicitBackendProviderRequest(options)
  if (!explicit.ok) return blockedCompilation(lowered.diagnostics, explicit.diagnostics)
  if (explicit.request && legacyIntent) {
    return blockedCompilation(lowered.diagnostics, [
      compilationDiagnostic(
        'backend-provider-authority-conflict',
        '$.options.backendProvider',
        'Explicit Backend Provider authority cannot be combined with legacy Supabase Backend intent.'
      )
    ])
  }
  if (!explicit.request && !legacyIntent) return null

  const selection = explicit.request?.selection ?? COMPILER_BUNDLED_SUPABASE_SELECTION
  const application = explicit.request?.application ?? lowered.spec
  const normalizationDiagnostics = explicit.request ? [] : lowered.diagnostics

  const planned = createBackendProviderPlan(BUILTIN_BACKEND_REGISTRY, {
    selection,
    application,
    target: options.target,
    mode: compilationMode(options)
  })
  if (!planned.ok) return blockedCompilation(normalizationDiagnostics, planned.diagnostics)

  const emitted = emitBackendProviderPlan(BUILTIN_BACKEND_REGISTRY, {
    selection,
    plan: planned.plan,
    occupiedPaths: [...occupiedPaths].sort((left, right) => left.localeCompare(right, 'en'))
  })
  if (!emitted.ok) return blockedCompilation(normalizationDiagnostics, emitted.diagnostics)

  return Object.freeze({
    files: emitted.emission.files,
    warnings: compileWarnings(
      uniqueDiagnostics([...normalizationDiagnostics, ...emitted.emission.diagnostics])
    )
  })
}
