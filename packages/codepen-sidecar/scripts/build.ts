import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const CODEPEN_SIDECAR_NAME = 'openpencil-codepen-sidecar'

export const CODEPEN_SIDECAR_TARGETS = Object.freeze({
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

export type CodePenSidecarTargetTriple = keyof typeof CODEPEN_SIDECAR_TARGETS
type CodePenSidecarFormat = (typeof CODEPEN_SIDECAR_TARGETS)[CodePenSidecarTargetTriple]['format']

const MIN_BINARY_BYTES = 1_000_000
const MAX_BINARY_BYTES = 256 * 1024 * 1024
const PACKAGE_ROOT = resolve(import.meta.dir, '..')
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '../..')
const ENTRY_PATH = join(PACKAGE_ROOT, 'src/index.ts')
const DEFAULT_OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, 'desktop/binaries')

function isSupportedTarget(value: string): value is CodePenSidecarTargetTriple {
  return Object.hasOwn(CODEPEN_SIDECAR_TARGETS, value)
}

export function parseCodePenSidecarTarget(value: string): CodePenSidecarTargetTriple {
  if (!isSupportedTarget(value)) {
    throw new Error(
      `Unsupported CodePen sidecar target ${JSON.stringify(value)}. Expected one of: ${Object.keys(CODEPEN_SIDECAR_TARGETS).join(', ')}`
    )
  }
  return value
}

export function codePenSidecarTargetFromTauriEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env
): CodePenSidecarTargetTriple | null {
  const platform = environment.TAURI_ENV_PLATFORM
  const arch = environment.TAURI_ENV_ARCH
  if (!platform && !arch) return null
  let candidate = ''
  if (platform === 'darwin') candidate = `${arch}-apple-darwin`
  else if (platform === 'windows') candidate = `${arch}-pc-windows-msvc`
  else if (platform === 'linux') candidate = `${arch}-unknown-linux-gnu`
  return parseCodePenSidecarTarget(candidate)
}

export function codePenSidecarOutputPath(
  target: CodePenSidecarTargetTriple,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY
): string {
  const { extension } = CODEPEN_SIDECAR_TARGETS[target]
  return join(outputDirectory, `${CODEPEN_SIDECAR_NAME}-${target}${extension}`)
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

export function codePenSidecarBinaryHeaderMatchesTarget(
  bytes: Uint8Array,
  target: CodePenSidecarTargetTriple
): boolean {
  if (bytes.byteLength < 64) return false
  const format: CodePenSidecarFormat = CODEPEN_SIDECAR_TARGETS[target].format
  if (format === 'elf') return elfHeaderMatches(bytes)
  if (format === 'pe') return peHeaderMatches(bytes, target)
  return machHeaderMatches(bytes, target)
}

function headerStartsWith(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

function elfHeaderMatches(bytes: Uint8Array): boolean {
  return headerStartsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) && readUint16LE(bytes, 18) === 0x3e
}

function peHeaderMatches(bytes: Uint8Array, target: CodePenSidecarTargetTriple): boolean {
  if (!headerStartsWith(bytes, [0x4d, 0x5a])) return false
  const peOffset = readUint32LE(bytes, 0x3c)
  if (peOffset < 0x40 || peOffset + 6 > bytes.byteLength) return false
  if (!headerStartsWith(bytes, [0x50, 0x45, 0, 0], peOffset)) return false
  const machine = readUint16LE(bytes, peOffset + 4)
  return target === 'aarch64-pc-windows-msvc' ? machine === 0xaa64 : machine === 0x8664
}

function machHeaderMatches(bytes: Uint8Array, target: CodePenSidecarTargetTriple): boolean {
  if (!headerStartsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])) return false
  const cpuType = readUint32LE(bytes, 4)
  return target === 'aarch64-apple-darwin' ? cpuType === 0x0100000c : cpuType === 0x01000007
}

export async function verifyCodePenSidecarBinary(
  target: CodePenSidecarTargetTriple,
  path = codePenSidecarOutputPath(target)
): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`CodePen sidecar must be a regular non-symlink file: ${path}`)
  }
  if (metadata.size < MIN_BINARY_BYTES || metadata.size > MAX_BINARY_BYTES) {
    throw new Error(`CodePen sidecar has an invalid byte length (${metadata.size}): ${path}`)
  }
  const header = new Uint8Array(4096)
  const file = await open(path, 'r')
  let bytesRead = 0
  try {
    ;({ bytesRead } = await file.read(header, 0, header.byteLength, 0))
  } finally {
    await file.close()
  }
  if (!codePenSidecarBinaryHeaderMatchesTarget(header.subarray(0, bytesRead), target)) {
    throw new Error(`CodePen sidecar does not match the ${target} executable format: ${path}`)
  }
  if (CODEPEN_SIDECAR_TARGETS[target].extension === '' && (metadata.mode & 0o111) === 0) {
    throw new Error(`CodePen sidecar is not executable: ${path}`)
  }
}

interface BuildOptions {
  target: CodePenSidecarTargetTriple
  verifyOnly: boolean
}

export function parseCodePenSidecarBuildArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env
): BuildOptions {
  let target: CodePenSidecarTargetTriple | null = null
  const prebuilt = environment.OPENPENCIL_CODEPEN_SIDECAR_PREBUILT
  if (prebuilt !== undefined && prebuilt !== '0' && prebuilt !== '1') {
    throw new Error('OPENPENCIL_CODEPEN_SIDECAR_PREBUILT must be 0 or 1')
  }
  let verifyOnly = prebuilt === '1'
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--verify-only') {
      if (verifyOnly && prebuilt !== '1') throw new Error('Duplicate --verify-only option')
      verifyOnly = true
      continue
    }
    if (argument === '--target') {
      if (target || index + 1 >= args.length) throw new Error('Invalid --target option')
      target = parseCodePenSidecarTarget(args[++index])
      continue
    }
    if (argument.startsWith('--target=')) {
      if (target) throw new Error('Duplicate --target option')
      target = parseCodePenSidecarTarget(argument.slice('--target='.length))
      continue
    }
    throw new Error(`Unknown CodePen sidecar build option: ${argument}`)
  }
  target ??= codePenSidecarTargetFromTauriEnvironment(environment)
  if (!target) {
    throw new Error(
      'CodePen sidecar target is required outside a Tauri build hook; pass --target <triple>.'
    )
  }
  return { target, verifyOnly }
}

async function buildCodePenSidecar(target: CodePenSidecarTargetTriple): Promise<void> {
  const destination = codePenSidecarOutputPath(target)
  const { extension } = CODEPEN_SIDECAR_TARGETS[target]
  const base = extension ? destination.slice(0, -extension.length) : destination
  const temporary = `${base}.building-${process.pid}${extension}`
  await mkdir(dirname(destination), { recursive: true })
  await rm(temporary, { force: true })
  try {
    const command = codePenSidecarBuildCommand(target, temporary)
    const processResult = Bun.spawn(command, {
      cwd: REPOSITORY_ROOT,
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' }
    })
    const exitCode = await processResult.exited
    if (exitCode !== 0) {
      throw new Error(`CodePen sidecar compiler exited with status ${exitCode}`)
    }
    if (extension === '') await chmod(temporary, 0o755)
    await verifyCodePenSidecarBinary(target, temporary)
    await rm(destination, { force: true })
    await rename(temporary, destination)
    await verifyCodePenSidecarBinary(target, destination)
    process.stdout.write(`Prepared ${destination}\n`)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export function codePenSidecarBuildCommand(
  target: CodePenSidecarTargetTriple,
  outputPath: string
): string[] {
  const command = [
    process.execPath,
    'build',
    '--compile',
    `--target=${CODEPEN_SIDECAR_TARGETS[target].bunTarget}`,
    '--no-compile-autoload-dotenv',
    '--no-compile-autoload-bunfig',
    '--no-compile-autoload-tsconfig',
    '--no-compile-autoload-package-json',
    '--minify',
    ENTRY_PATH,
    `--outfile=${outputPath}`
  ]
  if (target.includes('windows')) command.push('--windows-hide-console')
  return command
}

async function main(): Promise<void> {
  const { target, verifyOnly } = parseCodePenSidecarBuildArgs(Bun.argv.slice(2))
  if (verifyOnly) {
    await verifyCodePenSidecarBinary(target)
    process.stdout.write(`Verified ${codePenSidecarOutputPath(target)}\n`)
    return
  }
  await buildCodePenSidecar(target)
}

if (import.meta.main) {
  await main()
}
