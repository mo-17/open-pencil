import {
  readProviderDescriptorArray,
  readProviderDescriptorStrings,
  sameProviderDescriptorData
} from '#compiler/backend/provider-data'

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
  const entries = readProviderDescriptorArray(value, '$.supportedModelVersions', 2, diagnostics, 2)
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
  const capabilities = readProviderDescriptorStrings(
    data.capabilities,
    '$.capabilities',
    BACKEND_CAPABILITIES_V2,
    diagnostics,
    2
  )
  const outputs = readProviderDescriptorStrings(
    data.outputs,
    '$.outputs',
    BACKEND_PROVIDER_OUTPUT_KINDS_V2,
    diagnostics,
    2
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

export const sameBackendProviderDescriptorV2: (
  left: BackendProviderDescriptorV2,
  right: BackendProviderDescriptorV2
) => boolean = sameProviderDescriptorData
