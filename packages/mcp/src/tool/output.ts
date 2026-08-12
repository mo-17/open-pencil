import { lstat, mkdir, mkdtemp, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, basename, isAbsolute, join, parse, resolve, sep as osSep } from 'node:path'

import { decodeBase64 } from '@open-pencil/core/bytes'
import { MotionExportCancelledError } from '@open-pencil/core/io/motion-export'

import { publishDirectoryNoClobber, publishFileNoClobber } from '#mcp/motion-export/no-clobber'
import { ok } from '#mcp/result'
import type { MCPResult } from '#mcp/result'

/** Returns true for filesystem errors that indicate a missing or unresolvable path (ENOENT, ENOTDIR, ELOOP). */
function isMissingPathError(e: unknown): boolean {
  const code =
    typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
}

/**
 * Resolve a file path and verify it stays within the allowed root directory.
 * Uses fs.realpath to resolve symlinks for the security check, preventing
 * traversal attacks where a symlink inside root points outside root.
 * Returns the resolved (normalized) path for display and file operations.
 */

/** Walk up from `p` until we find a path that realpath() can resolve. */
async function resolveRealAncestor(
  p: string
): Promise<{ realAncestor: string; remainder: string }> {
  let current = resolve(p)
  let remainder = ''
  let iterations = 0
  do {
    try {
      const real = await realpath(current)
      return { realAncestor: real, remainder }
    } catch (e) {
      if (!isMissingPathError(e)) throw e
      const parent = dirname(current)
      if (parent === current) return { realAncestor: current, remainder }
      remainder = osSep + basename(current) + remainder
      current = parent
    }
    iterations++
  } while (iterations < 64) // depth limit to prevent infinite loops
  // Fail closed: if we exceeded the depth limit, the path may contain
  // unresolved symlink components (e.g., circular symlinks). Returning a
  // partially-resolved path would allow it to pass containment checks
  // even though the fully-resolved path could be outside root.
  throw new Error(`Path resolution depth limit exceeded (possible circular symlinks): ${p}`)
}

/**
 * Walks the non-existent path segments (remainder) from the real ancestor and
 * rejects any that are symlinks. A symlink in a non-existent path segment
 * could point outside the allowed root — when the file is eventually written,
 * the OS follows the symlink chain and the write lands outside root.
 */
async function assertNoSymlinksInRemainder(realAncestor: string, remainder: string): Promise<void> {
  if (!remainder) return
  const segments = remainder.split(osSep).filter(Boolean)
  let current = realAncestor
  for (const seg of segments) {
    current = join(current, seg)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) {
        throw new Error(`Path is outside the allowed root: symlink at ${current}`)
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('outside the allowed root')) throw e
      if (!isMissingPathError(e)) throw e
      // lstat failed — the component doesn't exist at all, which is expected
      // since we're creating a new file. No symlink to worry about.
    }
  }
}

/** Throw if `rootPath` is trivially broad (e.g. "/" or "C:\"). */
function assertNarrowRoot(rootPath: string, original: string): void {
  const normalized = resolve(rootPath)
  const parsedRoot = parse(normalized).root
  if (normalized === '/' || normalized === osSep || normalized === parsedRoot) {
    throw new Error(
      `Root path is too broad: "${original}" (resolved to "${normalized}"). ` +
        'Specify a narrower OPENPENCIL_MCP_ROOT directory.'
    )
  }
}

/** Resolve `p` to its realpath-validated canonical form, handling non-existent paths. */
async function resolveRealPath(p: string): Promise<string> {
  try {
    return await realpath(p)
  } catch (e) {
    if (!isMissingPathError(e)) throw e
    const parentDir = dirname(p)
    const baseName = basename(p)
    try {
      const realParent = await realpath(parentDir)
      return join(realParent, baseName)
    } catch (e) {
      if (!isMissingPathError(e)) throw e
      const { realAncestor, remainder } = await resolveRealAncestor(parentDir)
      await assertNoSymlinksInRemainder(realAncestor, remainder)
      return join(realAncestor, remainder.slice(osSep.length), baseName)
    }
  }
}

export interface SafePathResult {
  /** The user-provided normalized path (for display/error messages). */
  resolved: string
  /** The canonical realpath-validated path (for filesystem operations). */
  realPath: string
}

const MAX_SYMLINK_DEPTH = 16

/**
 * Resolve a dangling symlink's target. When realpath fails on a symlink,
 * read the link target and recursively validate it is inside root.
 * Returns the canonical realPath of the target, or undefined if `resolved`
 * is not a symlink.
 */
async function resolveDanglingSymlink(
  resolved: string,
  root: string,
  realRoot: string,
  symlinkDepth: number
): Promise<string | undefined> {
  try {
    const stat = await lstat(resolved)
    if (!stat.isSymbolicLink()) return undefined
    // Dangling symlink — realpath already failed, which means the
    // target doesn't exist. Read the symlink target and validate it
    // is inside root. Absolute-path targets pointing outside root are
    // rejected. Relative targets are resolved relative to the symlink
    // directory and checked against root.
    const linkTarget = await readlink(resolved)
    const linkDir = dirname(resolved)
    const resolvedTarget = isAbsolute(linkTarget) ? linkTarget : resolve(linkDir, linkTarget)
    // Recursively validate the target (handles nested symlinks).
    // Pass the already-canonical realRoot so the recursive call skips
    // redundant assertNarrowRoot + realpath(root) work.
    const targetResult = await resolveSafePathInternal(
      resolvedTarget,
      root,
      symlinkDepth + 1,
      realRoot
    )
    return targetResult.realPath
  } catch (e) {
    if (e instanceof Error) {
      // Re-throw security, root-scope, and depth-limit errors — these must
      // not be swallowed. They indicate genuine validation failures, not
      // the expected "path doesn't exist" case.
      if (
        e.message.includes('outside the allowed root') ||
        e.message.includes('Root path is too broad') ||
        e.message.includes('depth limit exceeded')
      )
        throw e
    }
    if (!isMissingPathError(e)) throw e
    // lstat failed (file doesn't exist at all) — not a symlink
    return undefined
  }
}

async function resolveSafePathInternal(
  filePath: string,
  root: string,
  symlinkDepth: number,
  realRoot?: string
): Promise<SafePathResult> {
  if (symlinkDepth >= MAX_SYMLINK_DEPTH) {
    throw new Error(
      `Symlink resolution depth limit exceeded (possible circular symlinks): ${filePath}`
    )
  }

  const normalizedRoot = resolve(root)
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(normalizedRoot, filePath)

  if (!realRoot) {
    assertNarrowRoot(root, root)

    try {
      realRoot = await realpath(root)
    } catch (e) {
      if (!isMissingPathError(e)) throw e
      const { realAncestor, remainder } = await resolveRealAncestor(root)
      realRoot = remainder ? join(realAncestor, remainder.slice(osSep.length)) : realAncestor
    }

    assertNarrowRoot(realRoot, root)
  }

  const realSep = realRoot.endsWith('/') || realRoot.endsWith('\\') ? '' : osSep

  let realPath: string
  try {
    realPath = await realpath(resolved)
  } catch (e) {
    if (!isMissingPathError(e)) throw e
    const symlinkRealPath = await resolveDanglingSymlink(resolved, root, realRoot, symlinkDepth)
    realPath = symlinkRealPath ?? (await resolveRealPath(resolved))
  }

  if (!realPath.startsWith(realRoot + realSep) && realPath !== realRoot) {
    throw new Error(`Path is outside the allowed root: ${root}`)
  }
  return { resolved, realPath }
}

export async function resolveSafePath(filePath: string, root: string): Promise<SafePathResult> {
  return resolveSafePathInternal(filePath, root, 0)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MotionExportCancelledError()
}

interface MotionSequenceFrameOutput {
  file: string
  base64: string
  byteLength?: number
}

interface MotionSequenceFrameCandidate {
  file?: unknown
  base64?: unknown
  byteLength?: unknown
}

function motionSequenceFrames(value: unknown): MotionSequenceFrameOutput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3_600) return null
  const frames: MotionSequenceFrameOutput[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const frame = candidate as MotionSequenceFrameCandidate
    if (
      typeof frame.file !== 'string' ||
      !/^frame-\d{4,}\.png$/.test(frame.file) ||
      seen.has(frame.file) ||
      typeof frame.base64 !== 'string'
    ) {
      return null
    }
    seen.add(frame.file)
    frames.push({
      file: frame.file,
      base64: frame.base64,
      ...(typeof frame.byteLength === 'number' ? { byteLength: frame.byteLength } : {})
    })
  }
  return frames
}

async function writeMotionPNGSequence(
  result: Record<string, unknown>,
  resolved: string,
  realPath: string,
  root: string,
  signal?: AbortSignal
): Promise<MCPResult | null> {
  if (result.format !== 'png-sequence') return null
  const frames = motionSequenceFrames(result.frames)
  if (
    !frames ||
    !result.manifest ||
    typeof result.manifest !== 'object' ||
    Array.isArray(result.manifest)
  ) {
    throw new Error('Motion PNG sequence result is malformed')
  }
  if (await pathExists(realPath)) {
    throw new Error(`Motion export output already exists: ${resolved}`)
  }

  const parentDir = dirname(realPath)
  await mkdir(parentDir, { recursive: true })
  await resolveSafePath(parentDir, root)
  const temporaryDir = await mkdtemp(join(parentDir, `.${basename(realPath)}.tmp-`))
  let moved = false
  try {
    let byteLength = 0
    for (const frame of frames) {
      throwIfCancelled(signal)
      const buffer = Buffer.from(frame.base64, 'base64')
      if (
        buffer.length < 8 ||
        !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ) {
        throw new Error(`Motion export frame is not valid PNG data: ${frame.file}`)
      }
      if (frame.byteLength !== undefined && frame.byteLength !== buffer.length) {
        throw new Error(`Motion export frame length mismatch: ${frame.file}`)
      }
      await writeFile(join(temporaryDir, frame.file), buffer)
      byteLength += buffer.length
    }
    throwIfCancelled(signal)
    const manifestText = `${JSON.stringify(result.manifest, null, 2)}\n`
    await writeFile(join(temporaryDir, 'manifest.json'), manifestText, 'utf8')
    byteLength += Buffer.byteLength(manifestText, 'utf8')
    await resolveSafePath(temporaryDir, root)
    throwIfCancelled(signal)
    await publishDirectoryNoClobber(temporaryDir, realPath)
    moved = true
    await resolveSafePath(realPath, root)
    return ok({
      written: resolved,
      format: 'png-sequence',
      frameCount: frames.length,
      byteLength
    })
  } finally {
    if (!moved) await rm(temporaryDir, { recursive: true, force: true })
  }
}

function hasEncodedMotionSignature(format: unknown, buffer: Buffer): boolean {
  if (format === 'gif') return buffer.subarray(0, 4).toString('ascii') === 'GIF8'
  if (format === 'webm') {
    return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  }
  if (format === 'mp4')
    return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  return false
}

async function writeEncodedMotionAtomic(
  result: Record<string, unknown>,
  resolved: string,
  realPath: string,
  root: string,
  signal?: AbortSignal
): Promise<MCPResult | null> {
  if (typeof result.base64 !== 'string') return null
  const buffer = Buffer.from(result.base64, 'base64')
  if (!hasEncodedMotionSignature(result.format, buffer)) {
    throw new Error(`Motion ${String(result.format)} output has an invalid file signature`)
  }
  if (await pathExists(realPath))
    throw new Error(`Motion export output already exists: ${resolved}`)

  const parentDir = dirname(realPath)
  await mkdir(parentDir, { recursive: true })
  await resolveSafePath(parentDir, root)
  const temporaryDir = await mkdtemp(join(parentDir, `.${basename(realPath)}.tmp-`))
  const temporaryFile = join(temporaryDir, basename(realPath))
  try {
    throwIfCancelled(signal)
    await writeFile(temporaryFile, buffer)
    await resolveSafePath(temporaryFile, root)
    throwIfCancelled(signal)
    await publishFileNoClobber(temporaryFile, realPath)
    await resolveSafePath(realPath, root)
    return ok({
      written: resolved,
      format: result.format,
      byteLength: buffer.length,
      encoder: result.encoder
    })
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
  }
}

export async function writeToolOutput(
  toolName: string,
  result: Record<string, unknown>,
  filePath: string,
  root: string,
  signal?: AbortSignal
): Promise<MCPResult | null> {
  if (toolName === 'export_motion_animation') throwIfCancelled(signal)
  const { resolved, realPath } = await resolveSafePath(filePath, root)
  // Use the canonical realPath for filesystem operations to prevent TOCTOU:
  // an attacker could swap a directory component with a symlink between
  // resolveSafePath's validation and the writeFile call. Writing to the
  // realpath-validated path ensures the write lands inside root.
  const parentDir = dirname(realPath)
  await mkdir(parentDir, { recursive: true })
  // TOCTOU mitigation: re-verify the parent directory still resolves inside
  // the root after mkdir. An attacker who replaces an ancestor directory
  // with a symlink between resolveSafePath and the write would be detected
  // here — realpath follows the ancestor symlink and resolves outside root.
  await resolveSafePath(parentDir, root)
  if (toolName === 'export_motion_animation') {
    const sequence = await writeMotionPNGSequence(result, resolved, realPath, root, signal)
    if (sequence) return sequence
    const encoded = await writeEncodedMotionAtomic(result, resolved, realPath, root, signal)
    if (encoded) return encoded
  }
  if (toolName === 'export_svg' && typeof result.svg === 'string') {
    await writeFile(realPath, result.svg, 'utf8')
    await resolveSafePath(realPath, root)
    return ok({ written: resolved, byteLength: Buffer.byteLength(result.svg, 'utf8') })
  }
  if (toolName === 'export_image' && typeof result.base64 === 'string') {
    const bytes = decodeBase64(result.base64)
    await writeFile(realPath, bytes)
    await resolveSafePath(realPath, root)
    return ok({ written: resolved, byteLength: bytes.length })
  }
  if (toolName === 'get_jsx' && typeof result.jsx === 'string') {
    await writeFile(realPath, result.jsx, 'utf8')
    await resolveSafePath(realPath, root)
    return ok({ written: resolved, byteLength: Buffer.byteLength(result.jsx, 'utf8') })
  }
  return null
}
