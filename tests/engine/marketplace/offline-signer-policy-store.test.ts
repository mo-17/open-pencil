import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createFileMarketplaceOfflineSignerPolicyStore,
  initializeFileMarketplaceOfflineSignerPolicyStore,
  parseMarketplaceOfflineSignerPolicy,
  parseMarketplaceOfflineSignerPolicyJSON,
  readFileMarketplaceOfflineSignerPolicy,
  serializeMarketplaceOfflineSignerPolicy,
  type MarketplaceOfflineSignerPolicyV1
} from '@open-pencil/marketplace'

const temporaryDirectories: string[] = []

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function policy(): MarketplaceOfflineSignerPolicyV1 {
  return parseMarketplaceOfflineSignerPolicy({
    schemaVersion: 1,
    marketplaceId: 'openpencil-marketplace',
    rootKeyId: 'root-2026',
    publicBaseUrl: 'https://plugins.example.com/',
    rootSpkiSha256: digest('root'),
    bootstrap: {
      stateDigest: digest('state'),
      auditSequence: 1,
      auditHead: digest('audit')
    },
    highWater: null,
    pending: null,
    revocationFloorRequestJson: null
  })
}

function reservation(current: MarketplaceOfflineSignerPolicyV1) {
  return parseMarketplaceOfflineSignerPolicy({
    ...current,
    pending: {
      sequence: 1,
      requestDigest: digest('request'),
      stateDigest: current.bootstrap.stateDigest,
      auditSequence: current.bootstrap.auditSequence,
      auditHead: current.bootstrap.auditHead,
      reservedAt: '2026-08-28T00:00:00.000Z'
    }
  })
}

async function temporaryPolicyPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openpencil-offline-signer-'))
  temporaryDirectories.push(root)
  return join(root, 'signer', 'policy.json')
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('durable offline signer policy store', () => {
  test('initializes exact owner-only canonical state and reopens it', async () => {
    const path = await temporaryPolicyPath()
    const initial = policy()
    await initializeFileMarketplaceOfflineSignerPolicyStore(path, initial)

    expect(await readFileMarketplaceOfflineSignerPolicy(path)).toEqual(initial)
    expect(parseMarketplaceOfflineSignerPolicyJSON(await readFile(path, 'utf8'))).toEqual(initial)
    if (process.platform !== 'win32') {
      expect((await lstat(path)).mode & 0o077).toBe(0)
      expect((await lstat(join(path, '..'))).mode & 0o077).toBe(0)
    }
    await expect(initializeFileMarketplaceOfflineSignerPolicyStore(path, initial)).rejects.toThrow(
      'already exists'
    )
  })

  test('persists a reservation before returning and preserves it across a new store instance', async () => {
    const path = await temporaryPolicyPath()
    await initializeFileMarketplaceOfflineSignerPolicyStore(path, policy())
    const first = createFileMarketplaceOfflineSignerPolicyStore(path)

    await first.transaction(async (current) => ({
      policy: reservation(current),
      result: null
    }))
    const reopened = createFileMarketplaceOfflineSignerPolicyStore(path)
    const observed = await reopened.transaction(async (current) => ({
      policy: current,
      result: current
    }))
    expect(observed.pending?.requestDigest).toBe(digest('request'))

    await expect(
      reopened.transaction(async (current) => ({
        policy: { ...current, pending: null },
        result: null
      }))
    ).rejects.toThrow('pending reservation may not be replaced or cleared')
    expect((await readFileMarketplaceOfflineSignerPolicy(path)).pending).toEqual(observed.pending)
  })

  test('does not persist a callback failure or permit concurrent lock bypass', async () => {
    const path = await temporaryPolicyPath()
    const initial = policy()
    await initializeFileMarketplaceOfflineSignerPolicyStore(path, initial)
    const first = createFileMarketplaceOfflineSignerPolicyStore(path)
    const second = createFileMarketplaceOfflineSignerPolicyStore(path)
    let release!: () => void
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })

    const running = first.transaction(async (current) => {
      entered()
      await paused
      throw new Error('simulated signer failure')
      return { policy: current, result: null }
    })
    await started
    await expect(
      second.transaction(async (current) => ({ policy: current, result: null }))
    ).rejects.toThrow('is locked')
    release()
    await expect(running).rejects.toThrow('simulated signer failure')
    expect(await readFileMarketplaceOfflineSignerPolicy(path)).toEqual(initial)
  })

  test('rejects non-owner-only files and symlink policy paths', async () => {
    if (process.platform === 'win32') return
    const path = await temporaryPolicyPath()
    const initial = policy()
    await initializeFileMarketplaceOfflineSignerPolicyStore(path, initial)
    await chmod(path, 0o644)
    await expect(readFileMarketplaceOfflineSignerPolicy(path)).rejects.toThrow('owner-only')
    await chmod(path, 0o600)

    const linked = `${path}.linked`
    await symlink(path, linked)
    await expect(readFileMarketplaceOfflineSignerPolicy(linked)).rejects.toThrow('regular file')
    expect(await readFile(path, 'utf8')).toBe(serializeMarketplaceOfflineSignerPolicy(initial))
  })
})
