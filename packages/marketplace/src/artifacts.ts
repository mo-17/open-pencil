import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { parseSha256Base64Url } from '@open-pencil/scene-graph'

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

function artifact(bytesValue: Uint8Array, expectedDigest?: string): MarketplaceArtifact {
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
      const next = artifact(value)
      if (!entries.has(next.digest)) {
        if (entries.size >= MARKETPLACE_ARTIFACT_LIMITS.maxMemoryEntries) {
          throw new Error('Marketplace artifact memory store is full')
        }
        entries.set(next.digest, next.bytes)
      }
      return artifact(entries.get(next.digest) as Uint8Array, next.digest)
    },
    async get(digestValue) {
      const digest = parseSha256Base64Url(digestValue, 'marketplace artifact digest')
      const bytes = entries.get(digest)
      return bytes ? artifact(bytes, digest) : null
    }
  }
}

async function verifiedFile(path: string, digest: string): Promise<MarketplaceArtifact | null> {
  try {
    const metadata = await stat(path)
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MARKETPLACE_ARTIFACT_LIMITS.maxBytes
    ) {
      throw new Error(`Marketplace artifact file is invalid: ${digest}`)
    }
    return artifact(new Uint8Array(await readFile(path)), digest)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw cause
  }
}

export function createFileMarketplaceArtifactStore(
  rootDirectory: string
): MarketplaceArtifactStore {
  if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) {
    throw new TypeError('Marketplace artifact directory must be a non-empty path')
  }
  const targetFor = (digest: string) => join(rootDirectory, `${digest}.blob`)
  return {
    async put(value) {
      const next = artifact(value)
      await mkdir(rootDirectory, { recursive: true, mode: 0o700 })
      const target = targetFor(next.digest)
      const existing = await verifiedFile(target, next.digest)
      if (existing) return existing
      const temporary = join(rootDirectory, `.${next.digest}.${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(next.bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await rename(temporary, target)
      } catch (cause) {
        await unlink(temporary).catch(() => undefined)
        const raced = await verifiedFile(target, next.digest)
        if (!raced) throw cause
        return raced
      }
      return (await verifiedFile(target, next.digest)) as MarketplaceArtifact
    },
    async get(digestValue) {
      const digest = parseSha256Base64Url(digestValue, 'marketplace artifact digest')
      return verifiedFile(targetFor(digest), digest)
    }
  }
}
