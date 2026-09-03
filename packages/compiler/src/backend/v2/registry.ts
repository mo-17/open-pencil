import type { BackendCapabilityV2, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import { backendCapabilityAdapterSlotV2 } from './capability-routing'
import {
  BACKEND_PROVIDER_ADAPTER_SLOTS_V2,
  BACKEND_PROVIDER_OUTPUT_KINDS_V2,
  type BackendProviderAdapterV2,
  type BackendProviderAdapterSlotV2,
  type BackendProviderBundleV2,
  type BackendProviderDescriptorV2,
  type BackendProviderOutputKindV2,
  type BackendProviderSelectionV2
} from './contracts'
import { parseBackendProviderDescriptorV2, sameBackendProviderDescriptorV2 } from './descriptor'

const BACKEND_PROVIDER_PACKAGE_DIGEST_PREFIXES_V2 = ['sha256:', 'app-bundle-sha256:'] as const
const CANONICAL_SHA256_BASE64URL_V2 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const BACKEND_PROVIDER_SELECTION_KEYS_V2 = ['descriptor', 'packageDigest', 'enabled'] as const

interface BackendProviderSelectionDataV2 {
  readonly descriptor: unknown
  readonly packageDigest: unknown
  readonly enabled: unknown
}

function errorV2(code: string, path: string, message: string): BackendDiagnostic {
  return Object.freeze({ code, severity: 'error', path, message })
}

function isCanonicalBackendProviderPackageDigestV2(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const prefix = BACKEND_PROVIDER_PACKAGE_DIGEST_PREFIXES_V2.find((candidate) =>
    value.startsWith(candidate)
  )
  return prefix !== undefined && CANONICAL_SHA256_BASE64URL_V2.test(value.slice(prefix.length))
}

function readBackendProviderSelectionV2(
  value: unknown
): BackendProviderSelectionDataV2 | undefined {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const keys = Reflect.ownKeys(value)
    if (
      keys.length !== BACKEND_PROVIDER_SELECTION_KEYS_V2.length ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !BACKEND_PROVIDER_SELECTION_KEYS_V2.includes(
            key as (typeof BACKEND_PROVIDER_SELECTION_KEYS_V2)[number]
          )
      )
    ) {
      return undefined
    }
    const data = Object.create(null) as Record<
      (typeof BACKEND_PROVIDER_SELECTION_KEYS_V2)[number],
      unknown
    >
    for (const key of BACKEND_PROVIDER_SELECTION_KEYS_V2) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return undefined
      data[key] = descriptor.value
    }
    return data
  } catch {
    return undefined
  }
}

export interface ResolvedBackendProviderV2 {
  readonly bundle: BackendProviderBundleV2
  readonly selection: BackendProviderSelectionV2
}

export type BackendProviderRegistryResolveResultV2 =
  | Readonly<{ ok: true; value: ResolvedBackendProviderV2 }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

function sameValuesV2(
  left: readonly (string | number)[],
  right: readonly (string | number)[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateAdapterValuesV2<T extends string>(
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
        errorV2(
          'backend-provider-v2-registry-value-unknown',
          `${path}[${index}]`,
          'Trusted Backend Provider V2 adapter contains an unknown contract value.'
        )
      )
    } else if (seen.has(value)) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-registry-value-duplicate',
          `${path}[${index}]`,
          'Trusted Backend Provider V2 adapter contract values must be unique.'
        )
      )
    }
    seen.add(value)
  }
}

function freezeAdapterV2(adapter: BackendProviderAdapterV2): BackendProviderAdapterV2 {
  return Object.freeze({
    capabilities: Object.freeze(
      [...adapter.capabilities].sort((left, right) => left.localeCompare(right, 'en'))
    ),
    outputs: Object.freeze(
      [...adapter.outputs].sort((left, right) => left.localeCompare(right, 'en'))
    ),
    ...(adapter.validate ? { validate: adapter.validate } : {}),
    plan: adapter.plan,
    emit: adapter.emit
  })
}

function registerAdapterCapabilitiesV2(
  adapterCapabilities: readonly BackendCapabilityV2[],
  slot: BackendProviderAdapterSlotV2,
  capabilities: Set<BackendCapabilityV2>,
  capabilityOwners: Map<BackendCapabilityV2, BackendProviderAdapterSlotV2>,
  diagnostics: BackendDiagnostic[]
): void {
  for (let index = 0; index < adapterCapabilities.length; index += 1) {
    const capability = adapterCapabilities[index]
    const owningSlot = backendCapabilityAdapterSlotV2(capability)
    if (owningSlot === undefined) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-registry-capability-unmapped',
          `$.${slot}.capabilities[${index}]`,
          'Trusted Backend Provider V2 capability has no semantic adapter slot.'
        )
      )
    } else if (owningSlot !== slot) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-registry-capability-slot-mismatch',
          `$.${slot}.capabilities[${index}]`,
          `Backend Provider V2 capability must be declared by the ${owningSlot} adapter.`
        )
      )
    }
    const previousOwner = capabilityOwners.get(capability)
    if (previousOwner !== undefined && previousOwner !== slot) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-registry-capability-duplicate',
          `$.${slot}.capabilities[${index}]`,
          `Backend Provider V2 capability is already declared by the ${previousOwner} adapter.`
        )
      )
    } else {
      capabilityOwners.set(capability, slot)
    }
    capabilities.add(capability)
  }
}

function normalizeTrustedBundleV2(bundle: BackendProviderBundleV2): {
  readonly bundle?: BackendProviderBundleV2
  readonly diagnostics: readonly BackendDiagnostic[]
} {
  let descriptor: unknown
  try {
    descriptor = bundle.descriptor
  } catch {
    descriptor = undefined
  }
  const descriptorResult = parseBackendProviderDescriptorV2(descriptor)
  if (!descriptorResult.ok) return { diagnostics: descriptorResult.diagnostics }

  const diagnostics: BackendDiagnostic[] = []
  const capabilities = new Set<BackendCapabilityV2>()
  const capabilityOwners = new Map<BackendCapabilityV2, BackendProviderAdapterSlotV2>()
  const outputs = new Set<BackendProviderOutputKindV2>()
  const normalizedAdapters: Partial<
    Record<(typeof BACKEND_PROVIDER_ADAPTER_SLOTS_V2)[number], BackendProviderAdapterV2>
  > = {}

  for (const slot of BACKEND_PROVIDER_ADAPTER_SLOTS_V2) {
    let adapter: BackendProviderAdapterV2 | undefined
    try {
      adapter = bundle[slot]
    } catch {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-registry-adapter-invalid',
          `$.${slot}`,
          'Trusted Backend Provider V2 adapters must be inert properties.'
        )
      )
      continue
    }
    if (!adapter) continue
    try {
      validateAdapterValuesV2(
        adapter.capabilities,
        descriptorResult.value.capabilities,
        `$.${slot}.capabilities`,
        diagnostics
      )
      validateAdapterValuesV2(
        adapter.outputs,
        BACKEND_PROVIDER_OUTPUT_KINDS_V2,
        `$.${slot}.outputs`,
        diagnostics
      )
      registerAdapterCapabilitiesV2(
        adapter.capabilities,
        slot,
        capabilities,
        capabilityOwners,
        diagnostics
      )
      for (const output of adapter.outputs) outputs.add(output)
      if (typeof adapter.plan !== 'function' || typeof adapter.emit !== 'function') {
        diagnostics.push(
          errorV2(
            'backend-provider-v2-registry-adapter-invalid',
            `$.${slot}`,
            'Trusted Backend Provider V2 adapters must implement plan and emit.'
          )
        )
        continue
      }
      normalizedAdapters[slot] = freezeAdapterV2(adapter)
    } catch {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-registry-adapter-invalid',
          `$.${slot}`,
          'Trusted Backend Provider V2 adapter declarations must be bounded plain values.'
        )
      )
    }
  }

  if (Object.keys(normalizedAdapters).length === 0) {
    diagnostics.push(
      errorV2(
        'backend-provider-v2-registry-adapter-required',
        '$',
        'Trusted Backend Provider V2 bundle must contain at least one adapter.'
      )
    )
  }
  const adapterCapabilities = [...capabilities].sort((left, right) =>
    left.localeCompare(right, 'en')
  )
  const adapterOutputs = [...outputs].sort((left, right) => left.localeCompare(right, 'en'))
  if (!sameValuesV2(adapterCapabilities, descriptorResult.value.capabilities)) {
    diagnostics.push(
      errorV2(
        'backend-provider-v2-registry-capabilities-mismatch',
        '$.capabilities',
        'Trusted V2 adapter capabilities must exactly match the registered descriptor.'
      )
    )
  }
  if (!sameValuesV2(adapterOutputs, descriptorResult.value.outputs)) {
    diagnostics.push(
      errorV2(
        'backend-provider-v2-registry-outputs-mismatch',
        '$.outputs',
        'Trusted V2 adapter outputs must exactly match the registered descriptor.'
      )
    )
  }
  if (diagnostics.length > 0) return { diagnostics: Object.freeze(diagnostics) }

  let validate: BackendProviderBundleV2['validate']
  try {
    validate = bundle.validate
  } catch {
    return {
      diagnostics: Object.freeze([
        errorV2(
          'backend-provider-v2-registry-adapter-invalid',
          '$.validate',
          'Trusted Backend Provider V2 bundle validation must be an inert function property.'
        )
      ])
    }
  }
  if (validate !== undefined && typeof validate !== 'function') {
    return {
      diagnostics: Object.freeze([
        errorV2(
          'backend-provider-v2-registry-adapter-invalid',
          '$.validate',
          'Trusted Backend Provider V2 bundle validation must be a function.'
        )
      ])
    }
  }
  return {
    diagnostics: Object.freeze([]),
    bundle: Object.freeze({
      descriptor: descriptorResult.value,
      ...normalizedAdapters,
      ...(validate ? { validate } : {})
    })
  }
}

// oxlint-disable-next-line unicorn/custom-error-definition -- Public versioned APIs use the V2 suffix.
export class BackendProviderRegistryConfigurationErrorV2 extends TypeError {
  readonly diagnostics: readonly BackendDiagnostic[]

  constructor(diagnostics: readonly BackendDiagnostic[]) {
    super(diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n'))
    this.name = 'BackendProviderRegistryConfigurationErrorV2'
    this.diagnostics = Object.freeze([...diagnostics])
  }
}

/** Immutable registry of code-reviewed Backend Provider V2 adapters. */
export class BackendProviderRegistryV2 {
  readonly #byAdapterId: ReadonlyMap<string, BackendProviderBundleV2>

  constructor(bundles: readonly BackendProviderBundleV2[]) {
    const byAdapterId = new Map<string, BackendProviderBundleV2>()
    const diagnostics: BackendDiagnostic[] = []
    for (const bundle of bundles) {
      const normalized = normalizeTrustedBundleV2(bundle)
      if (!normalized.bundle) {
        diagnostics.push(...normalized.diagnostics)
        continue
      }
      const { adapterId } = normalized.bundle.descriptor
      if (byAdapterId.has(adapterId)) {
        diagnostics.push(
          errorV2(
            'backend-provider-v2-registry-adapter-duplicate',
            '$.adapterId',
            `Trusted Backend Provider V2 adapter "${adapterId}" is registered more than once.`
          )
        )
        continue
      }
      byAdapterId.set(adapterId, normalized.bundle)
    }
    if (diagnostics.length > 0) {
      throw new BackendProviderRegistryConfigurationErrorV2(diagnostics)
    }
    this.#byAdapterId = byAdapterId
  }

  list(): readonly BackendProviderDescriptorV2[] {
    return Object.freeze(
      [...this.#byAdapterId.values()]
        .map((bundle) => bundle.descriptor)
        .sort((left, right) => left.adapterId.localeCompare(right.adapterId, 'en'))
    )
  }

  resolve(selection: BackendProviderSelectionV2): BackendProviderRegistryResolveResultV2 {
    const selectionData = readBackendProviderSelectionV2(selection)
    if (!selectionData || typeof selectionData.enabled !== 'boolean') {
      return {
        ok: false,
        diagnostics: Object.freeze([
          errorV2(
            'backend-provider-v2-selection-invalid',
            '$.selection',
            'Selected Backend Provider V2 authority must be exact plain data.'
          )
        ])
      }
    }
    if (!selectionData.enabled) {
      return {
        ok: false,
        diagnostics: Object.freeze([
          errorV2(
            'backend-provider-v2-disabled',
            '$.selection.enabled',
            'Selected Backend Provider V2 is disabled.'
          )
        ])
      }
    }
    if (!isCanonicalBackendProviderPackageDigestV2(selectionData.packageDigest)) {
      return {
        ok: false,
        diagnostics: Object.freeze([
          errorV2(
            'backend-provider-v2-package-digest-invalid',
            '$.selection.packageDigest',
            'Selected Backend Provider V2 package digest is invalid.'
          )
        ])
      }
    }
    const descriptorResult = parseBackendProviderDescriptorV2(selectionData.descriptor)
    if (!descriptorResult.ok) return descriptorResult
    const bundle = this.#byAdapterId.get(descriptorResult.value.adapterId)
    if (!bundle) {
      return {
        ok: false,
        diagnostics: Object.freeze([
          errorV2(
            'backend-provider-v2-adapter-unregistered',
            '$.selection.descriptor.adapterId',
            'Selected Backend Provider V2 adapter is not in the trusted static registry.'
          )
        ])
      }
    }
    if (!sameBackendProviderDescriptorV2(bundle.descriptor, descriptorResult.value)) {
      return {
        ok: false,
        diagnostics: Object.freeze([
          errorV2(
            'backend-provider-v2-descriptor-mismatch',
            '$.selection.descriptor',
            'Selected Backend Provider V2 descriptor does not exactly match the trusted registry.'
          )
        ])
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

export function createBackendProviderRegistryV2(
  bundles: readonly BackendProviderBundleV2[]
): BackendProviderRegistryV2 {
  return new BackendProviderRegistryV2(bundles)
}
