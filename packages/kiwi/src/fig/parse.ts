import { Inflate, inflateSync } from 'fflate'
import { Decompress as ZstdDecompress, decompress as zstdDecompress } from 'fzstd'

import {
  compileSchema,
  decodeBinarySchema,
  KIWI_RUNTIME_LIMITS,
  type KiwiRuntimeLimits
} from '../schema-runtime'
import type { FigmaMessage, FigmaObjectAnimationList, NodeChange } from './codec'
import { isZstdCompressed } from './protocol'

export type { NodeChange } from './codec'

/**
 * Deduplicates pluginData/pluginRelaunchData entries on raw NodeChange objects.
 * Some .fig files have millions of identical entries where only a small
 * fraction are unique by full triple.
 * Full-triple key (id+key+value) preserves multi-entry subsystems like OkHCL.
 */
export function deduplicateNodeChangePluginData(nodeChanges: NodeChange[]): void {
  for (const nc of nodeChanges) {
    if (nc.pluginData && nc.pluginData.length > 1) {
      const map = new Map<string, (typeof nc.pluginData)[number]>()
      for (const entry of nc.pluginData) {
        map.set(`${entry.pluginID}\0${entry.key}\0${entry.value}`, entry)
      }
      if (map.size < nc.pluginData.length) {
        nc.pluginData = [...map.values()]
      }
    }
    if (nc.pluginRelaunchData && nc.pluginRelaunchData.length > 1) {
      const map = new Map<string, (typeof nc.pluginRelaunchData)[number]>()
      for (const entry of nc.pluginRelaunchData) {
        map.set(`${entry.pluginID}\0${entry.command}\0${entry.message}\0${entry.isDeleted}`, entry)
      }
      if (map.size < nc.pluginRelaunchData.length) {
        nc.pluginRelaunchData = [...map.values()]
      }
    }
  }
}

interface FigKiwiPayload {
  schemaDeflated: Uint8Array
  dataRaw: Uint8Array
  version: number
}

export interface FigKiwiDecodeLimits extends KiwiRuntimeLimits {
  /** Maximum decompressed binary schema size. Omit for the legacy unbounded path. */
  maxSchemaBytes?: number
  /** Maximum decompressed Kiwi message size. Omit for the legacy unbounded path. */
  maxDataBytes?: number
  /** Maximum raw node-change records decoded before graph construction. */
  maxNodeChanges?: number
}

function remoteRuntimeLimits(limits: FigKiwiDecodeLimits): KiwiRuntimeLimits {
  const maxNodeChanges = checkedLimit(limits.maxNodeChanges, 'maxNodeChanges')
  const maxArrayLength =
    checkedLimit(limits.maxArrayLength, 'maxArrayLength') ?? KIWI_RUNTIME_LIMITS.maxArrayLength
  const maxArrayItems =
    checkedLimit(limits.maxArrayItems, 'maxArrayItems') ?? KIWI_RUNTIME_LIMITS.maxArrayItems

  return {
    // nodeChanges itself is a Kiwi array. Bound every single array before
    // generated code calls Array(length), while retaining a separate aggregate budget.
    maxArrayLength:
      maxNodeChanges === undefined ? maxArrayLength : Math.min(maxArrayLength, maxNodeChanges),
    maxArrayItems,
    maxSchemaDefinitions:
      checkedLimit(limits.maxSchemaDefinitions, 'maxSchemaDefinitions') ??
      KIWI_RUNTIME_LIMITS.maxSchemaDefinitions,
    maxFieldsPerDefinition:
      checkedLimit(limits.maxFieldsPerDefinition, 'maxFieldsPerDefinition') ??
      KIWI_RUNTIME_LIMITS.maxFieldsPerDefinition,
    maxSchemaFields:
      checkedLimit(limits.maxSchemaFields, 'maxSchemaFields') ??
      KIWI_RUNTIME_LIMITS.maxSchemaFields,
    maxDecodeDepth:
      checkedLimit(limits.maxDecodeDepth, 'maxDecodeDepth') ?? KIWI_RUNTIME_LIMITS.maxDecodeDepth
  }
}

class FigKiwiLimitError extends Error {
  override name = 'FigKiwiLimitError'
}

function checkedLimit(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return value
}

function joinBoundedChunks(
  chunks: readonly Uint8Array[],
  byteLength: number,
  maximum: number,
  label: string
): Uint8Array {
  if (byteLength > maximum) {
    throw new FigKiwiLimitError(`${label} exceeds the ${maximum} byte limit`)
  }
  const result = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function boundedInflate(data: Uint8Array, maximum: number, label: string): Uint8Array {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  const inflater = new Inflate((chunk) => {
    byteLength += chunk.byteLength
    if (byteLength > maximum) {
      throw new FigKiwiLimitError(`${label} exceeds the ${maximum} byte limit`)
    }
    chunks.push(chunk)
  })
  inflater.push(data, true)
  return joinBoundedChunks(chunks, byteLength, maximum, label)
}

const ZSTD_FRAME_MAGIC = 0xfd2fb528
const ZSTD_SKIPPABLE_MAGIC = 0x184d2a50
const ZSTD_SKIPPABLE_MAGIC_MASK = 0xfffffff0
const ZSTD_DICTIONARY_ID_BYTES = [0, 1, 2, 4] as const

function requireZstdBytes(
  data: Uint8Array,
  offset: number,
  byteLength: number,
  label: string
): void {
  if (offset < 0 || byteLength < 0 || byteLength > data.byteLength - offset) {
    throw new Error(`${label} contains a truncated Zstandard frame`)
  }
}

function zstdUint32(data: Uint8Array, offset: number, label: string): number {
  requireZstdBytes(data, offset, 4, label)
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  )
}

function zstdLittleEndianBigInt(
  data: Uint8Array,
  offset: number,
  byteLength: number,
  label: string
): bigint {
  requireZstdBytes(data, offset, byteLength, label)
  let value = 0n
  for (let index = 0; index < byteLength; index++) {
    value |= BigInt(data[offset + index]) << BigInt(index * 8)
  }
  return value
}

function boundedZstdFrameEnd(
  data: Uint8Array,
  frameOffset: number,
  maximum: number,
  label: string
): { end: number; contentSize?: bigint } {
  requireZstdBytes(data, frameOffset, 5, label)
  if (zstdUint32(data, frameOffset, label) !== ZSTD_FRAME_MAGIC) {
    throw new Error(`${label} contains invalid Zstandard frame magic`)
  }

  const descriptor = data[frameOffset + 4]
  if ((descriptor & 0x08) !== 0) {
    throw new Error(`${label} contains a reserved Zstandard frame-header bit`)
  }
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictionaryIdBytes = ZSTD_DICTIONARY_ID_BYTES[descriptor & 0x03]
  const contentSizeFlag = descriptor >>> 6
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag

  let offset = frameOffset + 5
  let windowSize: bigint
  if (singleSegment) {
    windowSize = 0n
  } else {
    requireZstdBytes(data, offset, 1, label)
    const windowDescriptor = data[offset++]
    const windowBase = 1n << BigInt(10 + (windowDescriptor >>> 3))
    windowSize = windowBase + (windowBase >> 3n) * BigInt(windowDescriptor & 0x07)
  }

  requireZstdBytes(data, offset, dictionaryIdBytes, label)
  offset += dictionaryIdBytes
  const contentSize =
    contentSizeBytes === 0
      ? undefined
      : zstdLittleEndianBigInt(data, offset, contentSizeBytes, label) +
        (contentSizeFlag === 1 ? 256n : 0n)
  offset += contentSizeBytes
  if (singleSegment) windowSize = contentSize ?? 0n

  const maximumBigInt = BigInt(maximum)
  if (contentSize !== undefined && contentSize > maximumBigInt) {
    throw new FigKiwiLimitError(
      `${label} Zstandard frame content size exceeds the ${maximum} byte limit`
    )
  }
  if (windowSize > maximumBigInt) {
    throw new FigKiwiLimitError(
      `${label} Zstandard frame window size exceeds the ${maximum} byte limit`
    )
  }

  let lastBlock = false
  while (!lastBlock) {
    requireZstdBytes(data, offset, 3, label)
    const blockHeader = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16)
    offset += 3
    lastBlock = (blockHeader & 1) !== 0
    const blockType = (blockHeader >>> 1) & 0x03
    const blockSize = blockHeader >>> 3
    if (blockType === 3) {
      throw new Error(`${label} contains a reserved Zstandard block type`)
    }
    if ((blockType === 0 || blockType === 1) && blockSize > maximum) {
      throw new FigKiwiLimitError(
        `${label} Zstandard block output exceeds the ${maximum} byte limit`
      )
    }
    const storedSize = blockType === 1 ? 1 : blockSize
    requireZstdBytes(data, offset, storedSize, label)
    offset += storedSize
  }

  if (checksum) {
    requireZstdBytes(data, offset, 4, label)
    offset += 4
  }
  return { end: offset, contentSize }
}

function assertBoundedZstdFrames(data: Uint8Array, maximum: number, label: string): void {
  let offset = 0
  let declaredContentSize = 0n
  const maximumBigInt = BigInt(maximum)

  while (offset < data.byteLength) {
    const magic = zstdUint32(data, offset, label)
    if ((magic & ZSTD_SKIPPABLE_MAGIC_MASK) === ZSTD_SKIPPABLE_MAGIC) {
      requireZstdBytes(data, offset, 8, label)
      const skippableSize = zstdUint32(data, offset + 4, label)
      requireZstdBytes(data, offset + 8, skippableSize, label)
      offset += 8 + skippableSize
      continue
    }
    const frame = boundedZstdFrameEnd(data, offset, maximum, label)
    if (frame.contentSize !== undefined) {
      declaredContentSize += frame.contentSize
      if (declaredContentSize > maximumBigInt) {
        throw new FigKiwiLimitError(
          `${label} declared Zstandard content exceeds the ${maximum} byte limit`
        )
      }
    }
    offset = frame.end
  }
}

function boundedZstdDecompress(data: Uint8Array, maximum: number, label: string): Uint8Array {
  // fzstd allocates the frame window while parsing the header, before it emits
  // an output chunk. Preflight every frame so the callback limit cannot be
  // bypassed by a malicious window or declared content size.
  assertBoundedZstdFrames(data, maximum, label)
  const chunks: Uint8Array[] = []
  let byteLength = 0
  const decompressor = new ZstdDecompress((chunk) => {
    byteLength += chunk.byteLength
    if (byteLength > maximum) {
      throw new FigKiwiLimitError(`${label} exceeds the ${maximum} byte limit`)
    }
    chunks.push(chunk)
  })
  decompressor.push(data, true)
  return joinBoundedChunks(chunks, byteLength, maximum, label)
}

interface CompiledKiwiSchema {
  decodeMessage(data: Uint8Array): unknown
}

export function parseFigKiwiContainer(
  data: Uint8Array,
  limits: FigKiwiDecodeLimits = {}
): FigKiwiPayload | null {
  const header = new TextDecoder().decode(data.slice(0, 8))
  if (header !== 'fig-kiwi') return null

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const version = view.getUint32(8, true)
  let offset = 12

  const chunks: Uint8Array[] = []
  while (offset < data.length) {
    if (offset + 4 > data.length) break
    const len = view.getUint32(offset, true)
    offset += 4
    if (offset + len > data.length) {
      throw new Error(
        `Corrupted .fig file: chunk at offset ${offset - 4} declares length ${len} but only ${data.length - offset} bytes remain`
      )
    }
    chunks.push(data.slice(offset, offset + len))
    offset += len
  }
  if (chunks.length < 2) return null

  const compressed = chunks[1]
  const maxDataBytes = checkedLimit(limits.maxDataBytes, 'maxDataBytes')
  let dataRaw: Uint8Array
  if (isZstdCompressed(compressed)) {
    dataRaw = maxDataBytes
      ? boundedZstdDecompress(compressed, maxDataBytes, 'Decompressed fig-kiwi data')
      : zstdDecompress(compressed)
  } else {
    try {
      dataRaw = maxDataBytes
        ? boundedInflate(compressed, maxDataBytes, 'Decompressed fig-kiwi data')
        : inflateSync(compressed)
    } catch (error) {
      if (error instanceof FigKiwiLimitError) throw error
      // Legacy fig-kiwi payloads may store the data chunk uncompressed.
      // Only recover from the ambiguous deflate branch: zstd corruption and
      // container framing errors must continue to surface to the caller.
      dataRaw = compressed
    }
  }
  if (maxDataBytes && dataRaw.byteLength > maxDataBytes) {
    throw new FigKiwiLimitError(`Decompressed fig-kiwi data exceeds the ${maxDataBytes} byte limit`)
  }

  return { schemaDeflated: chunks[0], dataRaw, version }
}

export interface FigKiwiDecodeResult {
  nodeChanges: NodeChange[]
  blobs: Uint8Array[]
  /** Message-level object animations, separate from NodeChange.objectAnimations. */
  objectAnimations: FigmaObjectAnimationList | null
  figKiwiVersion: number
  /** Deflated kiwi schema bytes from the original file (for roundtrip fidelity). */
  figSchemaDeflated: Uint8Array
}

/** Decode one raw `fig-kiwi` canvas payload. Outer `.fig` archive handling lives in `@open-pencil/fig`. */
export function decodeFigKiwiCanvas(
  data: Uint8Array,
  limits?: FigKiwiDecodeLimits
): FigKiwiDecodeResult {
  const payload = parseFigKiwiContainer(data, limits)
  if (!payload) throw new Error('Invalid fig-kiwi container')

  const maxSchemaBytes = checkedLimit(limits?.maxSchemaBytes, 'maxSchemaBytes')
  const schemaBytes = maxSchemaBytes
    ? boundedInflate(payload.schemaDeflated, maxSchemaBytes, 'Decompressed fig-kiwi schema')
    : inflateSync(payload.schemaDeflated)
  const runtimeLimits = limits === undefined ? undefined : remoteRuntimeLimits(limits)
  const schema = decodeBinarySchema(schemaBytes, runtimeLimits)
  const compiled = compileSchema(schema, {
    limits: runtimeLimits,
    validateDynamicSchema: runtimeLimits !== undefined
  }) as CompiledKiwiSchema
  const message = compiled.decodeMessage(payload.dataRaw) as FigmaMessage

  const nodeChanges = message.nodeChanges
  if (!nodeChanges || nodeChanges.length === 0) {
    throw new Error('No nodes found in .fig file')
  }
  const maxNodeChanges = checkedLimit(limits?.maxNodeChanges, 'maxNodeChanges')
  if (maxNodeChanges && nodeChanges.length > maxNodeChanges) {
    throw new FigKiwiLimitError(`.fig node changes exceed the ${maxNodeChanges} record limit`)
  }

  deduplicateNodeChangePluginData(nodeChanges)

  const blobs: Uint8Array[] = (message.blobs ?? []).map((blob) =>
    blob.bytes instanceof Uint8Array ? blob.bytes : new Uint8Array(Object.values(blob.bytes))
  )

  return {
    nodeChanges,
    blobs,
    objectAnimations: message.objectAnimations ?? null,
    figKiwiVersion: payload.version,
    figSchemaDeflated: payload.schemaDeflated
  }
}
