type WasmAbiExports = {
  memory: WebAssembly.Memory
  openpencil_alloc(length: number): number
  openpencil_dealloc(pointer: number, length: number): void
  openpencil_compute(
    inputPointer: number,
    inputLength: number,
    outputPointer: number,
    outputCapacity: number
  ): number
}

function checkedInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${label} returned an invalid pointer or length`)
  }
  return value as number
}

function runtimeExports(exports: WebAssembly.Exports): WasmAbiExports {
  if (
    !(exports.memory instanceof WebAssembly.Memory) ||
    typeof exports.openpencil_alloc !== 'function' ||
    typeof exports.openpencil_dealloc !== 'function' ||
    typeof exports.openpencil_compute !== 'function'
  ) {
    throw new Error(
      'WASM runtime must export memory, openpencil_alloc, openpencil_dealloc, and openpencil_compute'
    )
  }
  return exports as WasmAbiExports
}

function byteRange(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array {
  const end = pointer + length
  if (!Number.isSafeInteger(end) || end > memory.buffer.byteLength) {
    throw new Error('WASM runtime returned an out-of-bounds memory range')
  }
  return new Uint8Array(memory.buffer, pointer, length)
}

/** Executes one already provenance-verified compute package inside its disposable Worker. */
export async function executeWasmPluginCompute(options: {
  wasmBytes: ArrayBuffer
  inputJson: string
  maxOutputBytes: number
}): Promise<string> {
  const module = await WebAssembly.compile(options.wasmBytes)
  if (WebAssembly.Module.imports(module).length > 0) {
    throw new Error('WASM runtime imports are not allowed')
  }
  const instance = await WebAssembly.instantiate(module, {})
  const exports = runtimeExports(instance.exports)
  const input = new TextEncoder().encode(options.inputJson)
  const inputPointer = checkedInteger(
    exports.openpencil_alloc(input.byteLength),
    'openpencil_alloc',
    exports.memory.buffer.byteLength
  )
  try {
    byteRange(exports.memory, inputPointer, input.byteLength).set(input)
    const outputPointer = checkedInteger(
      exports.openpencil_alloc(options.maxOutputBytes),
      'openpencil_alloc',
      exports.memory.buffer.byteLength
    )
    try {
      const outputLength = checkedInteger(
        exports.openpencil_compute(
          inputPointer,
          input.byteLength,
          outputPointer,
          options.maxOutputBytes
        ),
        'openpencil_compute',
        options.maxOutputBytes
      )
      const output = byteRange(exports.memory, outputPointer, outputLength)
      const outputJson = new TextDecoder('utf-8', { fatal: true }).decode(output)
      JSON.parse(outputJson)
      return outputJson
    } finally {
      exports.openpencil_dealloc(outputPointer, options.maxOutputBytes)
    }
  } finally {
    exports.openpencil_dealloc(inputPointer, input.byteLength)
  }
}
