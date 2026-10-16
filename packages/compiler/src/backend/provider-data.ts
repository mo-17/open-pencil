import type { BackendDiagnostic } from '@open-pencil/lowcode/backend'

import { freezeBackendValue } from './canonical'
import type { BackendProviderDescriptor, BackendProviderSelection } from './contracts'
import { hasOnlyBackendArrayIndexes } from './data-shape'
import type { BackendProviderDescriptorV2, BackendProviderSelectionV2 } from './v2/contracts'

type ProviderVersion = 1 | 2

export function providerContractDiagnostic(
  version: ProviderVersion,
  suffix: string,
  path: string,
  message: string
): BackendDiagnostic {
  const diagnostic: BackendDiagnostic = {
    code: `backend-provider-${version === 2 ? 'v2-' : ''}${suffix}`,
    severity: 'error',
    path,
    message
  }
  return version === 2 ? Object.freeze(diagnostic) : diagnostic
}

export function readExactBackendData<const Keys extends readonly string[]>(
  value: unknown,
  allowed: Keys
): Record<Keys[number], unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== allowed.length ||
    keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
  )
    return undefined
  const data = Object.create(null) as Record<Keys[number], unknown>
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return undefined
    data[key as Keys[number]] = descriptor.value
  }
  return data
}

export function sameProviderValues(
  left: readonly (string | number)[],
  right: readonly (string | number)[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function validateTrustedAdapterValues<T extends string>(
  values: readonly T[],
  known: readonly T[],
  path: string,
  diagnostics: BackendDiagnostic[],
  version: ProviderVersion
): void {
  const seen = new Set<T>()
  const knownSet = new Set(known)
  const label = version === 2 ? 'Trusted Backend Provider V2' : 'Trusted Backend Provider'
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!knownSet.has(value)) {
      diagnostics.push(
        providerContractDiagnostic(
          version,
          'registry-value-unknown',
          `${path}[${index}]`,
          `${label} adapter contains an unknown contract value.`
        )
      )
    } else if (seen.has(value)) {
      diagnostics.push(
        providerContractDiagnostic(
          version,
          'registry-value-duplicate',
          `${path}[${index}]`,
          `${label} adapter contract values must be unique.`
        )
      )
    }
    seen.add(value)
  }
}

export function providerRegistryErrorDetails(diagnostics: readonly BackendDiagnostic[]) {
  return {
    message: diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n'),
    diagnostics: Object.freeze([...diagnostics])
  }
}

export function listProviderDescriptors<T extends { readonly adapterId: string }>(
  bundles: Iterable<{ readonly descriptor: T }>
): readonly T[] {
  return Object.freeze(
    [...bundles]
      .map((bundle) => bundle.descriptor)
      .sort((left, right) => left.adapterId.localeCompare(right.adapterId, 'en'))
  )
}

export function providerAuthorityData(
  selection: BackendProviderSelection | BackendProviderSelectionV2
) {
  const descriptor = selection.descriptor
  return freezeBackendValue({
    pluginId: descriptor.pluginId,
    packageDigest: selection.packageDigest,
    contributionId: descriptor.contributionId,
    providerId: descriptor.providerId,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    contractVersion: descriptor.contractVersion,
    supportedModelVersions: [...descriptor.supportedModelVersions],
    capabilities: [...descriptor.capabilities],
    outputs: [...descriptor.outputs]
  })
}

export function sameProviderDescriptorData(
  left: BackendProviderDescriptor | BackendProviderDescriptorV2,
  right: BackendProviderDescriptor | BackendProviderDescriptorV2
): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.contributionId === right.contributionId &&
    left.providerId === right.providerId &&
    left.adapterId === right.adapterId &&
    left.adapterVersion === right.adapterVersion &&
    left.contractVersion === right.contractVersion &&
    left.supportedModelVersions.join('\u0000') === right.supportedModelVersions.join('\u0000') &&
    left.capabilities.join('\u0000') === right.capabilities.join('\u0000') &&
    left.outputs.join('\u0000') === right.outputs.join('\u0000')
  )
}

export function readProviderDescriptorStrings<T extends string>(
  value: unknown,
  path: string,
  known: readonly T[],
  diagnostics: BackendDiagnostic[],
  version: ProviderVersion
): readonly T[] | undefined {
  const entries = readProviderDescriptorArray(value, path, known.length, diagnostics, version)
  if (!entries) return undefined
  const label = version === 2 ? 'Provider V2' : 'Provider'
  const accepted = new Set<T>()
  const knownSet = new Set<string>(known)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (typeof entry !== 'string' || !knownSet.has(entry)) {
      diagnostics.push(
        providerContractDiagnostic(
          version,
          'descriptor-value-unknown',
          `${path}[${index}]`,
          `${label} descriptor contains an unknown contract value.`
        )
      )
    } else if (accepted.has(entry as T)) {
      diagnostics.push(
        providerContractDiagnostic(
          version,
          'descriptor-value-duplicate',
          `${path}[${index}]`,
          `${label} descriptor values must be unique.`
        )
      )
    } else {
      accepted.add(entry as T)
    }
  }
  return version === 1
    ? [...accepted].sort()
    : [...accepted].sort((left, right) => left.localeCompare(right, 'en'))
}

export function readProviderDescriptorArray(
  value: unknown,
  path: string,
  maxLength: number,
  diagnostics: BackendDiagnostic[],
  version: ProviderVersion
): readonly unknown[] | undefined {
  const label = version === 2 ? 'Provider V2' : 'Provider'
  const invalid = (at: string, message: string) =>
    diagnostics.push(providerContractDiagnostic(version, 'descriptor-array-invalid', at, message))
  if (!Array.isArray(value)) {
    invalid(path, `${label} descriptor arrays must contain 1 to ${maxLength} entries.`)
    return undefined
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalid(path, `${label} descriptor arrays must be plain arrays.`)
    return undefined
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!lengthDescriptor || !('value' in lengthDescriptor)) {
    invalid(path, `${label} descriptor array length must be data-only.`)
    return undefined
  }
  const length = lengthDescriptor.value
  if (!Number.isSafeInteger(length) || length < 1 || length > maxLength) {
    invalid(path, `${label} descriptor arrays must contain 1 to ${maxLength} entries.`)
    return undefined
  }
  if (!hasOnlyBackendArrayIndexes(value, length)) {
    invalid(path, `${label} descriptor arrays must not contain symbols or custom properties.`)
    return undefined
  }
  const entries: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      invalid(
        `${path}[${index}]`,
        `${label} descriptor arrays must contain enumerable data properties only.`
      )
      return undefined
    }
    entries.push(descriptor.value)
  }
  return entries
}
