import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  readSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'

import { repositoryRelativeFindingPath } from './policy'

const FILE_HASH_BUFFER_BYTES = 64 * 1024
const MAX_COMMIT_ELIGIBLE_BYTES = 1024 * 1024 * 1024
const MAX_COMMIT_ELIGIBLE_FILES = 100_000
const MAX_GIT_PATH_OUTPUT_BYTES = 16 * 1024 * 1024

export type IndexEntryMode = '100644' | '100755' | '120000' | '160000'

export interface IndexEntry {
  objectID: string
  mode: IndexEntryMode
  path: string
}

export interface WorkingPathAuthority {
  digest: string
  kind: 'directory' | 'file' | 'missing' | 'symlink'
  mode: number
  path: string
  size: number
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT'
}

function decodeUTF8(value: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    return null
  }
}

function statAuthorityIsStable(
  before: ReturnType<typeof fstatSync>,
  after: ReturnType<typeof fstatSync>
) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  )
}

function hashRegularFile(path: string): { digest: string; mode: number; size: number } | null {
  let descriptor: number | null = null
  try {
    descriptor = openSync(path, 'r')
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size > MAX_COMMIT_ELIGIBLE_BYTES) return null

    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(FILE_HASH_BUFFER_BYTES)
    let totalBytes = 0
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, null)
      if (bytesRead === 0) break
      totalBytes += bytesRead
      if (totalBytes > MAX_COMMIT_ELIGIBLE_BYTES) return null
      hash.update(buffer.subarray(0, bytesRead))
    }

    const after = fstatSync(descriptor)
    if (totalBytes !== before.size || !statAuthorityIsStable(before, after)) return null
    return { digest: hash.digest('hex'), mode: before.mode, size: totalBytes }
  } catch {
    return null
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

function capturePathAuthority(repositoryRoot: string, path: string): WorkingPathAuthority | null {
  const source = resolve(repositoryRoot, path)
  let before
  try {
    before = lstatSync(source)
  } catch (error) {
    if (isMissingPathError(error)) {
      return { digest: '', kind: 'missing', mode: 0, path, size: 0 }
    }
    return null
  }

  if (before.isFile()) {
    const authority = hashRegularFile(source)
    if (authority === null) return null
    return { ...authority, kind: 'file', path }
  }
  if (before.isSymbolicLink()) {
    try {
      const target = readlinkSync(source)
      const after = lstatSync(source)
      if (
        !after.isSymbolicLink() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        readlinkSync(source) !== target
      ) {
        return null
      }
      const targetBytes = Buffer.from(target)
      return {
        digest: createHash('sha256').update(targetBytes).digest('hex'),
        kind: 'symlink',
        mode: before.mode,
        path,
        size: targetBytes.byteLength
      }
    } catch {
      return null
    }
  }
  if (before.isDirectory()) {
    return { digest: '', kind: 'directory', mode: before.mode, path, size: 0 }
  }
  return null
}

export function parseCommitEligiblePaths(
  repositoryRoot: string,
  output: Uint8Array
): string[] | null {
  if (output.byteLength > MAX_GIT_PATH_OUTPUT_BYTES) return null

  const value = decodeUTF8(output)
  if (value === null) return null
  if (value.length === 0) return []
  if (!value.endsWith('\0')) return null

  const rawPaths = value.slice(0, -1).split('\0')
  if (rawPaths.length > MAX_COMMIT_ELIGIBLE_FILES) return null

  const paths: string[] = []
  const seen = new Set<string>()
  for (const rawPath of rawPaths) {
    const path = repositoryRelativeFindingPath(repositoryRoot, rawPath)
    if (path === null || seen.has(path)) return null
    seen.add(path)
    paths.push(path)
  }
  return paths
}

export function parseIndexEntries(repositoryRoot: string, output: Uint8Array): IndexEntry[] | null {
  const value = decodeUTF8(output)
  if (value === null) return null
  if (value.length === 0) return []
  if (!value.endsWith('\0')) return null

  const records = value.slice(0, -1).split('\0')
  if (records.length > MAX_COMMIT_ELIGIBLE_FILES) return null

  const entries: IndexEntry[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const separator = record.indexOf('\t')
    if (separator <= 0) return null
    const metadata = record.slice(0, separator)
    const match = /^(100644|100755|120000|160000) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/.exec(
      metadata
    )
    if (match?.[1] === undefined || match[2] === undefined || match[3] !== '0') return null

    const path = repositoryRelativeFindingPath(repositoryRoot, record.slice(separator + 1))
    if (path === null || seen.has(path)) return null
    seen.add(path)
    entries.push({ mode: match[1] as IndexEntryMode, objectID: match[2], path })
  }
  return entries
}

export function uniqueIndexBlobIDs(entries: readonly IndexEntry[]): string[] {
  const objectIDs = new Set<string>()
  for (const entry of entries) {
    if (entry.mode !== '160000') objectIDs.add(entry.objectID)
  }
  return [...objectIDs]
}

export function parseGitBatchCheck(
  expectedObjectIDs: readonly string[],
  output: Uint8Array
): Map<string, number> | null {
  const value = decodeUTF8(output)
  if (value === null) return null
  if (expectedObjectIDs.length === 0) return value.length === 0 ? new Map() : null
  if (!value.endsWith('\n')) return null

  const lines = value.slice(0, -1).split('\n')
  if (lines.length !== expectedObjectIDs.length) return null

  let totalBytes = 0
  const sizes = new Map<string, number>()
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/.exec(lines[index] ?? '')
    const expectedObjectID = expectedObjectIDs[index]
    if (match?.[1] !== expectedObjectID || match[2] === undefined) return null
    const size = Number(match[2])
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_COMMIT_ELIGIBLE_BYTES) return null
    totalBytes += size
    if (totalBytes > MAX_COMMIT_ELIGIBLE_BYTES) return null
    sizes.set(expectedObjectID, size)
  }
  return sizes
}

export function parseGitBatchBlobs(
  expectedObjectIDs: readonly string[],
  sizes: ReadonlyMap<string, number>,
  output: Uint8Array
): Map<string, Uint8Array> | null {
  if (expectedObjectIDs.length === 0) return output.byteLength === 0 ? new Map() : null

  const bytes = Buffer.from(output)
  let offset = 0
  const blobs = new Map<string, Uint8Array>()
  for (const expectedObjectID of expectedObjectIDs) {
    const lineEnd = bytes.indexOf(0x0a, offset)
    if (lineEnd === -1) return null
    const header = decodeUTF8(bytes.subarray(offset, lineEnd))
    const match =
      header === null ? null : /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/.exec(header)
    const expectedSize = sizes.get(expectedObjectID)
    if (
      match?.[1] !== expectedObjectID ||
      match[2] === undefined ||
      expectedSize === undefined ||
      Number(match[2]) !== expectedSize
    ) {
      return null
    }

    const blobStart = lineEnd + 1
    const blobEnd = blobStart + expectedSize
    if (blobEnd >= bytes.byteLength || bytes[blobEnd] !== 0x0a) return null
    blobs.set(expectedObjectID, Uint8Array.from(bytes.subarray(blobStart, blobEnd)))
    offset = blobEnd + 1
  }
  return offset === bytes.byteLength ? blobs : null
}

export function captureWorkingTreeAuthority(
  repositoryRoot: string,
  paths: readonly string[]
): WorkingPathAuthority[] | null {
  let totalBytes = 0
  const authority: WorkingPathAuthority[] = []
  for (const path of paths) {
    const entry = capturePathAuthority(repositoryRoot, path)
    if (entry === null) return null
    totalBytes += entry.size
    if (totalBytes > MAX_COMMIT_ELIGIBLE_BYTES) return null
    authority.push(entry)
  }
  return authority
}

export function workingTreeAuthorityEquals(
  left: readonly WorkingPathAuthority[],
  right: readonly WorkingPathAuthority[]
): boolean {
  if (left.length !== right.length) return false
  return left.every((entry, index) => {
    const candidate = right[index]
    return (
      candidate !== undefined &&
      entry.digest === candidate.digest &&
      entry.kind === candidate.kind &&
      entry.mode === candidate.mode &&
      entry.path === candidate.path &&
      entry.size === candidate.size
    )
  })
}

function destinationDigest(path: string): { digest: string; size: number } | null {
  const authority = hashRegularFile(path)
  return authority === null ? null : { digest: authority.digest, size: authority.size }
}

export function createWorkingTreeSnapshot(
  repositoryRoot: string,
  snapshotRoot: string,
  paths: readonly string[]
): WorkingPathAuthority[] | null {
  const before = captureWorkingTreeAuthority(repositoryRoot, paths)
  if (before === null) return null

  try {
    for (const entry of before) {
      const destination = resolve(snapshotRoot, entry.path)
      if (entry.kind === 'missing') continue
      if (entry.kind === 'directory') {
        mkdirSync(destination, { recursive: true, mode: 0o700 })
        continue
      }

      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
      const source = resolve(repositoryRoot, entry.path)
      if (entry.kind === 'file') copyFileSync(source, destination)
      else writeFileSync(destination, readlinkSync(source), { mode: 0o600 })

      const copied = destinationDigest(destination)
      if (copied === null || copied.digest !== entry.digest || copied.size !== entry.size) {
        return null
      }
    }
  } catch {
    return null
  }

  const after = captureWorkingTreeAuthority(repositoryRoot, paths)
  return after !== null && workingTreeAuthorityEquals(before, after) ? before : null
}

export function materializeIndexBlobSnapshot(
  snapshotRoot: string,
  entries: readonly IndexEntry[],
  blobs: ReadonlyMap<string, Uint8Array>,
  maxBytes = MAX_COMMIT_ELIGIBLE_BYTES
): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_COMMIT_ELIGIBLE_BYTES) {
    return false
  }
  let totalBytes = 0
  for (const entry of entries) {
    if (entry.mode === '160000') continue
    const blob = blobs.get(entry.objectID)
    if (blob === undefined) return false
    totalBytes += blob.byteLength
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) return false
  }

  try {
    for (const entry of entries) {
      if (entry.mode === '160000') continue
      const blob = blobs.get(entry.objectID)
      if (blob === undefined) return false

      const destination = resolve(snapshotRoot, entry.path)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
      if (existsSync(destination)) return false
      writeFileSync(destination, blob, { mode: entry.mode === '100755' ? 0o700 : 0o600 })

      const copied = destinationDigest(destination)
      const expectedDigest = createHash('sha256').update(blob).digest('hex')
      if (copied === null || copied.digest !== expectedDigest || copied.size !== blob.byteLength) {
        return false
      }
    }
  } catch {
    return false
  }
  return true
}
