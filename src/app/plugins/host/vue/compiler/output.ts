import type { CompilerOutput } from '@open-pencil/compiler'

import {
  assertExactPrototype,
  assertUnextendedCollection,
  intrinsicNumber,
  intrinsicValue
} from '../worker/clone-safety'
import { VUE_SOURCE_COMPILER_WORKER_LIMITS } from './limits'

const ARRAY_BUFFER_BYTE_LENGTH_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object
const TYPED_ARRAY_BUFFER_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'buffer'
)

export function arrayBufferByteLength(value: ArrayBuffer): number {
  return intrinsicNumber(ARRAY_BUFFER_BYTE_LENGTH_DESCRIPTOR, value)
}

export function uint8ArrayBackingBuffer(value: Uint8Array): ArrayBuffer {
  assertExactPrototype(value, Uint8Array.prototype, 'Uint8Array')
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Vue source Worker Uint8Array must not contain symbol properties')
  }
  const buffer = intrinsicValue(TYPED_ARRAY_BUFFER_DESCRIPTOR, value)
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError('Vue source Worker does not support SharedArrayBuffer views')
  }
  assertExactPrototype(buffer, ArrayBuffer.prototype, 'ArrayBuffer')
  assertUnextendedCollection(buffer, 'ArrayBuffer')
  return buffer
}

function utf8Bytes(value: string, remaining: number): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
    if (bytes > remaining) return bytes
  }
  return bytes
}

function addOutputString(bytes: number, value: string): number {
  const next = bytes + utf8Bytes(value, VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes - bytes)
  if (next > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes) {
    throw new Error(
      `Vue compiler Worker output exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes} bytes`
    )
  }
  return next
}

function outputCollections(output: CompilerOutput): {
  files: Map<unknown, unknown>
  warnings: unknown[]
} {
  const files: unknown = Object.getOwnPropertyDescriptor(output, 'files')?.value
  const warnings: unknown = Object.getOwnPropertyDescriptor(output, 'warnings')?.value
  if (!(files instanceof Map) || !Array.isArray(warnings)) {
    throw new TypeError('Vue compiler Worker output is invalid')
  }
  if (files.size > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputFiles) {
    throw new Error(
      `Vue compiler Worker output exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputFiles} files`
    )
  }
  if (warnings.length > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxWarnings) {
    throw new Error(
      `Vue compiler Worker output exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxWarnings} warnings`
    )
  }
  return { files: files as Map<unknown, unknown>, warnings: warnings as unknown[] }
}

function measureOutputFile(
  bytes: number,
  path: unknown,
  content: unknown,
  binaryBackings: WeakSet<ArrayBuffer>
): number {
  if (
    typeof path !== 'string' ||
    (typeof content !== 'string' && !(content instanceof Uint8Array))
  ) {
    throw new TypeError('Vue compiler Worker output file is invalid')
  }
  let next = addOutputString(bytes, path)
  if (typeof content === 'string') return addOutputString(next, content)
  const backing = uint8ArrayBackingBuffer(content)
  if (!binaryBackings.has(backing)) {
    binaryBackings.add(backing)
    next += arrayBufferByteLength(backing)
  }
  if (next > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes) {
    throw new Error(
      `Vue compiler Worker output exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes} bytes`
    )
  }
  return next
}

function measureOutputWarning(bytes: number, warning: unknown): number {
  if (warning === null || typeof warning !== 'object') {
    throw new TypeError('Vue compiler Worker warning is invalid')
  }
  const code: unknown = Object.getOwnPropertyDescriptor(warning, 'code')?.value
  const message: unknown = Object.getOwnPropertyDescriptor(warning, 'message')?.value
  const nodeId: unknown = Object.getOwnPropertyDescriptor(warning, 'nodeId')?.value
  if (
    typeof code !== 'string' ||
    typeof message !== 'string' ||
    (nodeId !== undefined && typeof nodeId !== 'string')
  ) {
    throw new TypeError('Vue compiler Worker warning is invalid')
  }
  let next = addOutputString(bytes, code)
  next = addOutputString(next, message)
  return nodeId ? addOutputString(next, nodeId) : next
}

export function assertVueCompilerOutputWithinLimits(output: CompilerOutput): void {
  const { files, warnings } = outputCollections(output)
  const binaryBackings = new WeakSet<ArrayBuffer>()
  let bytes = 0
  for (const [path, content] of files) {
    bytes = measureOutputFile(bytes, path, content, binaryBackings)
  }
  for (const warning of warnings) bytes = measureOutputWarning(bytes, warning)
}
