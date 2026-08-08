import { describe, expect, test } from 'bun:test'

import * as pluginRuntimePublicApi from '@/app/plugins/runtime'
import { executeWasmPluginCompute } from '@/app/plugins/runtime/wasm-host'

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

function signedLeb(value: number): number[] {
  const encoded: number[] = []
  let remaining = value
  let more = true
  while (more) {
    let byte = remaining & 0x7f
    remaining >>= 7
    const signBit = (byte & 0x40) !== 0
    more = !((remaining === 0 && !signBit) || (remaining === -1 && signBit))
    if (more) byte |= 0x80
    encoded.push(byte)
  }
  return encoded
}

function text(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)]
  return [...unsignedLeb(bytes.length), ...bytes]
}

function section(id: number, payload: number[]): number[] {
  return [id, ...unsignedLeb(payload.length), ...payload]
}

function jsonRuntime(outputJson: string, allocationPointer = 1_024): ArrayBuffer {
  const output = [...new TextEncoder().encode(outputJson)]
  const typeSection = section(
    1,
    [3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]
  )
  const functionSection = section(3, [3, 0, 1, 2])
  const memorySection = section(5, [1, 1, 1, 4])
  const exports = [
    [...text('memory'), 2, 0],
    [...text('openpencil_alloc'), 0, 0],
    [...text('openpencil_dealloc'), 0, 1],
    [...text('openpencil_compute'), 0, 2]
  ]
  const exportSection = section(7, [exports.length, ...exports.flat()])
  const stores = output.flatMap((value, index) => [
    0x20,
    0x02,
    ...(index === 0 ? [] : [0x41, ...signedLeb(index), 0x6a]),
    0x41,
    ...signedLeb(value),
    0x3a,
    0,
    0
  ])
  const bodies = [
    [0, 0x41, ...signedLeb(allocationPointer), 0x0b],
    [0, 0x0b],
    [0, ...stores, 0x41, ...signedLeb(output.length), 0x0b]
  ]
  const codeSection = section(10, [
    bodies.length,
    ...bodies.flatMap((body) => [...unsignedLeb(body.length), ...body])
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
    ...functionSection,
    ...memorySection,
    ...exportSection,
    ...codeSection
  ]).buffer
}

describe('WASM plugin compute host', () => {
  test('keeps the low-level WASM host out of the public runtime barrel', () => {
    expect(Object.hasOwn(pluginRuntimePublicApi, 'executeWasmPluginCompute')).toBe(false)
  })

  test('executes the documented UTF-8 JSON ABI against bounded linear memory', async () => {
    await expect(
      executeWasmPluginCompute({
        wasmBytes: jsonRuntime('{"ok":true}'),
        inputJson: '{"request":1}',
        maxOutputBytes: 64
      })
    ).resolves.toBe('{"ok":true}')
  })

  test('rejects invalid JSON output and out-of-bounds allocator results', async () => {
    await expect(
      executeWasmPluginCompute({
        wasmBytes: jsonRuntime('not-json'),
        inputJson: 'null',
        maxOutputBytes: 64
      })
    ).rejects.toThrow()
    await expect(
      executeWasmPluginCompute({
        wasmBytes: jsonRuntime('null', 65_535),
        inputJson: '{"too":"far"}',
        maxOutputBytes: 64
      })
    ).rejects.toThrow('out-of-bounds')
  })
})
