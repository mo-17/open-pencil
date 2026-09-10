import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, open, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export const BACKEND_COMPILER_SIDECAR_NAME = 'openpencil-backend-compiler-sidecar'

export const BACKEND_COMPILER_SIDECAR_TARGETS = Object.freeze({
  'aarch64-apple-darwin': Object.freeze({
    bunTarget: 'bun-darwin-arm64',
    extension: '',
    format: 'mach-o'
  }),
  'x86_64-apple-darwin': Object.freeze({
    bunTarget: 'bun-darwin-x64-baseline',
    extension: '',
    format: 'mach-o'
  }),
  'x86_64-pc-windows-msvc': Object.freeze({
    bunTarget: 'bun-windows-x64-baseline',
    extension: '.exe',
    format: 'pe'
  }),
  'aarch64-pc-windows-msvc': Object.freeze({
    bunTarget: 'bun-windows-arm64',
    extension: '.exe',
    format: 'pe'
  }),
  'x86_64-unknown-linux-gnu': Object.freeze({
    bunTarget: 'bun-linux-x64-baseline',
    extension: '',
    format: 'elf'
  })
} as const)

export type BackendCompilerSidecarTargetTriple = keyof typeof BACKEND_COMPILER_SIDECAR_TARGETS
type BackendCompilerSidecarFormat =
  (typeof BACKEND_COMPILER_SIDECAR_TARGETS)[BackendCompilerSidecarTargetTriple]['format']

export const MIN_BINARY_BYTES = 1_000_000
export const MAX_BINARY_BYTES = 256 * 1024 * 1024

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..')
export const DEFAULT_BACKEND_COMPILER_SIDECAR_OUTPUT_DIRECTORY = join(
  REPOSITORY_ROOT,
  'desktop/binaries'
)
const REMOVE_RETRY_ATTEMPTS = 4
const REMOVE_RETRY_DELAY_MS = 50

export interface CandidateBinaryFacts {
  readonly byteLength: number
  readonly sha256: string
}

export type CandidateDirectoryDurabilityV1 = 'directory-fsync' | 'manifest-digest-fail-closed'

interface CandidateBuildLock {
  readonly handle: Awaited<ReturnType<typeof open>>
  readonly path: string
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

function retryableWindowsRemoveError(error: unknown): boolean {
  return process.platform === 'win32' && (isErrno(error, 'EBUSY') || isErrno(error, 'EPERM'))
}

async function removeMatchingRegularFile(path: string, expected: Stats): Promise<void> {
  for (let attempt = 1; attempt <= REMOVE_RETRY_ATTEMPTS; attempt++) {
    let current: Stats
    try {
      current = await lstat(path)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return
      throw error
    }
    if (!current.isFile() || current.isSymbolicLink() || !sameFileIdentity(expected, current)) {
      throw new Error(`Backend Compiler build path changed before removal: ${path}`)
    }
    try {
      await rm(path)
      return
    } catch (error) {
      if (!retryableWindowsRemoveError(error) || attempt === REMOVE_RETRY_ATTEMPTS) throw error
      await new Promise<void>((resolveDelay) => {
        setTimeout(resolveDelay, REMOVE_RETRY_DELAY_MS)
      })
    }
  }
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.nlink === right.nlink &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function isSupportedTarget(value: string): value is BackendCompilerSidecarTargetTriple {
  return Object.hasOwn(BACKEND_COMPILER_SIDECAR_TARGETS, value)
}

export function parseBackendCompilerSidecarTarget(
  value: string
): BackendCompilerSidecarTargetTriple {
  if (!isSupportedTarget(value)) {
    throw new Error(
      `Unsupported Backend Compiler sidecar target ${JSON.stringify(value)}. Expected one of: ${Object.keys(BACKEND_COMPILER_SIDECAR_TARGETS).join(', ')}`
    )
  }
  return value
}

export function backendCompilerSidecarTargetFromTauriEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env
): BackendCompilerSidecarTargetTriple | null {
  const platform = environment.TAURI_ENV_PLATFORM
  const architecture = environment.TAURI_ENV_ARCH
  if (!platform && !architecture) return null
  let candidate = ''
  if (platform === 'darwin') candidate = `${architecture}-apple-darwin`
  else if (platform === 'windows') candidate = `${architecture}-pc-windows-msvc`
  else if (platform === 'linux') candidate = `${architecture}-unknown-linux-gnu`
  return parseBackendCompilerSidecarTarget(candidate)
}

export function backendCompilerSidecarTargetFromHost(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): BackendCompilerSidecarTargetTriple {
  const key = `${platform}:${architecture}`
  const targets: Readonly<Partial<Record<string, BackendCompilerSidecarTargetTriple>>> =
    Object.freeze({
      'darwin:arm64': 'aarch64-apple-darwin',
      'darwin:x64': 'x86_64-apple-darwin',
      'win32:x64': 'x86_64-pc-windows-msvc',
      'win32:arm64': 'aarch64-pc-windows-msvc',
      'linux:x64': 'x86_64-unknown-linux-gnu'
    })
  const target = targets[key]
  if (!target) throw new Error(`Unsupported Backend Compiler sidecar host ${key}`)
  return target
}

export function backendCompilerSidecarNativeRuntimeMatchesTarget(
  target: BackendCompilerSidecarTargetTriple,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): boolean {
  try {
    return backendCompilerSidecarTargetFromHost(platform, architecture) === target
  } catch {
    return false
  }
}

export function backendCompilerSidecarBinaryName(
  target: BackendCompilerSidecarTargetTriple
): string {
  return `${BACKEND_COMPILER_SIDECAR_NAME}-${target}${BACKEND_COMPILER_SIDECAR_TARGETS[target].extension}`
}

export function backendCompilerSidecarOutputPath(
  target: BackendCompilerSidecarTargetTriple,
  outputDirectory = DEFAULT_BACKEND_COMPILER_SIDECAR_OUTPUT_DIRECTORY
): string {
  return join(outputDirectory, backendCompilerSidecarBinaryName(target))
}

export function backendCompilerSidecarCandidateManifestPath(binaryPath: string): string {
  return `${binaryPath}.candidate-provenance-v1.json`
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function headerStartsWith(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

function elfHeaderMatches(bytes: Uint8Array): boolean {
  return headerStartsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) && readUint16LE(bytes, 18) === 0x3e
}

function peHeaderMatches(bytes: Uint8Array, target: BackendCompilerSidecarTargetTriple): boolean {
  if (!headerStartsWith(bytes, [0x4d, 0x5a])) return false
  const peOffset = readUint32LE(bytes, 0x3c)
  if (peOffset < 0x40 || peOffset + 6 > bytes.byteLength) return false
  if (!headerStartsWith(bytes, [0x50, 0x45, 0, 0], peOffset)) return false
  const machine = readUint16LE(bytes, peOffset + 4)
  return target === 'aarch64-pc-windows-msvc' ? machine === 0xaa64 : machine === 0x8664
}

function machHeaderMatches(bytes: Uint8Array, target: BackendCompilerSidecarTargetTriple): boolean {
  if (!headerStartsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])) return false
  const cpuType = readUint32LE(bytes, 4)
  return target === 'aarch64-apple-darwin' ? cpuType === 0x0100000c : cpuType === 0x01000007
}

export function backendCompilerSidecarBinaryHeaderMatchesTarget(
  bytes: Uint8Array,
  target: BackendCompilerSidecarTargetTriple
): boolean {
  if (bytes.byteLength < 64) return false
  const format: BackendCompilerSidecarFormat = BACKEND_COMPILER_SIDECAR_TARGETS[target].format
  if (format === 'elf') return elfHeaderMatches(bytes)
  if (format === 'pe') return peHeaderMatches(bytes, target)
  return machHeaderMatches(bytes, target)
}

export async function inspectCandidateBinary(
  target: BackendCompilerSidecarTargetTriple,
  path: string
): Promise<CandidateBinaryFacts> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Backend Compiler sidecar must be a regular non-symlink file: ${path}`)
  }
  if (metadata.size < MIN_BINARY_BYTES || metadata.size > MAX_BINARY_BYTES) {
    throw new Error(
      `Backend Compiler sidecar has an invalid byte length (${metadata.size}): ${path}`
    )
  }
  const file = await open(path, 'r')
  try {
    const opened = await file.stat()
    if (!sameFileIdentity(metadata, opened) || opened.nlink !== 1) {
      throw new Error(`Backend Compiler sidecar changed while it was opened: ${path}`)
    }
    const header = new Uint8Array(4096)
    const chunk = new Uint8Array(64 * 1024)
    const hash = createHash('sha256')
    let position = 0
    while (position <= metadata.size) {
      const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, position)
      if (bytesRead === 0) break
      if (position === 0) header.set(chunk.subarray(0, Math.min(bytesRead, header.byteLength)))
      hash.update(chunk.subarray(0, bytesRead))
      position += bytesRead
      if (position > metadata.size) {
        throw new Error(`Backend Compiler sidecar changed while it was read: ${path}`)
      }
    }
    const after = await file.stat()
    if (position !== metadata.size || !sameFileIdentity(opened, after)) {
      throw new Error(`Backend Compiler sidecar changed while it was read: ${path}`)
    }
    if (!backendCompilerSidecarBinaryHeaderMatchesTarget(header, target)) {
      throw new Error(
        `Backend Compiler sidecar does not match the ${target} executable format: ${path}`
      )
    }
    if (
      BACKEND_COMPILER_SIDECAR_TARGETS[target].extension === '' &&
      (metadata.mode & 0o111) === 0
    ) {
      throw new Error(`Backend Compiler sidecar is not executable: ${path}`)
    }
    return Object.freeze({ byteLength: position, sha256: hash.digest('base64url') })
  } finally {
    await file.close()
  }
}

export async function readBoundedRegularBuildFile(
  path: string,
  maximumBytes: number,
  label: string
): Promise<Uint8Array> {
  const before = await lstat(path)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 0 ||
    before.size > maximumBytes
  ) {
    throw new Error(`${label} file is invalid: ${path}`)
  }
  const file = await open(path, 'r')
  try {
    const opened = await file.stat()
    if (!sameFileIdentity(before, opened) || opened.nlink !== 1) {
      throw new Error(`${label} changed while it was opened: ${path}`)
    }
    const bytes = new Uint8Array(opened.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await file.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const after = await file.stat()
    if (offset !== bytes.byteLength || !sameFileIdentity(opened, after)) {
      throw new Error(`${label} changed while it was read: ${path}`)
    }
    return bytes
  } finally {
    await file.close()
  }
}

export async function removeRegularBuildFile(path: string): Promise<void> {
  let metadata: Stats
  try {
    metadata = await lstat(path)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return
    throw error
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing to replace a non-regular Backend Compiler build path: ${path}`)
  }
  await removeMatchingRegularFile(path, metadata)
}

export async function syncRegularFile(path: string): Promise<void> {
  // Windows requires a write-capable handle for FlushFileBuffers; the candidate files are still
  // private build outputs here and become read/execute-only snapshots only in the smoke/Host path.
  const file = await open(path, 'r+')
  try {
    await file.sync()
  } finally {
    await file.close()
  }
}

export function candidateDirectoryDurability(
  platform: NodeJS.Platform = process.platform
): CandidateDirectoryDurabilityV1 {
  return platform === 'win32' ? 'manifest-digest-fail-closed' : 'directory-fsync'
}

export async function syncDirectory(path: string): Promise<CandidateDirectoryDurabilityV1> {
  const durability = candidateDirectoryDurability()
  // Node/Bun do not expose a portable Windows directory FlushFileBuffers primitive. The exact
  // manifest-last digest protocol remains fail-closed there, but does not claim crash durability.
  if (durability !== 'directory-fsync') return durability
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
  return durability
}

export async function removeCandidateStagingDirectory(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing to remove an invalid Backend Compiler staging directory: ${path}`)
  }
  await rm(path, { maxRetries: 3, recursive: true, retryDelay: 50 })
}

export async function acquireCandidateBuildLock(
  target: BackendCompilerSidecarTargetTriple,
  outputDirectory: string
): Promise<CandidateBuildLock> {
  const path = join(
    outputDirectory,
    `.${backendCompilerSidecarBinaryName(target)}.candidate-build-v1.lock`
  )
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'wx', 0o600)
  } catch (error) {
    if (isErrno(error, 'EEXIST')) {
      throw new Error(
        `Backend Compiler sidecar candidate build is locked for ${target}; a stale lock must be reviewed and removed explicitly: ${path}`
      )
    }
    throw error
  }
  try {
    await handle.writeFile(
      `${JSON.stringify({ format: 'openpencil.backend-compiler-sidecar-candidate-build-lock.v1', pid: process.pid, target, version: 1 })}\n`,
      'utf8'
    )
    await handle.sync()
    await syncDirectory(outputDirectory)
    return Object.freeze({ handle, path })
  } catch (error) {
    const opened = await handle.stat().catch(() => undefined)
    await handle.close().catch(() => undefined)
    if (opened) await removeMatchingRegularFile(path, opened).catch(() => undefined)
    throw error
  }
}

export async function releaseCandidateBuildLock(
  lock: CandidateBuildLock,
  outputDirectory: string
): Promise<void> {
  const opened = await lock.handle.stat()
  let linked: Stats
  try {
    linked = await lstat(lock.path)
  } finally {
    await lock.handle.close()
  }
  if (!sameFileIdentity(opened, linked)) {
    throw new Error('Backend Compiler sidecar candidate build lock changed before release')
  }
  await removeMatchingRegularFile(lock.path, opened)
  await syncDirectory(outputDirectory)
}

export function assertCanonicalCandidateBinaryName(
  target: BackendCompilerSidecarTargetTriple,
  binaryPath: string
): void {
  if (basename(binaryPath) !== backendCompilerSidecarBinaryName(target)) {
    throw new Error('Backend Compiler sidecar candidate binary name is not canonical')
  }
}
