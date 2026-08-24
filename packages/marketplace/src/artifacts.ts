import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { parseSha256Base64URL } from '@open-pencil/scene-graph'

export const MARKETPLACE_ARTIFACT_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxMemoryEntries: 4_096
})

export interface MarketplaceArtifact {
  digest: string
  byteLength: number
  bytes: Uint8Array
}

export interface MarketplaceArtifactStore {
  put(bytes: Uint8Array): Promise<MarketplaceArtifact>
  get(digest: string): Promise<MarketplaceArtifact | null>
}

export interface MarketplaceArtifactFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>
  stat(): Promise<MarketplaceArtifactFileMetadata>
  writeFile(bytes: Uint8Array): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface MarketplaceArtifactFileMetadata {
  dev: number
  ino: number
  nlink: number
  size: number
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface MarketplaceArtifactFileSystem {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>
  open(path: string, flags: string | number, mode?: number): Promise<MarketplaceArtifactFileHandle>
  link(source: string, target: string): Promise<void>
  lstat(path: string): Promise<MarketplaceArtifactFileMetadata>
  realpath(path: string): Promise<string>
  unlink(path: string): Promise<void>
  syncDirectory(path: string): Promise<void>
}

export interface CreateFileMarketplaceArtifactStoreOptions {
  fileSystem?: MarketplaceArtifactFileSystem
}

const NODE_ARTIFACT_FILE_SYSTEM: MarketplaceArtifactFileSystem = {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  async syncDirectory(path) {
    const handle = await open(path, directoryOpenFlags())
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

function noFollowFlag(): number {
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new TypeError('Marketplace artifact storage requires O_NOFOLLOW support')
  }
  return constants.O_NOFOLLOW
}

function directoryOpenFlags(): number {
  if (typeof constants.O_DIRECTORY !== 'number') {
    throw new TypeError('Marketplace artifact storage requires O_DIRECTORY support')
  }
  return constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag()
}

function readOpenFlags(): number {
  return constants.O_RDONLY | noFollowFlag()
}

function createOpenFlags(): number {
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag()
}

export function digestMarketplaceArtifact(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

function boundedBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError('Marketplace artifact must be bytes')
  if (value.byteLength === 0 || value.byteLength > MARKETPLACE_ARTIFACT_LIMITS.maxBytes) {
    throw new TypeError(
      `Marketplace artifact must contain between 1 and ${MARKETPLACE_ARTIFACT_LIMITS.maxBytes} bytes`
    )
  }
  return new Uint8Array(value)
}

export function inspectMarketplaceArtifact(
  bytesValue: Uint8Array,
  expectedDigest?: string
): MarketplaceArtifact {
  const bytes = boundedBytes(bytesValue)
  const digest = digestMarketplaceArtifact(bytes)
  if (expectedDigest && digest !== expectedDigest) {
    throw new Error(`Marketplace artifact digest mismatch: ${expectedDigest}`)
  }
  return { digest, byteLength: bytes.byteLength, bytes }
}

export function createMemoryMarketplaceArtifactStore(): MarketplaceArtifactStore {
  const entries = new Map<string, Uint8Array>()
  return {
    async put(value) {
      const next = inspectMarketplaceArtifact(value)
      if (!entries.has(next.digest)) {
        if (entries.size >= MARKETPLACE_ARTIFACT_LIMITS.maxMemoryEntries) {
          throw new Error('Marketplace artifact memory store is full')
        }
        entries.set(next.digest, next.bytes)
      }
      return inspectMarketplaceArtifact(entries.get(next.digest) as Uint8Array, next.digest)
    },
    async get(digestValue) {
      const digest = parseSha256Base64URL(digestValue, 'marketplace artifact digest')
      const bytes = entries.get(digest)
      return bytes ? inspectMarketplaceArtifact(bytes, digest) : null
    }
  }
}

function isMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

async function pathExists(
  fileSystem: MarketplaceArtifactFileSystem,
  path: string
): Promise<boolean> {
  try {
    await fileSystem.lstat(path)
    return true
  } catch (cause) {
    if (isMissing(cause)) return false
    throw cause
  }
}

async function syncNewRootParent(
  fileSystem: MarketplaceArtifactFileSystem,
  rootDirectory: string
): Promise<void> {
  const canonicalParent = await fileSystem.realpath(dirname(rootDirectory))
  await fileSystem.syncDirectory(canonicalParent)
}

function sameIdentity(
  first: MarketplaceArtifactFileMetadata,
  second: MarketplaceArtifactFileMetadata
): boolean {
  return first.dev === second.dev && first.ino === second.ino
}

function sameFileSnapshot(
  first: MarketplaceArtifactFileMetadata,
  second: MarketplaceArtifactFileMetadata
): boolean {
  return sameIdentity(first, second) && first.nlink === second.nlink && first.size === second.size
}

function assertArtifactFile(
  metadata: MarketplaceArtifactFileMetadata,
  digest: string,
  expectedSize?: number,
  expectedLinks = 1
): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== expectedLinks ||
    metadata.size <= 0 ||
    metadata.size > MARKETPLACE_ARTIFACT_LIMITS.maxBytes ||
    (expectedSize !== undefined && metadata.size !== expectedSize)
  ) {
    throw new Error(`Marketplace artifact file is invalid or hard-linked: ${digest}`)
  }
}

function assertEmptyTemporaryFile(metadata: MarketplaceArtifactFileMetadata, digest: string): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size !== 0
  ) {
    throw new Error(`Marketplace artifact temporary file is invalid: ${digest}`)
  }
}

async function readBoundedArtifact(
  handle: MarketplaceArtifactFileHandle,
  digest: string,
  expectedSize: number
): Promise<Uint8Array> {
  const bytes = new Uint8Array(Math.min(MARKETPLACE_ARTIFACT_LIMITS.maxBytes + 1, expectedSize + 1))
  let offset = 0
  while (offset < bytes.byteLength) {
    const remaining = bytes.byteLength - offset
    const { bytesRead } = await handle.read(bytes, offset, remaining, offset)
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > remaining) {
      throw new Error(`Marketplace artifact read returned an invalid byte count: ${digest}`)
    }
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset !== expectedSize || offset > MARKETPLACE_ARTIFACT_LIMITS.maxBytes) {
    throw new Error(`Marketplace artifact file is invalid: ${digest}`)
  }
  return bytes.slice(0, offset)
}

async function verifiedFile(
  fileSystem: MarketplaceArtifactFileSystem,
  path: string,
  digest: string
): Promise<MarketplaceArtifact | null> {
  let pathBefore: MarketplaceArtifactFileMetadata
  try {
    pathBefore = await fileSystem.lstat(path)
  } catch (cause) {
    if (isMissing(cause)) return null
    throw cause
  }
  assertArtifactFile(pathBefore, digest)

  const handle = await fileSystem.open(path, readOpenFlags())
  try {
    const descriptorBefore = await handle.stat()
    assertArtifactFile(descriptorBefore, digest)
    if (!sameFileSnapshot(pathBefore, descriptorBefore)) {
      throw new Error(`Marketplace artifact file changed before read: ${digest}`)
    }

    const bytes = await readBoundedArtifact(handle, digest, descriptorBefore.size)
    const descriptorAfter = await handle.stat()
    assertArtifactFile(descriptorAfter, digest, bytes.byteLength)
    if (!sameFileSnapshot(descriptorBefore, descriptorAfter)) {
      throw new Error(`Marketplace artifact file changed while reading: ${digest}`)
    }

    const pathAfter = await fileSystem.lstat(path)
    assertArtifactFile(pathAfter, digest, bytes.byteLength)
    if (!sameFileSnapshot(descriptorAfter, pathAfter)) {
      throw new Error(`Marketplace artifact path changed while reading: ${digest}`)
    }
    return inspectMarketplaceArtifact(bytes, digest)
  } finally {
    await handle.close()
  }
}

interface ArtifactRootGuard {
  handle: MarketplaceArtifactFileHandle
  identity: MarketplaceArtifactFileMetadata
}

async function openArtifactRoot(
  fileSystem: MarketplaceArtifactFileSystem,
  rootDirectory: string
): Promise<ArtifactRootGuard | null> {
  let pathMetadata: MarketplaceArtifactFileMetadata
  try {
    pathMetadata = await fileSystem.lstat(rootDirectory)
  } catch (cause) {
    if (isMissing(cause)) return null
    throw cause
  }
  if (!pathMetadata.isDirectory() || pathMetadata.isSymbolicLink()) {
    throw new Error('Marketplace artifact root must be a real directory')
  }

  const handle = await fileSystem.open(rootDirectory, directoryOpenFlags())
  try {
    const descriptorMetadata = await handle.stat()
    if (!descriptorMetadata.isDirectory() || !sameIdentity(pathMetadata, descriptorMetadata)) {
      throw new Error('Marketplace artifact root changed while opening')
    }
    return { handle, identity: descriptorMetadata }
  } catch (cause) {
    await handle.close()
    throw cause
  }
}

async function assertArtifactRootUnchanged(
  fileSystem: MarketplaceArtifactFileSystem,
  rootDirectory: string,
  guard: ArtifactRootGuard
): Promise<void> {
  const descriptorMetadata = await guard.handle.stat()
  const pathMetadata = await fileSystem.lstat(rootDirectory)
  if (
    !descriptorMetadata.isDirectory() ||
    !pathMetadata.isDirectory() ||
    pathMetadata.isSymbolicLink() ||
    !sameIdentity(guard.identity, descriptorMetadata) ||
    !sameIdentity(descriptorMetadata, pathMetadata)
  ) {
    throw new Error('Marketplace artifact root changed during operation')
  }
}

async function removeOwnedTemporary(
  fileSystem: MarketplaceArtifactFileSystem,
  path: string,
  handle: MarketplaceArtifactFileHandle
): Promise<void> {
  let pathMetadata: MarketplaceArtifactFileMetadata
  try {
    pathMetadata = await fileSystem.lstat(path)
  } catch (cause) {
    if (isMissing(cause)) return
    throw cause
  }
  const descriptorMetadata = await handle.stat()
  if (!sameIdentity(pathMetadata, descriptorMetadata)) {
    throw new Error('Marketplace artifact temporary path changed before cleanup')
  }
  await fileSystem.unlink(path)
}

async function writeArtifactCreateOnly(
  fileSystem: MarketplaceArtifactFileSystem,
  rootDirectory: string,
  target: string,
  artifact: MarketplaceArtifact
): Promise<MarketplaceArtifact> {
  const temporary = join(rootDirectory, `.${artifact.digest}.${randomUUID()}.tmp`)
  const handle = await fileSystem.open(temporary, createOpenFlags(), 0o600)
  let temporaryPresent = true
  try {
    const descriptorBefore = await handle.stat()
    assertEmptyTemporaryFile(descriptorBefore, artifact.digest)
    await handle.writeFile(artifact.bytes)
    await handle.sync()

    const descriptorWritten = await handle.stat()
    assertArtifactFile(descriptorWritten, artifact.digest, artifact.byteLength)
    if (!sameIdentity(descriptorBefore, descriptorWritten)) {
      throw new Error(`Marketplace artifact temporary file changed: ${artifact.digest}`)
    }
    const temporaryWritten = await fileSystem.lstat(temporary)
    assertArtifactFile(temporaryWritten, artifact.digest, artifact.byteLength)
    if (!sameFileSnapshot(descriptorWritten, temporaryWritten)) {
      throw new Error(`Marketplace artifact temporary path changed: ${artifact.digest}`)
    }

    try {
      await fileSystem.link(temporary, target)
    } catch (cause) {
      if (!((cause as NodeJS.ErrnoException).code === 'EEXIST')) throw cause
      await removeOwnedTemporary(fileSystem, temporary, handle)
      temporaryPresent = false
      await fileSystem.syncDirectory(rootDirectory)
      const raced = await verifiedFile(fileSystem, target, artifact.digest)
      if (raced) return raced
      throw cause
    }

    const descriptorLinked = await handle.stat()
    assertArtifactFile(descriptorLinked, artifact.digest, artifact.byteLength, 2)
    const temporaryLinked = await fileSystem.lstat(temporary)
    const targetLinked = await fileSystem.lstat(target)
    assertArtifactFile(temporaryLinked, artifact.digest, artifact.byteLength, 2)
    assertArtifactFile(targetLinked, artifact.digest, artifact.byteLength, 2)
    if (
      !sameFileSnapshot(descriptorLinked, temporaryLinked) ||
      !sameFileSnapshot(descriptorLinked, targetLinked)
    ) {
      throw new Error(`Marketplace artifact link changed during publication: ${artifact.digest}`)
    }

    await removeOwnedTemporary(fileSystem, temporary, handle)
    temporaryPresent = false
    const descriptorPublished = await handle.stat()
    const targetPublished = await fileSystem.lstat(target)
    assertArtifactFile(descriptorPublished, artifact.digest, artifact.byteLength)
    assertArtifactFile(targetPublished, artifact.digest, artifact.byteLength)
    if (!sameFileSnapshot(descriptorPublished, targetPublished)) {
      throw new Error(`Marketplace artifact target changed during publication: ${artifact.digest}`)
    }
    await fileSystem.syncDirectory(rootDirectory)
    const published = await verifiedFile(fileSystem, target, artifact.digest)
    if (!published) throw new Error(`Marketplace artifact target disappeared: ${artifact.digest}`)
    return published
  } finally {
    try {
      if (temporaryPresent) await removeOwnedTemporary(fileSystem, temporary, handle)
    } finally {
      await handle.close()
    }
  }
}

export function createFileMarketplaceArtifactStore(
  rootDirectory: string,
  options: CreateFileMarketplaceArtifactStoreOptions = {}
): MarketplaceArtifactStore {
  if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) {
    throw new TypeError('Marketplace artifact directory must be a non-empty path')
  }
  const fileSystem = options.fileSystem ?? NODE_ARTIFACT_FILE_SYSTEM
  const targetFor = (digest: string) => join(rootDirectory, `${digest}.blob`)
  return {
    async put(value) {
      const next = inspectMarketplaceArtifact(value)
      const rootExisted = await pathExists(fileSystem, rootDirectory)
      await fileSystem.mkdir(rootDirectory, { recursive: true, mode: 0o700 })
      const root = await openArtifactRoot(fileSystem, rootDirectory)
      if (!root) throw new Error('Marketplace artifact root disappeared after creation')
      try {
        if (!rootExisted) await syncNewRootParent(fileSystem, rootDirectory)
        const target = targetFor(next.digest)
        const existing = await verifiedFile(fileSystem, target, next.digest)
        if (existing) {
          await fileSystem.syncDirectory(rootDirectory)
          await assertArtifactRootUnchanged(fileSystem, rootDirectory, root)
          return existing
        }
        const published = await writeArtifactCreateOnly(fileSystem, rootDirectory, target, next)
        await assertArtifactRootUnchanged(fileSystem, rootDirectory, root)
        return published
      } finally {
        await root.handle.close()
      }
    },
    async get(digestValue) {
      const digest = parseSha256Base64URL(digestValue, 'marketplace artifact digest')
      const root = await openArtifactRoot(fileSystem, rootDirectory)
      if (!root) return null
      try {
        const artifact = await verifiedFile(fileSystem, targetFor(digest), digest)
        await assertArtifactRootUnchanged(fileSystem, rootDirectory, root)
        return artifact
      } finally {
        await root.handle.close()
      }
    }
  }
}
