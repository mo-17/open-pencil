import {
  BACKEND_APPLICATION_SPEC_V2_VERSION,
  BACKEND_CAPABILITIES_V2,
  containsBackendSecretLikeMaterial,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'

import {
  BACKEND_PROVIDER_CONTRACT_VERSION_V2,
  BACKEND_PROVIDER_OUTPUT_KINDS_V2,
  type BackendProviderDescriptorV2,
  type BackendProviderModelVersionV2
} from './contracts'

const DESCRIPTOR_KEYS_V2 = Object.freeze([
  'pluginId',
  'contributionId',
  'providerId',
  'adapterId',
  'adapterVersion',
  'contractVersion',
  'supportedModelVersions',
  'capabilities',
  'outputs'
] as const)

const SAFE_ID_V2 = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u
const SAFE_VERSION_V2 = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

export type BackendProviderDescriptorParseResultV2 =
  | Readonly<{ ok: true; value: BackendProviderDescriptorV2 }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

interface BackendProviderDescriptorDataV2 {
  [key: string]: unknown
}

function errorV2(code: string, path: string, message: string): BackendDiagnostic {
  return Object.freeze({ code, severity: 'error', path, message })
}

function safeIdV2(
  value: unknown,
  path: string,
  diagnostics: BackendDiagnostic[]
): string | undefined {
  if (
    typeof value !== 'string' ||
    containsBackendSecretLikeMaterial(value) ||
    !SAFE_ID_V2.test(value)
  ) {
    diagnostics.push(
      errorV2(
        'backend-provider-v2-descriptor-id-invalid',
        path,
        'Provider V2 descriptor identifiers must be bounded lowercase identifiers.'
      )
    )
    return undefined
  }
  return value
}

interface DescriptorArrayShapeV2 {
  readonly value: readonly unknown[]
  readonly length: number
}

function invalidDescriptorArrayV2(
  diagnostics: BackendDiagnostic[],
  path: string,
  message: string
): void {
  diagnostics.push(errorV2('backend-provider-v2-descriptor-array-invalid', path, message))
}

function descriptorArrayShapeV2(
  value: unknown,
  path: string,
  maxLength: number,
  diagnostics: BackendDiagnostic[]
): DescriptorArrayShapeV2 | undefined {
  if (!Array.isArray(value)) {
    invalidDescriptorArrayV2(
      diagnostics,
      path,
      `Provider V2 descriptor arrays must contain 1 to ${maxLength} entries.`
    )
    return undefined
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalidDescriptorArrayV2(
      diagnostics,
      path,
      'Provider V2 descriptor arrays must be plain arrays.'
    )
    return undefined
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!lengthDescriptor || !('value' in lengthDescriptor)) {
    invalidDescriptorArrayV2(
      diagnostics,
      path,
      'Provider V2 descriptor array length must be data-only.'
    )
    return undefined
  }
  const length = lengthDescriptor.value
  if (!Number.isSafeInteger(length) || length < 1 || length > maxLength) {
    invalidDescriptorArrayV2(
      diagnostics,
      path,
      `Provider V2 descriptor arrays must contain 1 to ${maxLength} entries.`
    )
    return undefined
  }
  return { value, length }
}

function descriptorArrayEntriesV2(
  value: readonly unknown[],
  length: number,
  path: string,
  diagnostics: BackendDiagnostic[]
): readonly unknown[] | undefined {
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    const index = typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      invalidDescriptorArrayV2(
        diagnostics,
        path,
        'Provider V2 descriptor arrays must not contain symbols or custom properties.'
      )
      return undefined
    }
  }
  const entries: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      invalidDescriptorArrayV2(
        diagnostics,
        `${path}[${index}]`,
        'Provider V2 descriptor arrays must contain enumerable data properties only.'
      )
      return undefined
    }
    entries.push(descriptor.value)
  }
  return entries
}

function descriptorArrayDataV2(
  value: unknown,
  path: string,
  maxLength: number,
  diagnostics: BackendDiagnostic[]
): readonly unknown[] | undefined {
  const shape = descriptorArrayShapeV2(value, path, maxLength, diagnostics)
  return shape ? descriptorArrayEntriesV2(shape.value, shape.length, path, diagnostics) : undefined
}

function uniqueKnownStringsV2<T extends string>(
  value: unknown,
  path: string,
  known: readonly T[],
  diagnostics: BackendDiagnostic[]
): readonly T[] | undefined {
  const entries = descriptorArrayDataV2(value, path, known.length, diagnostics)
  if (!entries) return undefined
  const accepted = new Set<T>()
  const knownSet = new Set<string>(known)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (typeof entry !== 'string' || !knownSet.has(entry)) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-descriptor-value-unknown',
          `${path}[${index}]`,
          'Provider V2 descriptor contains an unknown contract value.'
        )
      )
      continue
    }
    if (accepted.has(entry as T)) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-descriptor-value-duplicate',
          `${path}[${index}]`,
          'Provider V2 descriptor values must be unique.'
        )
      )
      continue
    }
    accepted.add(entry as T)
  }
  return [...accepted].sort((left, right) => left.localeCompare(right, 'en'))
}

function readDescriptorDataV2(
  value: unknown,
  diagnostics: BackendDiagnostic[]
): BackendProviderDescriptorDataV2 | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    diagnostics.push(
      errorV2(
        'backend-provider-v2-descriptor-object-invalid',
        '$',
        'Backend Provider V2 descriptor must be a plain data object.'
      )
    )
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const data: BackendProviderDescriptorDataV2 = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== 'string' ||
      !DESCRIPTOR_KEYS_V2.includes(key as (typeof DESCRIPTOR_KEYS_V2)[number])
    ) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-descriptor-field-unknown',
          '$',
          'Unknown Backend Provider V2 descriptor fields are not allowed.'
        )
      )
      continue
    }
    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !('value' in descriptor)) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-descriptor-field-invalid',
          '$',
          'Backend Provider V2 descriptor fields must be enumerable data properties.'
        )
      )
    } else {
      data[key] = descriptor.value
    }
  }
  for (const key of DESCRIPTOR_KEYS_V2) {
    if (!Object.hasOwn(value, key)) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-descriptor-field-required',
          `$.${key}`,
          'Required Backend Provider V2 descriptor field is missing.'
        )
      )
    }
  }
  return data
}

function adapterVersionV2(value: unknown, diagnostics: BackendDiagnostic[]): string | undefined {
  if (
    typeof value === 'string' &&
    !containsBackendSecretLikeMaterial(value) &&
    value.length <= 64 &&
    SAFE_VERSION_V2.test(value)
  ) {
    return value
  }
  diagnostics.push(
    errorV2(
      'backend-provider-v2-descriptor-version-invalid',
      '$.adapterVersion',
      'Adapter V2 version must be a bounded semantic version.'
    )
  )
  return undefined
}

function modelVersionsV2(
  value: unknown,
  diagnostics: BackendDiagnostic[]
): readonly BackendProviderModelVersionV2[] | undefined {
  const entries = descriptorArrayDataV2(value, '$.supportedModelVersions', 2, diagnostics)
  if (!entries) return undefined
  const versions = new Set<BackendProviderModelVersionV2>()
  for (let index = 0; index < entries.length; index += 1) {
    const version = entries[index]
    if (version !== 1 && version !== BACKEND_APPLICATION_SPEC_V2_VERSION) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-model-version-unsupported',
          `$.supportedModelVersions[${index}]`,
          'Backend Provider V2 declares an unsupported model version.'
        )
      )
    } else if (versions.has(version)) {
      diagnostics.push(
        errorV2(
          'backend-provider-v2-descriptor-value-duplicate',
          `$.supportedModelVersions[${index}]`,
          'Supported Backend model versions must be unique.'
        )
      )
    } else {
      versions.add(version)
    }
  }
  if (!versions.has(BACKEND_APPLICATION_SPEC_V2_VERSION)) {
    diagnostics.push(
      errorV2(
        'backend-provider-v2-model-version-required',
        '$.supportedModelVersions',
        'Backend Provider V2 must support Backend Application model version 2.'
      )
    )
  }
  return [...versions].sort((left, right) => left - right)
}

function parseDescriptorDataV2(value: unknown): BackendProviderDescriptorParseResultV2 {
  const diagnostics: BackendDiagnostic[] = []
  const data = readDescriptorDataV2(value, diagnostics)
  if (!data) {
    return {
      ok: false,
      diagnostics: [
        errorV2(
          'backend-provider-v2-descriptor-object-required',
          '$',
          'Backend Provider V2 descriptor must be a plain object.'
        )
      ]
    }
  }
  const pluginId = safeIdV2(data.pluginId, '$.pluginId', diagnostics)
  const contributionId = safeIdV2(data.contributionId, '$.contributionId', diagnostics)
  const providerId = safeIdV2(data.providerId, '$.providerId', diagnostics)
  const adapterId = safeIdV2(data.adapterId, '$.adapterId', diagnostics)
  const parsedAdapterVersion = adapterVersionV2(data.adapterVersion, diagnostics)
  if (data.contractVersion !== BACKEND_PROVIDER_CONTRACT_VERSION_V2) {
    diagnostics.push(
      errorV2(
        'backend-provider-v2-contract-version-unsupported',
        '$.contractVersion',
        'Backend Provider V2 contract version is not supported.'
      )
    )
  }
  const supportedModelVersions = modelVersionsV2(data.supportedModelVersions, diagnostics)
  const capabilities = uniqueKnownStringsV2(
    data.capabilities,
    '$.capabilities',
    BACKEND_CAPABILITIES_V2,
    diagnostics
  )
  const outputs = uniqueKnownStringsV2(
    data.outputs,
    '$.outputs',
    BACKEND_PROVIDER_OUTPUT_KINDS_V2,
    diagnostics
  )
  if (
    diagnostics.length > 0 ||
    !pluginId ||
    !contributionId ||
    !providerId ||
    !adapterId ||
    !parsedAdapterVersion ||
    !supportedModelVersions ||
    !capabilities ||
    !outputs
  ) {
    return { ok: false, diagnostics: Object.freeze(diagnostics) }
  }
  return {
    ok: true,
    value: Object.freeze({
      pluginId,
      contributionId,
      providerId,
      adapterId,
      adapterVersion: parsedAdapterVersion,
      contractVersion: BACKEND_PROVIDER_CONTRACT_VERSION_V2,
      supportedModelVersions: Object.freeze([...supportedModelVersions]),
      capabilities: Object.freeze([...capabilities]),
      outputs: Object.freeze([...outputs])
    })
  }
}

export function parseBackendProviderDescriptorV2(
  value: unknown
): BackendProviderDescriptorParseResultV2 {
  try {
    return parseDescriptorDataV2(value)
  } catch {
    return {
      ok: false,
      diagnostics: Object.freeze([
        errorV2(
          'backend-provider-v2-descriptor-object-invalid',
          '$',
          'Backend Provider V2 descriptor must be inert plain data.'
        )
      ])
    }
  }
}

export function sameBackendProviderDescriptorV2(
  left: BackendProviderDescriptorV2,
  right: BackendProviderDescriptorV2
): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.contributionId === right.contributionId &&
    left.providerId === right.providerId &&
    left.adapterId === right.adapterId &&
    left.adapterVersion === right.adapterVersion &&
    sameContractVersionV2(left.contractVersion, right.contractVersion) &&
    left.supportedModelVersions.join('\u0000') === right.supportedModelVersions.join('\u0000') &&
    left.capabilities.join('\u0000') === right.capabilities.join('\u0000') &&
    left.outputs.join('\u0000') === right.outputs.join('\u0000')
  )
}

function sameContractVersionV2(left: number, right: number): boolean {
  return left === right
}
