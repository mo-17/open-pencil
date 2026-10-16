import {
  readProviderDescriptorArray,
  readProviderDescriptorStrings,
  sameProviderDescriptorData
} from '#compiler/backend/provider-data'

import {
  BACKEND_APPLICATION_SPEC_VERSION,
  BACKEND_CAPABILITIES,
  containsBackendSecretLikeMaterial
} from '@open-pencil/lowcode/backend'
import type { BackendDiagnostic } from '@open-pencil/lowcode/backend'

import {
  BACKEND_PROVIDER_CONTRACT_VERSION,
  BACKEND_PROVIDER_OUTPUT_KINDS,
  type BackendProviderDescriptor
} from './contracts'

const DESCRIPTOR_KEYS = Object.freeze([
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

const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

export type BackendProviderDescriptorParseResult =
  | Readonly<{ ok: true; value: BackendProviderDescriptor }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

interface BackendProviderDescriptorData {
  [key: string]: unknown
}

function error(code: string, path: string, message: string): BackendDiagnostic {
  return { code, severity: 'error', path, message }
}

function safeId(
  value: unknown,
  path: string,
  diagnostics: BackendDiagnostic[]
): string | undefined {
  if (
    typeof value !== 'string' ||
    containsBackendSecretLikeMaterial(value) ||
    !SAFE_ID.test(value)
  ) {
    diagnostics.push(
      error(
        'backend-provider-descriptor-id-invalid',
        path,
        'Provider descriptor identifiers must be bounded lowercase identifiers.'
      )
    )
    return undefined
  }
  return value
}

function isDescriptorData(value: unknown): value is BackendProviderDescriptorData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readDescriptorData(
  source: BackendProviderDescriptorData,
  diagnostics: BackendDiagnostic[]
): BackendProviderDescriptorData {
  const descriptors = Object.getOwnPropertyDescriptors(source)
  const data: BackendProviderDescriptorData = Object.create(null)
  for (const key of Reflect.ownKeys(source)) {
    if (
      typeof key !== 'string' ||
      !DESCRIPTOR_KEYS.includes(key as (typeof DESCRIPTOR_KEYS)[number])
    ) {
      diagnostics.push(
        error(
          'backend-provider-descriptor-field-unknown',
          '$',
          'Unknown Backend Provider descriptor fields are not allowed.'
        )
      )
      continue
    }
    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !('value' in descriptor)) {
      diagnostics.push(
        error(
          'backend-provider-descriptor-field-invalid',
          '$',
          'Backend Provider descriptor fields must be enumerable data properties.'
        )
      )
    } else {
      data[key] = descriptor.value
    }
  }
  for (const key of DESCRIPTOR_KEYS) {
    if (!Object.hasOwn(source, key)) {
      diagnostics.push(
        error(
          'backend-provider-descriptor-field-required',
          `$.${key}`,
          'Required Backend Provider descriptor field is missing.'
        )
      )
    }
  }
  return data
}

function adapterVersion(value: unknown, diagnostics: BackendDiagnostic[]): string | undefined {
  if (
    typeof value === 'string' &&
    !containsBackendSecretLikeMaterial(value) &&
    value.length <= 64 &&
    SAFE_VERSION.test(value)
  ) {
    return value
  }
  diagnostics.push(
    error(
      'backend-provider-descriptor-version-invalid',
      '$.adapterVersion',
      'Adapter version must be a bounded semantic version.'
    )
  )
  return undefined
}

function modelVersions(
  value: unknown,
  diagnostics: BackendDiagnostic[]
): readonly number[] | undefined {
  const entries = readProviderDescriptorArray(value, '$.supportedModelVersions', 1, diagnostics, 1)
  if (!entries) return undefined
  const versions = new Set<number>()
  for (let index = 0; index < entries.length; index += 1) {
    const version = entries[index]
    if (version !== BACKEND_APPLICATION_SPEC_VERSION) {
      diagnostics.push(
        error(
          'backend-provider-model-version-unsupported',
          `$.supportedModelVersions[${index}]`,
          'Backend Provider declares an unsupported model version.'
        )
      )
    } else if (versions.has(version)) {
      diagnostics.push(
        error(
          'backend-provider-descriptor-value-duplicate',
          `$.supportedModelVersions[${index}]`,
          'Supported Backend model versions must be unique.'
        )
      )
    } else {
      versions.add(version)
    }
  }
  return [...versions].sort((left, right) => left - right)
}

export function parseBackendProviderDescriptor(
  value: unknown
): BackendProviderDescriptorParseResult {
  const diagnostics: BackendDiagnostic[] = []
  if (!isDescriptorData(value)) {
    return {
      ok: false,
      diagnostics: [
        error(
          'backend-provider-descriptor-object-required',
          '$',
          'Backend Provider descriptor must be a plain object.'
        )
      ]
    }
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    diagnostics.push(
      error(
        'backend-provider-descriptor-object-invalid',
        '$',
        'Backend Provider descriptor must be a plain data object.'
      )
    )
  }
  const data = readDescriptorData(value, diagnostics)

  const pluginId = safeId(data.pluginId, '$.pluginId', diagnostics)
  const contributionId = safeId(data.contributionId, '$.contributionId', diagnostics)
  const providerId = safeId(data.providerId, '$.providerId', diagnostics)
  const adapterId = safeId(data.adapterId, '$.adapterId', diagnostics)
  const parsedAdapterVersion = adapterVersion(data.adapterVersion, diagnostics)
  if (data.contractVersion !== BACKEND_PROVIDER_CONTRACT_VERSION) {
    diagnostics.push(
      error(
        'backend-provider-contract-version-unsupported',
        '$.contractVersion',
        'Backend Provider contract version is not supported.'
      )
    )
  }
  const supportedModelVersions = modelVersions(data.supportedModelVersions, diagnostics)
  const capabilities = readProviderDescriptorStrings(
    data.capabilities,
    '$.capabilities',
    BACKEND_CAPABILITIES,
    diagnostics,
    1
  )
  const outputs = readProviderDescriptorStrings(
    data.outputs,
    '$.outputs',
    BACKEND_PROVIDER_OUTPUT_KINDS,
    diagnostics,
    1
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
    return { ok: false, diagnostics }
  }
  return {
    ok: true,
    value: Object.freeze({
      pluginId,
      contributionId,
      providerId,
      adapterId,
      adapterVersion: parsedAdapterVersion,
      contractVersion: BACKEND_PROVIDER_CONTRACT_VERSION,
      supportedModelVersions: Object.freeze([...supportedModelVersions]),
      capabilities: Object.freeze([...capabilities]),
      outputs: Object.freeze([...outputs])
    })
  }
}

export const sameBackendProviderDescriptor: (
  left: BackendProviderDescriptor,
  right: BackendProviderDescriptor
) => boolean = sameProviderDescriptorData
