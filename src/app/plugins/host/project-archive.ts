import { zip, type Zippable } from 'fflate'

import { createPluginExportAbortError, throwIfPluginExportAborted } from './exporter-abort'

const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')
const MAX_PROJECT_FILES = 4_096
// fflate retains the source entries while constructing the result. Keep the
// source ceiling deliberately below desktop WebView memory limits; generated
// mobile projects above this size should use a future streaming exporter.
const MAX_PROJECT_BYTES = 64 * 1024 * 1024
const MAX_PROJECT_PATH_LENGTH = 512
const MAX_PROJECT_PATH_SEGMENT_BYTES = 255
const UNSAFE_PATH_SEGMENTS = new Set(['.', '..', '__proto__', 'constructor', 'prototype'])
const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i
const WINDOWS_INVALID_PATH_CHARACTER = /[<>:"|?*]/
const PATH_ENCODER = new TextEncoder()

function containsControlCharacter(value: string): boolean {
  return /[\p{Cc}\p{Cf}]/u.test(value)
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function isUnsafeWindowsPathSegment(segment: string): boolean {
  return (
    WINDOWS_INVALID_PATH_CHARACTER.test(segment) ||
    /[ .]$/.test(segment) ||
    WINDOWS_DEVICE_SEGMENT.test(segment)
  )
}

export function validateProjectArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > MAX_PROJECT_PATH_LENGTH ||
    path.startsWith('/') ||
    path.includes('\\') ||
    containsControlCharacter(path)
  ) {
    throw new Error(`Unsafe project archive path: ${path || '<empty>'}`)
  }
  const segments = path.split('/')
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        PATH_ENCODER.encode(segment).byteLength > MAX_PROJECT_PATH_SEGMENT_BYTES ||
        UNSAFE_PATH_SEGMENTS.has(segment.toLowerCase()) ||
        isUnsafeWindowsPathSegment(segment)
    )
  ) {
    throw new Error(`Unsafe project archive path: ${path}`)
  }
}

export async function archiveProjectFiles(
  files: ReadonlyMap<string, string | Uint8Array>,
  signal?: AbortSignal
): Promise<Uint8Array> {
  throwIfPluginExportAborted(signal)
  if (files.size === 0) throw new Error('The exported project contains no files')
  if (files.size > MAX_PROJECT_FILES) {
    throw new Error(`The exported project exceeds ${MAX_PROJECT_FILES} files`)
  }

  const prepared: Array<readonly [string, Uint8Array]> = []
  const portablePaths = new Map<string, string>()
  const encoder = new TextEncoder()
  let totalBytes = 0
  for (const [path, value] of [...files.entries()].sort(([left], [right]) =>
    compareCodeUnits(left, right)
  )) {
    throwIfPluginExportAborted(signal)
    validateProjectArchivePath(path)
    const portablePath = path.normalize('NFC').toLowerCase()
    const collision = portablePaths.get(portablePath)
    if (collision) {
      throw new Error(
        `Project archive paths collide on case-insensitive filesystems: ${collision}, ${path}`
      )
    }
    portablePaths.set(portablePath, path)
    // Binary assets are already immutable compiler/exporter values. Check their
    // size before retaining them instead of copying a potentially huge buffer
    // only to reject the archive afterwards.
    const bytes =
      typeof value === 'string'
        ? encodeStringWithinLimit(encoder, value, MAX_PROJECT_BYTES - totalBytes)
        : value
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_PROJECT_BYTES) {
      throw new Error(`The exported project exceeds ${MAX_PROJECT_BYTES} bytes`)
    }
    prepared.push([path, bytes])
  }

  const entries: Zippable = Object.create(null) as Zippable
  for (const [path, bytes] of prepared) entries[path] = bytes

  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      reject(createPluginExportAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    zip(entries, { level: 6, mtime: FIXED_ZIP_TIME }, (error, data) => {
      signal?.removeEventListener('abort', onAbort)
      if (settled) return
      settled = true
      if (signal?.aborted) reject(createPluginExportAbortError())
      else if (error) reject(error)
      else resolve(data)
    })
  })
}

function encodeStringWithinLimit(
  encoder: TextEncoder,
  value: string,
  remainingBytes: number
): Uint8Array {
  if (remainingBytes < 0) throw new Error(`The exported project exceeds ${MAX_PROJECT_BYTES} bytes`)
  const capacity = Math.min(remainingBytes + 1, value.length * 3)
  const buffer = new Uint8Array(capacity)
  const result = encoder.encodeInto(value, buffer)
  if (result.read !== value.length || result.written > remainingBytes) {
    throw new Error(`The exported project exceeds ${MAX_PROJECT_BYTES} bytes`)
  }
  return buffer.subarray(0, result.written)
}
