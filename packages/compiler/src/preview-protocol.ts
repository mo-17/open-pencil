import { decodeBase64, encodeBase64 } from '@open-pencil/core/bytes'

import type { PreviewFiles } from './vfs'

export interface SerializedBinaryPreviewFile {
  type: 'binary'
  base64: string
}

export interface SerializedBinaryPreviewFileRef {
  type: 'binary-ref'
}

/** Text keeps the legacy tuple shape; binary entries carry an explicit envelope. */
export type SerializedPreviewFile = [
  string,
  string | SerializedBinaryPreviewFile | SerializedBinaryPreviewFileRef
]

export interface PreviewFileEncodeCache {
  binariesByPath: Map<string, Uint8Array>
}

export interface PreviewFileDecodeCache {
  binariesByPath: Map<string, Uint8Array>
}

export function createPreviewFileEncodeCache(): PreviewFileEncodeCache {
  return { binariesByPath: new Map() }
}

export function createPreviewFileDecodeCache(): PreviewFileDecodeCache {
  return { binariesByPath: new Map() }
}

export function resetPreviewFileEncodeCache(cache: PreviewFileEncodeCache): void {
  cache.binariesByPath = new Map()
}

function sameBytes(previous: Uint8Array | undefined, next: Uint8Array): boolean {
  if (!previous || previous.byteLength !== next.byteLength) return false
  for (let index = 0; index < previous.byteLength; index++) {
    if (previous[index] !== next[index]) return false
  }
  return true
}

export function serializePreviewFiles(
  files: PreviewFiles,
  cache?: PreviewFileEncodeCache
): SerializedPreviewFile[] {
  const entries: SerializedPreviewFile[] = []
  const nextBinaries = cache ? new Map<string, Uint8Array>() : undefined
  for (const [path, content] of files) {
    if (typeof content === 'string') {
      entries.push([path, content])
      continue
    }
    const previous = cache?.binariesByPath.get(path)
    if (sameBytes(previous, content)) {
      entries.push([path, { type: 'binary-ref' }])
      nextBinaries?.set(path, previous as Uint8Array)
    } else {
      entries.push([path, { type: 'binary', base64: encodeBase64(content) }])
      nextBinaries?.set(path, content.slice())
    }
  }
  if (cache && nextBinaries) cache.binariesByPath = nextBinaries
  return entries
}

function isSerializedBinary(value: unknown): value is SerializedBinaryPreviewFile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SerializedBinaryPreviewFile>
  return candidate.type === 'binary' && typeof candidate.base64 === 'string'
}

function isSerializedBinaryRef(value: unknown): value is SerializedBinaryPreviewFileRef {
  if (typeof value !== 'object' || value === null) return false
  return (value as Partial<SerializedBinaryPreviewFileRef>).type === 'binary-ref'
}

export function deserializePreviewFiles(
  entries: readonly SerializedPreviewFile[],
  cache?: PreviewFileDecodeCache
): PreviewFiles {
  const files: PreviewFiles = new Map()
  const nextBinaries = cache ? new Map<string, Uint8Array>() : undefined
  for (const [path, content] of entries) {
    if (typeof path !== 'string') continue
    if (typeof content === 'string') {
      files.set(path, content)
      nextBinaries?.delete(path)
    } else if (isSerializedBinary(content)) {
      const decoded = decodeBase64(content.base64)
      const cached = cache?.binariesByPath.get(path)
      const bytes = sameBytes(cached, decoded) ? (cached as Uint8Array) : decoded
      files.set(path, bytes)
      nextBinaries?.set(path, bytes)
    } else if (isSerializedBinaryRef(content)) {
      const cached = cache?.binariesByPath.get(path)
      if (!cached) {
        throw new Error(`Invalid preview binary-ref for "${path}": no cached binary`)
      }
      files.set(path, cached)
      nextBinaries?.set(path, cached)
    }
  }
  if (cache && nextBinaries) cache.binariesByPath = nextBinaries
  return files
}
