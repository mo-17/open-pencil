/* eslint-disable max-lines -- Runtime package parsing, signatures, embedded assets, and WASM safety form one trust boundary. */
import {
  canonicalManifestValue,
  createSignedManifestIntegrity,
  decodeBase64Url,
  encodeBase64Url,
  parseExactManifestRecord,
  parseSha256Base64Url,
  parseSignedManifestIntegrity,
  parseStableSemver,
  validateModuleIdentity,
  verifySignedManifestIntegrity,
  webCryptoBuffer,
  type SignedManifestIntegrity
} from '@open-pencil/scene-graph'

import { parseSortedUniqueStringArray } from './parse-helpers'

export const PLUGIN_RUNTIME_PACKAGE_FORMAT = 'openpencil-plugin-runtime-package' as const
export const PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION = 1 as const
export const PLUGIN_RUNTIME_COMPUTE_ABI = 'openpencil.compute.v1' as const

/**
 * UTF-8 JSON compute ABI. The host allocates both input and the signed maximum output capacity.
 * Runtime package validation parses the WASM type/function/export sections and binds each named
 * ABI export to this exact signature before the package can become executable.
 */
export const PLUGIN_RUNTIME_COMPUTE_ABI_CONTRACT = Object.freeze({
  encoding: 'utf-8-json',
  alloc: 'openpencil_alloc(length:i32)->ptr:i32',
  compute:
    'openpencil_compute(inputPtr:i32,inputLen:i32,outputPtr:i32,outputCapacity:i32)->outputLen:i32',
  dealloc: 'openpencil_dealloc(ptr:i32,length:i32)->void'
} as const)

export const PLUGIN_RUNTIME_PACKAGE_LIMITS = Object.freeze({
  maxJsonBytes: 3 * 1024 * 1024,
  maxAssetBytes: 2 * 1024 * 1024,
  maxCapabilities: 2,
  maxTimeoutMs: 2_000,
  maxInputBytes: 256 * 1024,
  maxOutputBytes: 256 * 1024,
  maxMemoryPages: 256
})

export const PLUGIN_RUNTIME_CAPABILITIES = Object.freeze([
  'document.nodes.read',
  'document.selection.read'
] as const)

export type PluginRuntimeKindV1 = 'wasm' | 'javascript'
export type PluginRuntimeCapabilityV1 = (typeof PLUGIN_RUNTIME_CAPABILITIES)[number]

export interface PluginRuntimeResourceLimitsV1 {
  timeoutMs: number
  maxInputBytes: number
  maxOutputBytes: number
  maxMemoryPages: number
}

export interface PluginRuntimeAssetV1 {
  mediaType: 'application/wasm' | 'text/javascript'
  encoding: 'base64url'
  byteLength: number
  digest: string
  data: string
}

export interface PluginRuntimeDescriptorV1 {
  kind: PluginRuntimeKindV1
  abi: typeof PLUGIN_RUNTIME_COMPUTE_ABI
  capabilities: readonly PluginRuntimeCapabilityV1[]
  limits: PluginRuntimeResourceLimitsV1
  asset: PluginRuntimeAssetV1
}

export interface PluginRuntimePackagePayloadV1 {
  format: typeof PLUGIN_RUNTIME_PACKAGE_FORMAT
  schemaVersion: typeof PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION
  plugin: { id: string; version: string }
  publisher: { id: string; keyId: string }
  declarativeManifestDigest: string
  runtime: PluginRuntimeDescriptorV1
}

export interface SignedPluginRuntimePackageV1 extends PluginRuntimePackagePayloadV1 {
  integrity: SignedManifestIntegrity
}

export type PluginRuntimeExecutionStatus = 'eligible' | 'runtime-unavailable'

export interface WasmComputeRuntimeSafetyReport {
  initialMemoryPages: number
  maximumMemoryPages: number
  exports: readonly string[]
}

export interface VerifiedPluginRuntimePackage {
  runtimePackage: SignedPluginRuntimePackageV1
  verifiedDigest: string
  verifiedKeyId: string
  executionStatus: PluginRuntimeExecutionStatus
  executionReason: string | null
  wasmSafety: WasmComputeRuntimeSafetyReport | null
}

export interface PluginRuntimePackageVerificationOptions {
  expectedPluginId?: string
  expectedPluginVersion?: string
  expectedPublisherId?: string
  expectedKeyId?: string
  expectedDeclarativeManifestDigest?: string
  expectedDigest?: string
  expectedCanonicalByteLength?: number
}

const PAYLOAD_KEYS = new Set([
  'format',
  'schemaVersion',
  'plugin',
  'publisher',
  'declarativeManifestDigest',
  'runtime'
])
const PACKAGE_KEYS = new Set([...PAYLOAD_KEYS, 'integrity'])
const PLUGIN_KEYS = new Set(['id', 'version'])
const PUBLISHER_KEYS = new Set(['id', 'keyId'])
const RUNTIME_KEYS = new Set(['kind', 'abi', 'capabilities', 'limits', 'asset'])
const LIMIT_KEYS = new Set(['timeoutMs', 'maxInputBytes', 'maxOutputBytes', 'maxMemoryPages'])
const ASSET_KEYS = new Set(['mediaType', 'encoding', 'byteLength', 'digest', 'data'])
const CAPABILITIES = new Set<string>(PLUGIN_RUNTIME_CAPABILITIES)
const REQUIRED_WASM_EXPORTS: ReadonlyMap<string, string> = new Map([
  ['memory', 'memory'],
  ['openpencil_alloc', 'function'],
  ['openpencil_dealloc', 'function'],
  ['openpencil_compute', 'function']
] as const)
const WASM_I32 = 0x7f
const WASM_FUNCTION_TYPE = 0x60
const WASM_FUNCTION_EXPORT_KIND = 0
const SUPPORTED_WASM_VALUE_TYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f])
const REQUIRED_WASM_FUNCTION_SIGNATURES = new Map([
  ['openpencil_alloc', { parameters: [WASM_I32], results: [WASM_I32], display: '(i32)->i32' }],
  [
    'openpencil_dealloc',
    { parameters: [WASM_I32, WASM_I32], results: [], display: '(i32,i32)->void' }
  ],
  [
    'openpencil_compute',
    {
      parameters: [WASM_I32, WASM_I32, WASM_I32, WASM_I32],
      results: [WASM_I32],
      display: '(i32,i32,i32,i32)->i32'
    }
  ]
] as const)
const WASM_MAGIC_AND_VERSION = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
const VERIFIED_RUNTIME_ASSETS = new WeakMap<object, Uint8Array>()

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function boundedPositiveInteger(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${path} must be a positive integer no greater than ${maximum}`)
  }
  return value as number
}

function runtimeKind(value: unknown, path: string): PluginRuntimeKindV1 {
  if (value !== 'wasm' && value !== 'javascript') {
    throw new TypeError(`${path} must be wasm or javascript`)
  }
  return value
}

function capabilities(value: unknown, path: string): readonly PluginRuntimeCapabilityV1[] {
  return parseSortedUniqueStringArray(value, path, {
    maximumEntries: PLUGIN_RUNTIME_PACKAGE_LIMITS.maxCapabilities,
    duplicateLabel: 'capabilities',
    parseEntry: (entry, entryPath) => {
      if (typeof entry !== 'string' || !CAPABILITIES.has(entry)) {
        throw new TypeError(`${entryPath} is not a supported runtime capability`)
      }
      return entry as PluginRuntimeCapabilityV1
    }
  })
}

function resourceLimits(value: unknown, path: string): PluginRuntimeResourceLimitsV1 {
  const source = parseExactManifestRecord(value, path, LIMIT_KEYS, LIMIT_KEYS)
  return Object.freeze({
    timeoutMs: boundedPositiveInteger(
      source.timeoutMs,
      `${path}.timeoutMs`,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxTimeoutMs
    ),
    maxInputBytes: boundedPositiveInteger(
      source.maxInputBytes,
      `${path}.maxInputBytes`,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxInputBytes
    ),
    maxOutputBytes: boundedPositiveInteger(
      source.maxOutputBytes,
      `${path}.maxOutputBytes`,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxOutputBytes
    ),
    maxMemoryPages: boundedPositiveInteger(
      source.maxMemoryPages,
      `${path}.maxMemoryPages`,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxMemoryPages
    )
  })
}

function decodedAssetData(value: unknown, path: string): { data: string; bytes: Uint8Array } {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil((PLUGIN_RUNTIME_PACKAGE_LIMITS.maxAssetBytes * 4) / 3)
  ) {
    throw new TypeError(`${path} must contain bounded non-empty base64url data`)
  }
  let bytes: Uint8Array
  try {
    bytes = decodeBase64Url(value)
  } catch (cause) {
    throw new TypeError(`${path} must contain canonical base64url data`, { cause })
  }
  if (bytes.byteLength === 0 || bytes.byteLength > PLUGIN_RUNTIME_PACKAGE_LIMITS.maxAssetBytes) {
    throw new TypeError(`${path} exceeds the runtime asset byte limit`)
  }
  return { data: value, bytes }
}

function runtimeAsset(
  value: unknown,
  path: string,
  kind: PluginRuntimeKindV1
): PluginRuntimeAssetV1 {
  const source = parseExactManifestRecord(value, path, ASSET_KEYS, ASSET_KEYS)
  const expectedMediaType = kind === 'wasm' ? 'application/wasm' : 'text/javascript'
  if (source.mediaType !== expectedMediaType) {
    throw new TypeError(`${path}.mediaType must be ${expectedMediaType} for ${kind}`)
  }
  if (source.encoding !== 'base64url') {
    throw new TypeError(`${path}.encoding must be base64url`)
  }
  const decoded = decodedAssetData(source.data, `${path}.data`)
  const byteLength = boundedPositiveInteger(
    source.byteLength,
    `${path}.byteLength`,
    PLUGIN_RUNTIME_PACKAGE_LIMITS.maxAssetBytes
  )
  if (byteLength !== decoded.bytes.byteLength) {
    throw new TypeError(`${path}.byteLength does not match the embedded asset`)
  }
  if (kind === 'javascript') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(decoded.bytes)
    } catch (cause) {
      throw new TypeError(`${path}.data must contain valid UTF-8 JavaScript`, { cause })
    }
  }
  return Object.freeze({
    mediaType: expectedMediaType,
    encoding: 'base64url',
    byteLength,
    digest: parseSha256Base64Url(source.digest, `${path}.digest`),
    data: decoded.data
  })
}

function runtimeDescriptor(value: unknown, path: string): PluginRuntimeDescriptorV1 {
  const source = parseExactManifestRecord(value, path, RUNTIME_KEYS, RUNTIME_KEYS)
  const kind = runtimeKind(source.kind, `${path}.kind`)
  if (source.abi !== PLUGIN_RUNTIME_COMPUTE_ABI) {
    throw new TypeError(`${path}.abi is not supported`)
  }
  return Object.freeze({
    kind,
    abi: PLUGIN_RUNTIME_COMPUTE_ABI,
    capabilities: capabilities(source.capabilities, `${path}.capabilities`),
    limits: resourceLimits(source.limits, `${path}.limits`),
    asset: runtimeAsset(source.asset, `${path}.asset`, kind)
  })
}

function assertPackageSize(value: unknown): void {
  const byteLength = new TextEncoder().encode(
    JSON.stringify(canonicalManifestValue(value))
  ).byteLength
  if (byteLength > PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `runtimePackage may not exceed ${PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes} bytes`
    )
  }
}

export function parsePluginRuntimePackagePayload(value: unknown): PluginRuntimePackagePayloadV1 {
  const source = parseExactManifestRecord(value, 'runtimePackage', PAYLOAD_KEYS, PAYLOAD_KEYS)
  if (source.format !== PLUGIN_RUNTIME_PACKAGE_FORMAT) {
    throw new TypeError('runtimePackage.format is not supported')
  }
  if (source.schemaVersion !== PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION) {
    throw new TypeError('runtimePackage.schemaVersion is not supported')
  }
  const pluginSource = parseExactManifestRecord(
    source.plugin,
    'runtimePackage.plugin',
    PLUGIN_KEYS,
    PLUGIN_KEYS
  )
  const publisherSource = parseExactManifestRecord(
    source.publisher,
    'runtimePackage.publisher',
    PUBLISHER_KEYS,
    PUBLISHER_KEYS
  )
  const payload = Object.freeze({
    format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
    plugin: Object.freeze({
      id: identity(pluginSource.id, 'runtimePackage.plugin.id'),
      version: parseStableSemver(pluginSource.version, 'runtimePackage.plugin.version')
    }),
    publisher: Object.freeze({
      id: identity(publisherSource.id, 'runtimePackage.publisher.id'),
      keyId: identity(publisherSource.keyId, 'runtimePackage.publisher.keyId')
    }),
    declarativeManifestDigest: parseSha256Base64Url(
      source.declarativeManifestDigest,
      'runtimePackage.declarativeManifestDigest'
    ),
    runtime: runtimeDescriptor(source.runtime, 'runtimePackage.runtime')
  })
  assertPackageSize(payload)
  return payload
}

export function parsePluginRuntimePackage(value: unknown): SignedPluginRuntimePackageV1 {
  const source = parseExactManifestRecord(value, 'runtimePackage', PACKAGE_KEYS, PACKAGE_KEYS)
  const payloadSource = { ...source }
  Reflect.deleteProperty(payloadSource, 'integrity')
  const payload = parsePluginRuntimePackagePayload(payloadSource)
  const runtimePackage = Object.freeze({
    ...payload,
    integrity: parseSignedManifestIntegrity(
      source.integrity,
      'runtimePackage.integrity',
      payload.publisher.keyId
    )
  })
  assertPackageSize(runtimePackage)
  return runtimePackage
}

export function parsePluginRuntimePackageJson(source: string): SignedPluginRuntimePackageV1 {
  if (
    typeof source !== 'string' ||
    new TextEncoder().encode(source).byteLength > PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Runtime package JSON must be bounded text')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('Runtime package must contain valid JSON')
  }
  return parsePluginRuntimePackage(value)
}

export function parsePluginRuntimePackageBytes(source: Uint8Array): SignedPluginRuntimePackageV1 {
  if (source.byteLength > PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes) {
    throw new TypeError('Runtime package exceeds the JSON byte limit')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source)
  } catch {
    throw new TypeError('Runtime package must contain valid UTF-8')
  }
  return parsePluginRuntimePackageJson(text)
}

export function serializePluginRuntimePackage(value: unknown): string {
  return `${JSON.stringify(canonicalManifestValue(parsePluginRuntimePackage(value)), null, 2)}\n`
}

export function pluginRuntimePackageCanonicalByteLength(value: unknown): number {
  return new TextEncoder().encode(
    JSON.stringify(canonicalManifestValue(parsePluginRuntimePackage(value)))
  ).byteLength
}

async function digestAsset(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', webCryptoBuffer(bytes))
  return encodeBase64Url(new Uint8Array(digest))
}

export async function createPluginRuntimeAsset(
  kind: PluginRuntimeKindV1,
  bytes: Uint8Array
): Promise<PluginRuntimeAssetV1> {
  const parsedKind = runtimeKind(kind, 'Runtime asset kind')
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Runtime asset must be a Uint8Array')
  if (bytes.byteLength === 0 || bytes.byteLength > PLUGIN_RUNTIME_PACKAGE_LIMITS.maxAssetBytes) {
    throw new TypeError('Runtime asset must be non-empty and bounded')
  }
  const copy = new Uint8Array(bytes)
  return Object.freeze({
    mediaType: parsedKind === 'wasm' ? 'application/wasm' : 'text/javascript',
    encoding: 'base64url',
    byteLength: copy.byteLength,
    digest: await digestAsset(copy),
    data: encodeBase64Url(copy)
  })
}

function readVarUint32(
  bytes: Uint8Array,
  offset: number,
  end: number,
  label: string
): readonly [number, number] {
  let value = 0
  for (let index = 0; index < 5; index++) {
    if (offset >= end) throw new TypeError(`${label} contains a truncated unsigned LEB128 value`)
    const byte = bytes[offset++]
    if (index === 4 && (byte & 0xf0) !== 0) {
      throw new TypeError(`${label} contains an overflowing unsigned LEB128 value`)
    }
    value += (byte & 0x7f) * 2 ** (index * 7)
    if ((byte & 0x80) === 0) return [value, offset]
  }
  throw new TypeError(`${label} contains an invalid unsigned LEB128 value`)
}

interface WasmEnvelopeInspection {
  initialMemoryPages: number
  maximumMemoryPages: number
  functionTypes: readonly WasmFunctionType[]
  functionTypeIndexes: readonly number[]
  exports: readonly WasmExportDescriptor[]
}

interface WasmFunctionType {
  parameters: readonly number[]
  results: readonly number[]
}

interface WasmExportDescriptor {
  name: string
  kind: number
  index: number
}

type WasmMemoryEnvelope = Pick<WasmEnvelopeInspection, 'initialMemoryPages' | 'maximumMemoryPages'>

function readByte(bytes: Uint8Array, offset: number, end: number, label: string): number {
  if (offset >= end) throw new TypeError(`${label} is truncated`)
  return bytes[offset]
}

function readWasmValueTypes(
  bytes: Uint8Array,
  offset: number,
  end: number,
  label: string
): readonly [readonly number[], number] {
  const [count, valuesOffset] = readVarUint32(bytes, offset, end, label)
  const valuesEnd = valuesOffset + count
  if (!Number.isSafeInteger(valuesEnd) || valuesEnd > end) {
    throw new TypeError(`${label} exceeds its section bounds`)
  }
  const values = [...bytes.subarray(valuesOffset, valuesEnd)]
  if (values.some((value) => !SUPPORTED_WASM_VALUE_TYPES.has(value))) {
    throw new TypeError(`${label} contains an unsupported value type`)
  }
  return [Object.freeze(values), valuesEnd]
}

function inspectWasmTypeSection(
  bytes: Uint8Array,
  offset: number,
  end: number
): readonly WasmFunctionType[] {
  let cursor: number
  let count: number
  ;[count, cursor] = readVarUint32(bytes, offset, end, 'WASM type section')
  const types: WasmFunctionType[] = []
  for (let index = 0; index < count; index++) {
    if (readByte(bytes, cursor, end, `WASM type ${index}`) !== WASM_FUNCTION_TYPE) {
      throw new TypeError('WASM runtime may contain only function type definitions')
    }
    cursor++
    let parameters: readonly number[]
    ;[parameters, cursor] = readWasmValueTypes(bytes, cursor, end, `WASM type ${index} parameters`)
    let results: readonly number[]
    ;[results, cursor] = readWasmValueTypes(bytes, cursor, end, `WASM type ${index} results`)
    types.push(Object.freeze({ parameters, results }))
  }
  if (cursor !== end) throw new TypeError('WASM type section contains trailing data')
  return Object.freeze(types)
}

function inspectWasmFunctionSection(
  bytes: Uint8Array,
  offset: number,
  end: number
): readonly number[] {
  let cursor: number
  let count: number
  ;[count, cursor] = readVarUint32(bytes, offset, end, 'WASM function section')
  const typeIndexes: number[] = []
  for (let index = 0; index < count; index++) {
    let typeIndex: number
    ;[typeIndex, cursor] = readVarUint32(bytes, cursor, end, `WASM function ${index} type index`)
    typeIndexes.push(typeIndex)
  }
  if (cursor !== end) throw new TypeError('WASM function section contains trailing data')
  return Object.freeze(typeIndexes)
}

function readWasmName(
  bytes: Uint8Array,
  offset: number,
  end: number,
  label: string
): readonly [string, number] {
  const [length, dataOffset] = readVarUint32(bytes, offset, end, label)
  const dataEnd = dataOffset + length
  if (!Number.isSafeInteger(dataEnd) || dataEnd > end) {
    throw new TypeError(`${label} exceeds its section bounds`)
  }
  try {
    return [
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(dataOffset, dataEnd)),
      dataEnd
    ]
  } catch (cause) {
    throw new TypeError(`${label} must contain valid UTF-8`, { cause })
  }
}

function inspectWasmExportSection(
  bytes: Uint8Array,
  offset: number,
  end: number
): readonly WasmExportDescriptor[] {
  let cursor: number
  let count: number
  ;[count, cursor] = readVarUint32(bytes, offset, end, 'WASM export section')
  const exports: WasmExportDescriptor[] = []
  for (let index = 0; index < count; index++) {
    let name: string
    ;[name, cursor] = readWasmName(bytes, cursor, end, `WASM export ${index} name`)
    const kind = readByte(bytes, cursor, end, `WASM export ${name} kind`)
    cursor++
    let exportIndex: number
    ;[exportIndex, cursor] = readVarUint32(bytes, cursor, end, `WASM export ${name} index`)
    exports.push(Object.freeze({ name, kind, index: exportIndex }))
  }
  if (cursor !== end) throw new TypeError('WASM export section contains trailing data')
  return Object.freeze(exports)
}

function inspectWasmMemorySection(
  bytes: Uint8Array,
  offset: number,
  end: number
): WasmMemoryEnvelope {
  const [count, limitsOffset] = readVarUint32(bytes, offset, end, 'WASM memory section')
  if (count !== 1) throw new TypeError('WASM runtime must define exactly one memory')
  const [flags, initialOffset] = readVarUint32(bytes, limitsOffset, end, 'WASM memory limits')
  if (flags !== 1) {
    throw new TypeError(
      'WASM runtime memory must declare a maximum and must not be shared or memory64'
    )
  }
  const [initialMemoryPages, maximumOffset] = readVarUint32(
    bytes,
    initialOffset,
    end,
    'WASM initial memory'
  )
  const [maximumMemoryPages, sectionEnd] = readVarUint32(
    bytes,
    maximumOffset,
    end,
    'WASM maximum memory'
  )
  if (sectionEnd !== end) throw new TypeError('WASM memory section contains trailing data')
  return { initialMemoryPages, maximumMemoryPages }
}

function assertWasmHeader(bytes: Uint8Array): void {
  if (
    bytes.byteLength < WASM_MAGIC_AND_VERSION.byteLength ||
    WASM_MAGIC_AND_VERSION.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new TypeError('WASM runtime asset has an invalid magic number or version')
  }
}

function inspectWasmEnvelope(bytes: Uint8Array): WasmEnvelopeInspection {
  assertWasmHeader(bytes)
  let offset = WASM_MAGIC_AND_VERSION.byteLength
  let memory: WasmMemoryEnvelope | null = null
  let functionTypes: readonly WasmFunctionType[] | null = null
  let functionTypeIndexes: readonly number[] | null = null
  let exports: readonly WasmExportDescriptor[] | null = null
  while (offset < bytes.byteLength) {
    const sectionId = bytes[offset++]
    const [sectionSize, payloadOffset] = readVarUint32(
      bytes,
      offset,
      bytes.byteLength,
      'WASM section'
    )
    const sectionEnd = payloadOffset + sectionSize
    if (!Number.isSafeInteger(sectionEnd) || sectionEnd > bytes.byteLength) {
      throw new TypeError('WASM section exceeds the asset bounds')
    }
    offset = payloadOffset
    if (sectionId === 1) {
      if (functionTypes)
        throw new TypeError('WASM runtime must not contain duplicate type sections')
      functionTypes = inspectWasmTypeSection(bytes, offset, sectionEnd)
    }
    if (sectionId === 3) {
      if (functionTypeIndexes) {
        throw new TypeError('WASM runtime must not contain duplicate function sections')
      }
      functionTypeIndexes = inspectWasmFunctionSection(bytes, offset, sectionEnd)
    }
    if (sectionId === 4) {
      const [count] = readVarUint32(bytes, offset, sectionEnd, 'WASM table section')
      if (count !== 0) throw new TypeError('WASM runtime must not define tables')
    }
    if (sectionId === 5) {
      if (memory) throw new TypeError('WASM runtime must contain exactly one memory section')
      memory = inspectWasmMemorySection(bytes, offset, sectionEnd)
    }
    if (sectionId === 7) {
      if (exports) throw new TypeError('WASM runtime must not contain duplicate export sections')
      exports = inspectWasmExportSection(bytes, offset, sectionEnd)
    }
    if (sectionId === 8) throw new TypeError('WASM runtime must not define a start function')
    offset = sectionEnd
  }
  if (!memory) throw new TypeError('WASM runtime must define exactly one bounded memory')
  if (!functionTypes || !functionTypeIndexes || !exports) {
    throw new TypeError('WASM runtime must define type, function, and export sections')
  }
  return { ...memory, functionTypes, functionTypeIndexes, exports }
}

function sameWasmValueTypes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertWasmAbiFunctionSignatures(inspection: WasmEnvelopeInspection): void {
  const functionExports = new Map(
    inspection.exports
      .filter(({ kind }) => kind === WASM_FUNCTION_EXPORT_KIND)
      .map((entry) => [entry.name, entry] as const)
  )
  for (const [name, expected] of REQUIRED_WASM_FUNCTION_SIGNATURES) {
    const exported = functionExports.get(name)
    const typeIndex =
      exported === undefined ? undefined : inspection.functionTypeIndexes[exported.index]
    const type = typeIndex === undefined ? undefined : inspection.functionTypes[typeIndex]
    if (
      !type ||
      !sameWasmValueTypes(type.parameters, expected.parameters) ||
      !sameWasmValueTypes(type.results, expected.results)
    ) {
      throw new TypeError(`WASM ABI export ${name} must have signature ${expected.display}`)
    }
  }
}

export async function validateWasmComputeRuntimeAsset(
  bytes: Uint8Array,
  limits: PluginRuntimeResourceLimitsV1
): Promise<WasmComputeRuntimeSafetyReport> {
  const memory = inspectWasmEnvelope(bytes)
  if (
    memory.initialMemoryPages > memory.maximumMemoryPages ||
    memory.maximumMemoryPages > limits.maxMemoryPages ||
    memory.maximumMemoryPages > PLUGIN_RUNTIME_PACKAGE_LIMITS.maxMemoryPages
  ) {
    throw new TypeError('WASM runtime memory exceeds its signed maximum page limit')
  }
  let module: WebAssembly.Module
  try {
    module = await WebAssembly.compile(webCryptoBuffer(bytes))
  } catch (cause) {
    throw new TypeError('WASM runtime asset is not a valid WebAssembly module', { cause })
  }
  if (WebAssembly.Module.imports(module).length !== 0) {
    throw new TypeError('WASM compute runtime must not import host functions or resources')
  }
  const moduleExports = WebAssembly.Module.exports(module)
  if (
    moduleExports.length !== REQUIRED_WASM_EXPORTS.size ||
    moduleExports.some(({ name, kind }) => REQUIRED_WASM_EXPORTS.get(name) !== kind)
  ) {
    throw new TypeError(
      'WASM compute runtime exports must be exactly memory, openpencil_alloc, openpencil_dealloc, and openpencil_compute'
    )
  }
  assertWasmAbiFunctionSignatures(memory)
  return Object.freeze({
    ...memory,
    exports: Object.freeze(moduleExports.map(({ name }) => name).sort())
  })
}

async function validateEmbeddedAsset(
  payload: PluginRuntimePackagePayloadV1
): Promise<Readonly<{ bytes: Uint8Array; wasmSafety: WasmComputeRuntimeSafetyReport | null }>> {
  const bytes = decodeBase64Url(payload.runtime.asset.data)
  if ((await digestAsset(bytes)) !== payload.runtime.asset.digest) {
    throw new Error('Runtime asset digest mismatch')
  }
  const wasmSafety =
    payload.runtime.kind === 'wasm'
      ? await validateWasmComputeRuntimeAsset(bytes, payload.runtime.limits)
      : null
  return { bytes, wasmSafety }
}

/** Fully validates the digest and executable envelope embedded in an unsigned runtime payload. */
export async function validatePluginRuntimeEmbeddedAsset(
  value: unknown
): Promise<WasmComputeRuntimeSafetyReport | null> {
  const payload = parsePluginRuntimePackagePayload(value)
  return (await validateEmbeddedAsset(payload)).wasmSafety
}

export async function signPluginRuntimePackage(
  value: unknown,
  privateKey: CryptoKey
): Promise<SignedPluginRuntimePackageV1> {
  const payload = parsePluginRuntimePackagePayload(value)
  await validateEmbeddedAsset(payload)
  return parsePluginRuntimePackage({
    ...payload,
    integrity: await createSignedManifestIntegrity(payload, payload.publisher.keyId, privateKey)
  })
}

function assertExpectedCoordinates(
  runtimePackage: SignedPluginRuntimePackageV1,
  options: PluginRuntimePackageVerificationOptions
): void {
  const expectedDigest =
    options.expectedDigest === undefined
      ? undefined
      : parseSha256Base64Url(options.expectedDigest, 'expected runtime package digest')
  const expectedCanonicalByteLength = options.expectedCanonicalByteLength
  if (
    expectedCanonicalByteLength !== undefined &&
    (!Number.isSafeInteger(expectedCanonicalByteLength) || expectedCanonicalByteLength <= 0)
  ) {
    throw new TypeError('Expected runtime package byte length must be a positive safe integer')
  }
  const mismatched =
    (options.expectedPluginId !== undefined &&
      options.expectedPluginId !== runtimePackage.plugin.id) ||
    (options.expectedPluginVersion !== undefined &&
      options.expectedPluginVersion !== runtimePackage.plugin.version) ||
    (options.expectedPublisherId !== undefined &&
      options.expectedPublisherId !== runtimePackage.publisher.id) ||
    (options.expectedKeyId !== undefined &&
      options.expectedKeyId !== runtimePackage.publisher.keyId) ||
    (options.expectedDeclarativeManifestDigest !== undefined &&
      options.expectedDeclarativeManifestDigest !== runtimePackage.declarativeManifestDigest) ||
    (expectedDigest !== undefined && expectedDigest !== runtimePackage.integrity.digest) ||
    (expectedCanonicalByteLength !== undefined &&
      expectedCanonicalByteLength !== pluginRuntimePackageCanonicalByteLength(runtimePackage))
  if (mismatched) throw new Error('Runtime package coordinates do not match the trusted release')
}

export async function verifyPluginRuntimePackage(
  value: unknown,
  publicKey: CryptoKey,
  options: PluginRuntimePackageVerificationOptions = {}
): Promise<VerifiedPluginRuntimePackage> {
  const runtimePackage = parsePluginRuntimePackage(value)
  assertExpectedCoordinates(runtimePackage, options)
  if (options.expectedKeyId && runtimePackage.integrity.signature.keyId !== options.expectedKeyId) {
    throw new Error('Runtime package signature key id is not trusted')
  }
  const { integrity, ...payload } = runtimePackage
  const verifiedDigest = await verifySignedManifestIntegrity(
    payload,
    integrity,
    publicKey,
    'Plugin runtime package'
  )
  const validatedAsset = await validateEmbeddedAsset(payload)
  const executable = runtimePackage.runtime.kind === 'wasm'
  const verified = Object.freeze({
    runtimePackage,
    verifiedDigest,
    verifiedKeyId: integrity.signature.keyId,
    executionStatus: executable ? 'eligible' : 'runtime-unavailable',
    executionReason: executable
      ? null
      : 'JavaScript runtime packages are verified but not executable in production',
    wasmSafety: validatedAsset.wasmSafety
  })
  VERIFIED_RUNTIME_ASSETS.set(verified, new Uint8Array(validatedAsset.bytes))
  return verified
}

/** Returns a defensive copy only for a package verified in this JavaScript realm. */
export function verifiedPluginRuntimeAssetBytes(
  verified: VerifiedPluginRuntimePackage
): Uint8Array {
  const bytes = VERIFIED_RUNTIME_ASSETS.get(verified)
  if (!bytes) throw new TypeError('Runtime package must be verified in this process')
  return new Uint8Array(bytes)
}
