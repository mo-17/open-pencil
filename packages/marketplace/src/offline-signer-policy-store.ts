/* eslint-disable max-lines -- Durable Root-signer reservation and atomic file replacement share one filesystem trust boundary. */
/* eslint-disable promise/no-callback-in-promise -- The promise tail is the process-local mutex around the owner-only signer policy file. */
import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import {
  MARKETPLACE_OFFLINE_SIGNER_POLICY_LIMITS,
  assertMarketplaceOfflineSignerPolicyTransition,
  parseMarketplaceOfflineSignerPolicy,
  parseMarketplaceOfflineSignerPolicyJSON,
  serializeMarketplaceOfflineSignerPolicy,
  type MarketplaceOfflineSignerPolicyStore,
  type MarketplaceOfflineSignerPolicyUpdate,
  type MarketplaceOfflineSignerPolicyV1
} from './publication/offline'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

interface FileSnapshot {
  readonly dev: number
  readonly ino: number
  readonly nlink: number
  readonly size: number
}

interface ReadPolicyResult {
  readonly policy: MarketplaceOfflineSignerPolicyV1
  readonly snapshot: FileSnapshot
}

function missing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

function alreadyExists(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === 'EEXIST'
}

function ownerOnly(mode: number): boolean {
  return process.platform === 'win32' || (mode & 0o077) === 0
}

function fileSnapshot(metadata: Stats): FileSnapshot {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size <= 0 ||
    metadata.size > MARKETPLACE_OFFLINE_SIGNER_POLICY_LIMITS.maxJsonBytes ||
    !ownerOnly(metadata.mode)
  ) {
    throw new Error('Offline signer policy must be a bounded owner-only regular file')
  }
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    nlink: metadata.nlink,
    size: metadata.size
  })
}

function sameSnapshot(left: FileSnapshot, right: FileSnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size
  )
}

async function secureDirectory(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !ownerOnly(metadata.mode)) {
    throw new Error('Offline signer policy directory must be a real owner-only directory')
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function boundedPolicyText(
  handle: Awaited<ReturnType<typeof open>>,
  size: number
): Promise<string> {
  const bytes = new Uint8Array(await handle.readFile())
  if (
    bytes.byteLength !== size ||
    bytes.byteLength > MARKETPLACE_OFFLINE_SIGNER_POLICY_LIMITS.maxJsonBytes
  ) {
    throw new Error('Offline signer policy changed or exceeded its byte limit while reading')
  }
  try {
    return decoder.decode(bytes)
  } catch {
    throw new Error('Offline signer policy must contain valid UTF-8')
  }
}

async function readPolicy(path: string): Promise<ReadPolicyResult> {
  const before = fileSnapshot(await lstat(path))
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const descriptorBefore = fileSnapshot(await handle.stat())
    if (!sameSnapshot(before, descriptorBefore)) {
      throw new Error('Offline signer policy path changed before read')
    }
    const text = await boundedPolicyText(handle, descriptorBefore.size)
    const descriptorAfter = fileSnapshot(await handle.stat())
    const pathAfter = fileSnapshot(await lstat(path))
    if (
      !sameSnapshot(descriptorBefore, descriptorAfter) ||
      !sameSnapshot(descriptorAfter, pathAfter)
    ) {
      throw new Error('Offline signer policy changed while reading')
    }
    return Object.freeze({
      policy: parseMarketplaceOfflineSignerPolicyJSON(text),
      snapshot: pathAfter
    })
  } finally {
    await handle.close()
  }
}

async function unchanged(path: string, expected: FileSnapshot): Promise<void> {
  const current = fileSnapshot(await lstat(path))
  if (!sameSnapshot(current, expected)) {
    throw new Error('Offline signer policy changed during its locked transaction')
  }
}

async function writeTemporary(parent: string, target: string, text: string) {
  const temporary = resolve(parent, `.${basename(target)}.${randomUUID()}.tmp`)
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600
  )
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
    const metadata = fileSnapshot(await handle.stat())
    if (metadata.size !== encoder.encode(text).byteLength) {
      throw new Error('Offline signer policy temporary file changed while writing')
    }
    await handle.close()
    return Object.freeze({ temporary, metadata })
  } catch (cause) {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw cause
  }
}

async function initializePolicyFile(
  path: string,
  policy: MarketplaceOfflineSignerPolicyV1
): Promise<void> {
  const parent = dirname(path)
  const text = serializeMarketplaceOfflineSignerPolicy(policy)
  const temporary = await writeTemporary(parent, path, text)
  let temporaryPresent = true
  try {
    await link(temporary.temporary, path)
    await unlink(temporary.temporary)
    temporaryPresent = false
    await syncDirectory(parent)
    const stored = await readPolicy(path)
    if (serializeMarketplaceOfflineSignerPolicy(stored.policy) !== text) {
      throw new Error('Offline signer policy initialization did not preserve exact bytes')
    }
  } catch (cause) {
    if (alreadyExists(cause)) throw new Error('Offline signer policy already exists')
    throw cause
  } finally {
    if (temporaryPresent) await unlink(temporary.temporary).catch(() => undefined)
  }
}

async function replacePolicyFile(
  path: string,
  expected: FileSnapshot,
  policy: MarketplaceOfflineSignerPolicyV1
): Promise<void> {
  const parent = dirname(path)
  const text = serializeMarketplaceOfflineSignerPolicy(policy)
  const temporary = await writeTemporary(parent, path, text)
  let temporaryPresent = true
  try {
    await unchanged(path, expected)
    await rename(temporary.temporary, path)
    temporaryPresent = false
    await syncDirectory(parent)
    const stored = await readPolicy(path)
    if (serializeMarketplaceOfflineSignerPolicy(stored.policy) !== text) {
      throw new Error('Offline signer policy replacement did not preserve exact bytes')
    }
  } finally {
    if (temporaryPresent) await unlink(temporary.temporary).catch(() => undefined)
  }
}

interface LockHandle {
  readonly path: string
  readonly handle: Awaited<ReturnType<typeof open>>
}

async function acquireLock(path: string): Promise<LockHandle> {
  const lockPath = `${path}.lock`
  try {
    const handle = await open(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    )
    await handle.writeFile(`${process.pid}\n`, 'utf8')
    await handle.sync()
    await syncDirectory(dirname(path))
    return Object.freeze({ path: lockPath, handle })
  } catch (cause) {
    if (alreadyExists(cause)) {
      throw new Error(
        'Offline signer policy is locked; inspect the signer process before manually removing a stale .lock file'
      )
    }
    throw cause
  }
}

async function releaseLock(lock: LockHandle): Promise<void> {
  await lock.handle.close()
  await unlink(lock.path)
  await syncDirectory(dirname(lock.path))
}

function policyPath(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Offline signer policy path must be non-empty text')
  }
  return resolve(value)
}

export async function initializeFileMarketplaceOfflineSignerPolicyStore(
  pathValue: string,
  initialPolicy: unknown
): Promise<void> {
  const path = policyPath(pathValue)
  const parent = dirname(path)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await secureDirectory(parent)
  const policy = parseMarketplaceOfflineSignerPolicy(initialPolicy)
  const lock = await acquireLock(path)
  try {
    try {
      await lstat(path)
      throw new Error('Offline signer policy already exists')
    } catch (cause) {
      if (!missing(cause)) throw cause
    }
    await initializePolicyFile(path, policy)
  } finally {
    await releaseLock(lock)
  }
}

export async function readFileMarketplaceOfflineSignerPolicy(
  pathValue: string
): Promise<MarketplaceOfflineSignerPolicyV1> {
  const path = policyPath(pathValue)
  await secureDirectory(dirname(path))
  return (await readPolicy(path)).policy
}

export function createFileMarketplaceOfflineSignerPolicyStore(
  pathValue: string
): MarketplaceOfflineSignerPolicyStore {
  const path = policyPath(pathValue)
  let queue: Promise<void> = Promise.resolve()
  return Object.freeze({
    transaction<Value>(
      operation: (
        policy: MarketplaceOfflineSignerPolicyV1
      ) => Promise<MarketplaceOfflineSignerPolicyUpdate<Value>>
    ): Promise<Value> {
      const running = queue.then(async () => {
        await secureDirectory(dirname(path))
        const lock = await acquireLock(path)
        try {
          const current = await readPolicy(path)
          const update = await operation(
            parseMarketplaceOfflineSignerPolicy(structuredClone(current.policy))
          )
          const next = assertMarketplaceOfflineSignerPolicyTransition(current.policy, update.policy)
          if (
            serializeMarketplaceOfflineSignerPolicy(next) !==
            serializeMarketplaceOfflineSignerPolicy(current.policy)
          ) {
            await replacePolicyFile(path, current.snapshot, next)
          } else {
            await unchanged(path, current.snapshot)
          }
          return update.result
        } finally {
          await releaseLock(lock)
        }
      })
      queue = running.then(
        () => undefined,
        () => undefined
      )
      return running
    }
  })
}
