import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_COMPUTE_ABI_CONTRACT,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  parsePluginRuntimePackageBytes,
  parsePluginRuntimePackageJSON,
  parsePluginRuntimePackagePayload,
  pluginRuntimePackageCanonicalByteLength,
  serializePluginRuntimePackage,
  signPluginRuntimePackage,
  validatePluginRuntimeEmbeddedAsset,
  validateWasmComputeRuntimeAsset,
  verifiedPluginRuntimeAssetBytes,
  verifyPluginRuntimePackage,
  type PluginRuntimeAssetV1,
  type PluginRuntimeKindV1,
  type PluginRuntimePackagePayloadV1
} from '@open-pencil/core/plugins'

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

function unsignedLeb(value: number): number[] {
  const encoded: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) byte |= 0x80
    encoded.push(byte)
  } while (value !== 0)
  return encoded
}

function text(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)]
  return [...unsignedLeb(bytes.length), ...bytes]
}

function section(id: number, payload: number[]): number[] {
  return [id, ...unsignedLeb(payload.length), ...payload]
}

interface WasmFixtureOptions {
  importFunction?: boolean
  memoryMaximum?: number | null
  sharedMemory?: boolean
  table?: boolean
  start?: boolean
  invalidAbiSignature?: 'openpencil_alloc' | 'openpencil_dealloc' | 'openpencil_compute'
}

function functionType(parameters: number, results: number): number[] {
  return [
    0x60,
    parameters,
    ...Array.from({ length: parameters }, () => 0x7f),
    results,
    ...Array.from({ length: results }, () => 0x7f)
  ]
}

function wasmFixture(options: WasmFixtureOptions = {}): Uint8Array {
  const importedFunctions = options.importFunction ? 1 : 0
  const typeSection = section(1, [
    3,
    ...functionType(options.invalidAbiSignature === 'openpencil_alloc' ? 2 : 1, 1),
    ...functionType(options.invalidAbiSignature === 'openpencil_dealloc' ? 1 : 2, 0),
    ...functionType(options.invalidAbiSignature === 'openpencil_compute' ? 3 : 4, 1)
  ])
  const importSection = options.importFunction
    ? section(2, [1, ...text('env'), ...text('hook'), 0, 0])
    : []
  const functionSection = section(3, [3, 0, 1, 2])
  const tableSection = options.table ? section(4, [1, 0x70, 1, 0, 1]) : []
  const memoryMaximum = options.memoryMaximum === undefined ? 4 : options.memoryMaximum
  const memoryLimits =
    memoryMaximum === null
      ? [0, 1]
      : [options.sharedMemory ? 3 : 1, 1, ...unsignedLeb(memoryMaximum)]
  const memorySection = section(5, [1, ...memoryLimits])
  const exports = [
    [...text('memory'), 2, 0],
    [...text('openpencil_alloc'), 0, importedFunctions],
    [...text('openpencil_dealloc'), 0, importedFunctions + 1],
    [...text('openpencil_compute'), 0, importedFunctions + 2]
  ]
  const exportSection = section(7, [exports.length, ...exports.flat()])
  const startSection = options.start ? section(8, [0]) : []
  const bodies = [
    [0, 0x20, 0, 0x0b],
    [0, 0x0b],
    [0, 0x41, 0, 0x0b]
  ]
  const codeSection = section(10, [
    bodies.length,
    ...bodies.flatMap((body) => [body.length, ...body])
  ])
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...typeSection,
    ...importSection,
    ...functionSection,
    ...tableSection,
    ...memorySection,
    ...exportSection,
    ...startSection,
    ...codeSection
  ])
}

function runtimePayload(
  asset: PluginRuntimeAssetV1,
  kind: PluginRuntimeKindV1 = 'wasm'
): PluginRuntimePackagePayloadV1 {
  return {
    format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
    plugin: { id: 'acme.analytics', version: '1.0.0' },
    publisher: { id: 'acme', keyId: 'acme.release' },
    declarativeManifestDigest: 'A'.repeat(43),
    runtime: {
      kind,
      abi: PLUGIN_RUNTIME_COMPUTE_ABI,
      capabilities: [],
      limits: {
        timeoutMs: 2_000,
        maxInputBytes: 256 * 1024,
        maxOutputBytes: 256 * 1024,
        maxMemoryPages: 4
      },
      asset
    }
  }
}

describe('publisher-signed plugin runtime packages', () => {
  test('signs, parses, and verifies a bounded import-free WASM compute package', async () => {
    const publisher = await keys()
    const payload = runtimePayload(await createPluginRuntimeAsset('wasm', wasmFixture()))
    const runtimePackage = await signPluginRuntimePackage(payload, publisher.privateKey)
    const serialized = serializePluginRuntimePackage(runtimePackage)

    expect(parsePluginRuntimePackageJSON(serialized)).toEqual(runtimePackage)
    expect(parsePluginRuntimePackageBytes(new TextEncoder().encode(serialized))).toEqual(
      runtimePackage
    )
    const verified = await verifyPluginRuntimePackage(runtimePackage, publisher.publicKey, {
      expectedPluginId: 'acme.analytics',
      expectedPluginVersion: '1.0.0',
      expectedPublisherId: 'acme',
      expectedKeyId: 'acme.release',
      expectedDeclarativeManifestDigest: 'A'.repeat(43),
      expectedDigest: runtimePackage.integrity.digest,
      expectedCanonicalByteLength: pluginRuntimePackageCanonicalByteLength(runtimePackage)
    })
    expect(verified.verifiedDigest).toBe(runtimePackage.integrity.digest)
    expect(verified.executionStatus).toBe('eligible')
    expect(verified.executionReason).toBeNull()
    expect(verified.wasmSafety).toMatchObject({
      initialMemoryPages: 1,
      maximumMemoryPages: 4
    })
    await expect(validatePluginRuntimeEmbeddedAsset(payload)).resolves.toMatchObject({
      initialMemoryPages: 1,
      maximumMemoryPages: 4
    })
    const firstAssetCopy = verifiedPluginRuntimeAssetBytes(verified)
    firstAssetCopy[0] = 0xff
    expect(verifiedPluginRuntimeAssetBytes(verified)[0]).toBe(0)
    expect(() => verifiedPluginRuntimeAssetBytes(structuredClone(verified))).toThrow(
      'verified in this process'
    )
    expect(PLUGIN_RUNTIME_COMPUTE_ABI_CONTRACT.compute).toContain('outputCapacity:i32')
  })

  test('verifies JavaScript provenance while keeping production execution fail-closed', async () => {
    const publisher = await keys()
    const asset = await createPluginRuntimeAsset(
      'javascript',
      new TextEncoder().encode('export function compute(input) { return input }\n')
    )
    const payload = runtimePayload(asset, 'javascript')
    payload.runtime.capabilities = ['document.nodes.read', 'document.selection.read']
    const runtimePackage = await signPluginRuntimePackage(payload, publisher.privateKey)
    const verified = await verifyPluginRuntimePackage(runtimePackage, publisher.publicKey)

    expect(verified.executionStatus).toBe('runtime-unavailable')
    expect(verified.executionReason).toContain('not executable in production')
    expect(verified.wasmSafety).toBeNull()
  })

  test('rejects tampering, coordinate substitution, unknown capabilities, and unsafe limits', async () => {
    const publisher = await keys()
    const runtimePackage = await signPluginRuntimePackage(
      runtimePayload(await createPluginRuntimeAsset('wasm', wasmFixture())),
      publisher.privateKey
    )
    const tampered = structuredClone(runtimePackage)
    tampered.runtime.asset.digest = 'B'.repeat(43)
    await expect(verifyPluginRuntimePackage(tampered, publisher.publicKey)).rejects.toThrow()
    await expect(
      verifyPluginRuntimePackage(runtimePackage, publisher.publicKey, {
        expectedPluginId: 'hostile.analytics'
      })
    ).rejects.toThrow('coordinates')
    await expect(
      verifyPluginRuntimePackage(runtimePackage, publisher.publicKey, {
        expectedDigest: 'Q'.repeat(43)
      })
    ).rejects.toThrow('coordinates')
    await expect(
      verifyPluginRuntimePackage(runtimePackage, publisher.publicKey, {
        expectedCanonicalByteLength: pluginRuntimePackageCanonicalByteLength(runtimePackage) + 1
      })
    ).rejects.toThrow('coordinates')

    const { integrity: _integrity, ...signedPayload } = runtimePackage
    const unsupportedCapability = structuredClone(signedPayload)
    unsupportedCapability.runtime.capabilities = ['network.fetch'] as never
    expect(() => parsePluginRuntimePackagePayload(unsupportedCapability)).toThrow(
      'runtime capability'
    )
    const duplicateCapabilities = structuredClone(signedPayload)
    duplicateCapabilities.runtime.capabilities = ['document.nodes.read', 'document.nodes.read']
    expect(() => parsePluginRuntimePackagePayload(duplicateCapabilities)).toThrow(
      'must not contain duplicate capabilities'
    )
    const unsortedCapabilities = structuredClone(signedPayload)
    unsortedCapabilities.runtime.capabilities = ['document.selection.read', 'document.nodes.read']
    expect(() => parsePluginRuntimePackagePayload(unsortedCapabilities)).toThrow(
      'must be sorted in ascending order'
    )
    const unsafeLimits = structuredClone(signedPayload)
    unsafeLimits.runtime.limits.maxOutputBytes = 256 * 1024 + 1
    expect(() => parsePluginRuntimePackagePayload(unsafeLimits)).toThrow('maxOutputBytes')
    expect(() => parsePluginRuntimePackagePayload({ ...signedPayload, executable: true })).toThrow(
      'unsupported fields'
    )
  })

  test('rejects WASM imports, unbounded/shared memory, tables, starts, and excess memory', async () => {
    const limits = runtimePayload(await createPluginRuntimeAsset('wasm', wasmFixture())).runtime
      .limits
    await expect(
      validateWasmComputeRuntimeAsset(wasmFixture({ importFunction: true }), limits)
    ).rejects.toThrow('must not import')
    await expect(
      validateWasmComputeRuntimeAsset(wasmFixture({ memoryMaximum: null }), limits)
    ).rejects.toThrow('declare a maximum')
    await expect(
      validateWasmComputeRuntimeAsset(wasmFixture({ sharedMemory: true }), limits)
    ).rejects.toThrow('must not be shared')
    await expect(
      validateWasmComputeRuntimeAsset(wasmFixture({ table: true }), limits)
    ).rejects.toThrow('must not define tables')
    await expect(
      validateWasmComputeRuntimeAsset(wasmFixture({ start: true }), limits)
    ).rejects.toThrow('start function')
    await expect(
      validateWasmComputeRuntimeAsset(wasmFixture({ memoryMaximum: 5 }), limits)
    ).rejects.toThrow('maximum page limit')
  })

  test('binds all three exported ABI functions to their exact WASM signatures', async () => {
    const limits = runtimePayload(await createPluginRuntimeAsset('wasm', wasmFixture())).runtime
      .limits
    for (const name of ['openpencil_alloc', 'openpencil_dealloc', 'openpencil_compute'] as const) {
      await expect(
        validateWasmComputeRuntimeAsset(wasmFixture({ invalidAbiSignature: name }), limits)
      ).rejects.toThrow(`WASM ABI export ${name}`)
    }
  })

  test('fully validates the embedded asset of an unsigned payload', async () => {
    const payload = structuredClone(
      runtimePayload(await createPluginRuntimeAsset('wasm', wasmFixture()))
    )
    payload.runtime.asset.digest = 'Q'.repeat(43)
    await expect(validatePluginRuntimeEmbeddedAsset(payload)).rejects.toThrow(
      'Runtime asset digest mismatch'
    )
  })
})
