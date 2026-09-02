import { sha256 } from '@noble/hashes/sha2'

import type { SceneGraph } from '@open-pencil/scene-graph'

interface HashSink {
  update: (data: Uint8Array) => unknown
  digest: () => Uint8Array
}

// Node mutations are covered by SceneGraph node events. instanceIndex is
// derived from those nodes. Everything else is included by default, while
// process-local bookkeeping is excluded explicitly.
const EXCLUDED_GRAPH_FIELDS = new Set([
  'absPosCache',
  'activeMode',
  'emitter',
  'instanceIndex',
  'layoutMutationDepth',
  'maxDepth',
  'maxNodes',
  'nodeMutationOrigin',
  'nodes',
  'positionPreviewVersion',
  'previewMutationDepth',
  'sourceMetadataPreservationDepth'
])

const textEncoder = new TextEncoder()

const enum SignatureTag {
  Null = 0,
  Undefined = 1,
  False = 2,
  True = 3,
  Number = 4,
  BigInt = 5,
  String = 6,
  Array = 7,
  Map = 8,
  Set = 9,
  Object = 10,
  ArrayBuffer = 11,
  ArrayBufferView = 12,
  Date = 13,
  MissingArrayEntry = 14,
  PresentArrayEntry = 15
}

function writeTag(sink: HashSink, tag: SignatureTag): void {
  sink.update(Uint8Array.of(tag))
}

function writeLength(sink: HashSink, length: number): void {
  sink.update(textEncoder.encode(`${length}:`))
}

function writeBytes(sink: HashSink, bytes: Uint8Array): void {
  writeLength(sink, bytes.byteLength)
  sink.update(bytes)
}

function writeString(sink: HashSink, value: string): void {
  writeBytes(sink, textEncoder.encode(value))
}

function writeNumber(sink: HashSink, value: number): void {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, Number.isNaN(value) ? Number.NaN : value, false)
  sink.update(bytes)
}

function enumerableOwnStringKeys(value: object): string[] {
  const keys: string[] = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      throw new TypeError('Symbol-keyed persistent graph state is unsupported')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) {
      throw new TypeError('Non-enumerable persistent graph state is unsupported')
    }
    keys.push(key)
  }
  return keys.sort()
}

function writeProperty(sink: HashSink, owner: object, key: string, active: WeakSet<object>): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key)
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError('Persistent graph state must use own data properties')
  }
  writeString(sink, key)
  writeValue(sink, descriptor.value, active)
}

function writeValue(sink: HashSink, value: unknown, active: WeakSet<object>): void {
  if (value === null) {
    writeTag(sink, SignatureTag.Null)
    return
  }
  if (value === undefined) {
    writeTag(sink, SignatureTag.Undefined)
    return
  }
  if (value === false) {
    writeTag(sink, SignatureTag.False)
    return
  }
  if (value === true) {
    writeTag(sink, SignatureTag.True)
    return
  }
  if (typeof value === 'number') {
    writeTag(sink, SignatureTag.Number)
    writeNumber(sink, value)
    return
  }
  if (typeof value === 'bigint') {
    writeTag(sink, SignatureTag.BigInt)
    writeString(sink, value.toString())
    return
  }
  if (typeof value === 'string') {
    writeTag(sink, SignatureTag.String)
    writeString(sink, value)
    return
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported persistent graph value: ${typeof value}`)
  }
  if (active.has(value)) throw new TypeError('Cyclic persistent graph state is unsupported')
  active.add(value)
  try {
    if (Array.isArray(value)) {
      writeTag(sink, SignatureTag.Array)
      writeLength(sink, value.length)
      for (let index = 0; index < value.length; index++) {
        if (Object.hasOwn(value, index)) {
          writeTag(sink, SignatureTag.PresentArrayEntry)
          writeValue(sink, value[index], active)
        } else writeTag(sink, SignatureTag.MissingArrayEntry)
      }
      return
    }
    if (value instanceof Map) {
      writeTag(sink, SignatureTag.Map)
      writeLength(sink, value.size)
      for (const [key, entryValue] of value) {
        writeValue(sink, key, active)
        writeValue(sink, entryValue, active)
      }
      return
    }
    if (value instanceof Set) {
      writeTag(sink, SignatureTag.Set)
      writeLength(sink, value.size)
      for (const entryValue of value) writeValue(sink, entryValue, active)
      return
    }
    if (value instanceof ArrayBuffer) {
      writeTag(sink, SignatureTag.ArrayBuffer)
      writeBytes(sink, new Uint8Array(value))
      return
    }
    if (ArrayBuffer.isView(value)) {
      writeTag(sink, SignatureTag.ArrayBufferView)
      writeString(sink, value.constructor.name)
      writeBytes(sink, new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      return
    }
    if (value instanceof Date) {
      writeTag(sink, SignatureTag.Date)
      writeNumber(sink, value.getTime())
      return
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Unsupported persistent graph object: ${value.constructor?.name}`)
    }
    const keys = enumerableOwnStringKeys(value)
    writeTag(sink, SignatureTag.Object)
    writeLength(sink, keys.length)
    for (const key of keys) writeProperty(sink, value, key, active)
  } finally {
    active.delete(value)
  }
}

function writeImageIndex(sink: HashSink, images: SceneGraph['images']): void {
  writeTag(sink, SignatureTag.Map)
  writeLength(sink, images.size)
  const active = new WeakSet<object>()
  for (const [key, bytes] of images) {
    writeValue(sink, key, active)
    writeValue(sink, bytes.byteLength, active)
  }
}

function writeImmutableBytesIndex(sink: HashSink, bytes: Uint8Array | null): void {
  if (bytes === null) {
    writeTag(sink, SignatureTag.Null)
    return
  }
  writeTag(sink, SignatureTag.ArrayBufferView)
  writeString(sink, bytes.constructor.name)
  writeLength(sink, bytes.byteLength)
}

/**
 * Signs persistent document-level state that has no SceneGraph node event.
 * Node values are deliberately excluded and must mutate through SceneGraph's
 * event-emitting APIs; activeMode is runtime variable-preview state and is
 * likewise excluded. Unsupported/hidden/cyclic state fails closed.
 */
export function persistentGraphLevelSignature(graph: SceneGraph): string | null {
  try {
    const graphRecord = graph as unknown as Record<string, unknown>
    const keys = enumerableOwnStringKeys(graph).filter((key) => !EXCLUDED_GRAPH_FIELDS.has(key))
    const hash = sha256.create()
    writeTag(hash, SignatureTag.Object)
    writeLength(hash, keys.length)
    const active = new WeakSet<object>()
    for (const key of keys) {
      writeString(hash, key)
      // Imported image/schema buffers are immutable shared document assets.
      // Signing their keys/lengths keeps large saves constant-time; the client
      // separately checks exact Uint8Array references to catch replacement.
      if (key === 'images') writeImageIndex(hash, graph.images)
      else if (key === 'figSchemaDeflated') {
        writeImmutableBytesIndex(hash, graph.figSchemaDeflated)
      } else writeValue(hash, graphRecord[key], active)
    }
    return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
