import type { BackendCapability, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import {
  BACKEND_PROVIDER_ADAPTER_SLOTS,
  BACKEND_PROVIDER_OUTPUT_KINDS,
  type BackendProviderAdapter,
  type BackendProviderBundle,
  type BackendProviderDescriptor,
  type BackendProviderOutputKind,
  type BackendProviderSelection
} from './contracts'
import { parseBackendProviderDescriptor, sameBackendProviderDescriptor } from './descriptor'

const BACKEND_PROVIDER_PACKAGE_DIGEST_PREFIXES = ['sha256:', 'app-bundle-sha256:'] as const
const CANONICAL_SHA256_BASE64URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const BACKEND_PROVIDER_SELECTION_KEYS = ['descriptor', 'packageDigest', 'enabled'] as const

interface BackendProviderSelectionData {
  readonly descriptor: unknown
  readonly packageDigest: unknown
  readonly enabled: unknown
}

function isCanonicalBackendProviderPackageDigest(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const prefix = BACKEND_PROVIDER_PACKAGE_DIGEST_PREFIXES.find((candidate) =>
    value.startsWith(candidate)
  )
  if (!prefix) return false
  return CANONICAL_SHA256_BASE64URL.test(value.slice(prefix.length))
}

function readBackendProviderSelection(value: unknown): BackendProviderSelectionData | undefined {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined

    const keys = Reflect.ownKeys(value)
    if (
      keys.length !== BACKEND_PROVIDER_SELECTION_KEYS.length ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !BACKEND_PROVIDER_SELECTION_KEYS.includes(
            key as (typeof BACKEND_PROVIDER_SELECTION_KEYS)[number]
          )
      )
    ) {
      return undefined
    }

    const data = Object.create(null) as Record<
      (typeof BACKEND_PROVIDER_SELECTION_KEYS)[number],
      unknown
    >
    for (const key of BACKEND_PROVIDER_SELECTION_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return undefined
      data[key] = descriptor.value
    }
    return data
  } catch {
    return undefined
  }
}

export interface ResolvedBackendProvider {
  readonly bundle: BackendProviderBundle
  readonly selection: BackendProviderSelection
}

export type BackendProviderRegistryResolveResult =
  | Readonly<{ ok: true; value: ResolvedBackendProvider }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

function error(code: string, path: string, message: string): BackendDiagnostic {
  return { code, severity: 'error', path, message }
}

function sameValues(
  left: readonly (string | number)[],
  right: readonly (string | number)[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateAdapterValues<T extends string>(
  values: readonly T[],
  known: readonly T[],
  path: string,
  diagnostics: BackendDiagnostic[]
): void {
  const seen = new Set<T>()
  const knownSet = new Set(known)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!knownSet.has(value)) {
      diagnostics.push(
        error(
          'backend-provider-registry-value-unknown',
          `${path}[${index}]`,
          'Trusted Backend Provider adapter contains an unknown contract value.'
        )
      )
    } else if (seen.has(value)) {
      diagnostics.push(
        error(
          'backend-provider-registry-value-duplicate',
          `${path}[${index}]`,
          'Trusted Backend Provider adapter contract values must be unique.'
        )
      )
    }
    seen.add(value)
  }
}

function freezeAdapter(adapter: BackendProviderAdapter): BackendProviderAdapter {
  return Object.freeze({
    capabilities: Object.freeze([...adapter.capabilities].sort()),
    outputs: Object.freeze([...adapter.outputs].sort()),
    ...(adapter.validate ? { validate: adapter.validate } : {}),
    plan: adapter.plan,
    emit: adapter.emit
  })
}

function normalizeTrustedBundle(bundle: BackendProviderBundle): {
  bundle?: BackendProviderBundle
  diagnostics: BackendDiagnostic[]
} {
  const descriptorResult = parseBackendProviderDescriptor(bundle.descriptor)
  if (!descriptorResult.ok) return { diagnostics: [...descriptorResult.diagnostics] }

  const diagnostics: BackendDiagnostic[] = []
  const capabilities = new Set<BackendCapability>()
  const outputs = new Set<BackendProviderOutputKind>()
  const normalizedAdapters: Partial<
    Record<(typeof BACKEND_PROVIDER_ADAPTER_SLOTS)[number], BackendProviderAdapter>
  > = {}

  for (const slot of BACKEND_PROVIDER_ADAPTER_SLOTS) {
    const adapter = bundle[slot]
    if (!adapter) continue
    validateAdapterValues(
      adapter.capabilities,
      descriptorResult.value.capabilities,
      `$.${slot}.capabilities`,
      diagnostics
    )
    validateAdapterValues(
      adapter.outputs,
      BACKEND_PROVIDER_OUTPUT_KINDS,
      `$.${slot}.outputs`,
      diagnostics
    )
    for (const capability of adapter.capabilities) capabilities.add(capability)
    for (const output of adapter.outputs) outputs.add(output)
    if (typeof adapter.plan !== 'function' || typeof adapter.emit !== 'function') {
      diagnostics.push(
        error(
          'backend-provider-registry-adapter-invalid',
          `$.${slot}`,
          'Trusted Backend Provider adapters must implement plan and emit.'
        )
      )
      continue
    }
    normalizedAdapters[slot] = freezeAdapter(adapter)
  }

  if (Object.keys(normalizedAdapters).length === 0) {
    diagnostics.push(
      error(
        'backend-provider-registry-adapter-required',
        '$',
        'Trusted Backend Provider bundle must contain at least one adapter.'
      )
    )
  }

  const adapterCapabilities = [...capabilities].sort()
  const adapterOutputs = [...outputs].sort()
  if (!sameValues(adapterCapabilities, descriptorResult.value.capabilities)) {
    diagnostics.push(
      error(
        'backend-provider-registry-capabilities-mismatch',
        '$.capabilities',
        'Trusted adapter capabilities must exactly match the registered descriptor.'
      )
    )
  }
  if (!sameValues(adapterOutputs, descriptorResult.value.outputs)) {
    diagnostics.push(
      error(
        'backend-provider-registry-outputs-mismatch',
        '$.outputs',
        'Trusted adapter outputs must exactly match the registered descriptor.'
      )
    )
  }
  if (diagnostics.length > 0) return { diagnostics }

  return {
    diagnostics,
    bundle: Object.freeze({
      descriptor: descriptorResult.value,
      ...normalizedAdapters,
      ...(bundle.validate ? { validate: bundle.validate } : {})
    })
  }
}

export class BackendProviderRegistryConfigurationError extends TypeError {
  readonly diagnostics: readonly BackendDiagnostic[]

  constructor(diagnostics: readonly BackendDiagnostic[]) {
    super(diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))
    this.name = 'BackendProviderRegistryConfigurationError'
    this.diagnostics = Object.freeze([...diagnostics])
  }
}

/** Immutable registry of code-reviewed Backend Provider adapters. */
export class BackendProviderRegistry {
  readonly #byAdapterId: ReadonlyMap<string, BackendProviderBundle>

  constructor(bundles: readonly BackendProviderBundle[]) {
    const byAdapterId = new Map<string, BackendProviderBundle>()
    const diagnostics: BackendDiagnostic[] = []
    for (const bundle of bundles) {
      const normalized = normalizeTrustedBundle(bundle)
      if (!normalized.bundle) {
        diagnostics.push(...normalized.diagnostics)
        continue
      }
      const { adapterId } = normalized.bundle.descriptor
      if (byAdapterId.has(adapterId)) {
        diagnostics.push(
          error(
            'backend-provider-registry-adapter-duplicate',
            '$.adapterId',
            `Trusted Backend Provider adapter "${adapterId}" is registered more than once.`
          )
        )
        continue
      }
      byAdapterId.set(adapterId, normalized.bundle)
    }
    if (diagnostics.length > 0) throw new BackendProviderRegistryConfigurationError(diagnostics)
    this.#byAdapterId = byAdapterId
  }

  list(): readonly BackendProviderDescriptor[] {
    return Object.freeze(
      [...this.#byAdapterId.values()]
        .map((bundle) => bundle.descriptor)
        .sort((left, right) => left.adapterId.localeCompare(right.adapterId, 'en'))
    )
  }

  resolve(selection: BackendProviderSelection): BackendProviderRegistryResolveResult {
    const selectionData = readBackendProviderSelection(selection)
    if (!selectionData || typeof selectionData.enabled !== 'boolean') {
      return {
        ok: false,
        diagnostics: [
          error(
            'backend-provider-selection-invalid',
            '$.selection',
            'Selected Backend Provider authority must be exact plain data.'
          )
        ]
      }
    }
    if (!selectionData.enabled) {
      return {
        ok: false,
        diagnostics: [
          error(
            'backend-provider-disabled',
            '$.selection.enabled',
            'Selected Backend Provider is disabled.'
          )
        ]
      }
    }
    if (!isCanonicalBackendProviderPackageDigest(selectionData.packageDigest)) {
      return {
        ok: false,
        diagnostics: [
          error(
            'backend-provider-package-digest-invalid',
            '$.selection.packageDigest',
            'Selected Backend Provider package digest is invalid.'
          )
        ]
      }
    }
    const descriptorResult = parseBackendProviderDescriptor(selectionData.descriptor)
    if (!descriptorResult.ok) return descriptorResult
    const bundle = this.#byAdapterId.get(descriptorResult.value.adapterId)
    if (!bundle) {
      return {
        ok: false,
        diagnostics: [
          error(
            'backend-provider-adapter-unregistered',
            '$.selection.descriptor.adapterId',
            'Selected Backend Provider adapter is not in the trusted static registry.'
          )
        ]
      }
    }
    if (!sameBackendProviderDescriptor(bundle.descriptor, descriptorResult.value)) {
      return {
        ok: false,
        diagnostics: [
          error(
            'backend-provider-descriptor-mismatch',
            '$.selection.descriptor',
            'Selected Backend Provider descriptor does not exactly match the trusted registry.'
          )
        ]
      }
    }
    return {
      ok: true,
      value: Object.freeze({
        bundle,
        selection: Object.freeze({
          descriptor: descriptorResult.value,
          packageDigest: selectionData.packageDigest,
          enabled: true
        })
      })
    }
  }
}

export function createBackendProviderRegistry(
  bundles: readonly BackendProviderBundle[]
): BackendProviderRegistry {
  return new BackendProviderRegistry(bundles)
}
