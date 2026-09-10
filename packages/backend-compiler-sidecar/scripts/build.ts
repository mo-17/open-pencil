import { chmod, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION } from '../src/protocol'
import {
  BACKEND_COMPILER_SIDECAR_TARGETS,
  DEFAULT_BACKEND_COMPILER_SIDECAR_OUTPUT_DIRECTORY,
  MAX_BINARY_BYTES,
  MIN_BINARY_BYTES,
  acquireCandidateBuildLock,
  assertCanonicalCandidateBinaryName,
  backendCompilerSidecarBinaryName,
  backendCompilerSidecarCandidateManifestPath,
  backendCompilerSidecarNativeRuntimeMatchesTarget,
  backendCompilerSidecarOutputPath,
  backendCompilerSidecarTargetFromTauriEnvironment,
  inspectCandidateBinary,
  parseBackendCompilerSidecarTarget,
  readBoundedRegularBuildFile,
  releaseCandidateBuildLock,
  removeCandidateStagingDirectory,
  removeRegularBuildFile,
  syncDirectory,
  syncRegularFile,
  type BackendCompilerSidecarTargetTriple,
  type CandidateBinaryFacts
} from './candidate-files'

export * from './candidate-files'
export { BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION } from '../src/protocol'

export const BACKEND_COMPILER_SIDECAR_CANDIDATE_FORMAT =
  'openpencil.backend-compiler-sidecar-candidate-provenance.v1'

export interface BackendCompilerSidecarCandidateProvenanceV1 {
  readonly byteLength: number
  readonly binaryName: string
  readonly executionAuthorityCreated: false
  readonly format: typeof BACKEND_COMPILER_SIDECAR_CANDIDATE_FORMAT
  readonly protocolVersion: typeof BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION
  readonly registryIssuerAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly sha256: string
  readonly target: BackendCompilerSidecarTargetTriple
  readonly version: 1
}

const MAX_MANIFEST_BYTES = 4 * 1024
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/
const PACKAGE_ROOT = resolve(import.meta.dir, '..')
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '../..')
const ENTRY_PATH = join(PACKAGE_ROOT, 'src/index.ts')
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

interface CandidateProvenanceInputV1 {
  readonly [key: string]: unknown
  readonly byteLength?: unknown
  readonly binaryName?: unknown
  readonly executionAuthorityCreated?: unknown
  readonly format?: unknown
  readonly protocolVersion?: unknown
  readonly registryIssuerAuthorityCreated?: unknown
  readonly releaseAuthorityCreated?: unknown
  readonly sha256?: unknown
  readonly target?: unknown
  readonly version?: unknown
}

function isCandidateProvenanceInput(value: unknown): value is CandidateProvenanceInputV1 {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function canonicalBackendCompilerSidecarCandidateProvenance(
  value: BackendCompilerSidecarCandidateProvenanceV1
): string {
  return JSON.stringify({
    byteLength: value.byteLength,
    binaryName: value.binaryName,
    executionAuthorityCreated: value.executionAuthorityCreated,
    format: value.format,
    protocolVersion: value.protocolVersion,
    registryIssuerAuthorityCreated: value.registryIssuerAuthorityCreated,
    releaseAuthorityCreated: value.releaseAuthorityCreated,
    sha256: value.sha256,
    target: value.target,
    version: value.version
  })
}

function candidateProvenance(
  target: BackendCompilerSidecarTargetTriple,
  binaryName: string,
  facts: CandidateBinaryFacts
): BackendCompilerSidecarCandidateProvenanceV1 {
  return Object.freeze({
    byteLength: facts.byteLength,
    binaryName,
    executionAuthorityCreated: false,
    format: BACKEND_COMPILER_SIDECAR_CANDIDATE_FORMAT,
    protocolVersion: BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION,
    registryIssuerAuthorityCreated: false,
    releaseAuthorityCreated: false,
    sha256: facts.sha256,
    target,
    version: 1
  })
}

function parseCandidateProvenance(
  value: unknown,
  target: BackendCompilerSidecarTargetTriple,
  expectedBinaryName: string
): BackendCompilerSidecarCandidateProvenanceV1 {
  if (!isCandidateProvenanceInput(value)) {
    throw new Error('Backend Compiler sidecar candidate provenance must be an object')
  }
  const source = value
  const expectedKeys = [
    'byteLength',
    'binaryName',
    'executionAuthorityCreated',
    'format',
    'protocolVersion',
    'registryIssuerAuthorityCreated',
    'releaseAuthorityCreated',
    'sha256',
    'target',
    'version'
  ]
  if (
    Object.keys(source).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(source, key)) ||
    !Number.isSafeInteger(source.byteLength) ||
    (source.byteLength as number) < MIN_BINARY_BYTES ||
    (source.byteLength as number) > MAX_BINARY_BYTES ||
    source.binaryName !== expectedBinaryName ||
    source.executionAuthorityCreated !== false ||
    source.format !== BACKEND_COMPILER_SIDECAR_CANDIDATE_FORMAT ||
    source.protocolVersion !== BACKEND_COMPILER_SIDECAR_PROTOCOL_VERSION ||
    source.registryIssuerAuthorityCreated !== false ||
    source.releaseAuthorityCreated !== false ||
    typeof source.sha256 !== 'string' ||
    !SHA256_BASE64URL.test(source.sha256) ||
    source.target !== target ||
    source.version !== 1
  ) {
    throw new Error('Backend Compiler sidecar candidate provenance is invalid')
  }
  return candidateProvenance(target, expectedBinaryName, {
    byteLength: source.byteLength as number,
    sha256: source.sha256
  })
}

async function readCandidateManifest(
  target: BackendCompilerSidecarTargetTriple,
  binaryPath: string,
  manifestPath: string
): Promise<BackendCompilerSidecarCandidateProvenanceV1> {
  if (manifestPath !== backendCompilerSidecarCandidateManifestPath(binaryPath)) {
    throw new Error('Backend Compiler sidecar candidate provenance path is not canonical')
  }
  const bytes = await readBoundedRegularBuildFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    'Backend Compiler sidecar candidate provenance'
  )
  if (
    bytes.byteLength < 2 ||
    bytes.at(-1) !== 0x0a ||
    bytes.subarray(0, -1).includes(0x0a) ||
    bytes.includes(0x0d)
  ) {
    throw new Error('Backend Compiler sidecar candidate provenance must be one LF-terminated line')
  }
  let text: string
  try {
    text = UTF8_DECODER.decode(bytes.subarray(0, -1))
  } catch {
    throw new Error('Backend Compiler sidecar candidate provenance is not valid UTF-8')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Backend Compiler sidecar candidate provenance is not valid JSON')
  }
  const parsed = parseCandidateProvenance(raw, target, basename(binaryPath))
  if (text !== canonicalBackendCompilerSidecarCandidateProvenance(parsed)) {
    throw new Error('Backend Compiler sidecar candidate provenance is not canonical')
  }
  return parsed
}

export async function writeBackendCompilerSidecarCandidateProvenance(
  target: BackendCompilerSidecarTargetTriple,
  binaryPath: string,
  manifestPath = backendCompilerSidecarCandidateManifestPath(binaryPath)
): Promise<BackendCompilerSidecarCandidateProvenanceV1> {
  assertCanonicalCandidateBinaryName(target, binaryPath)
  if (manifestPath !== backendCompilerSidecarCandidateManifestPath(binaryPath)) {
    throw new Error('Backend Compiler sidecar candidate provenance path is not canonical')
  }
  const facts = await inspectCandidateBinary(target, binaryPath)
  const manifest = candidateProvenance(target, basename(binaryPath), facts)
  await writeFile(
    manifestPath,
    `${canonicalBackendCompilerSidecarCandidateProvenance(manifest)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  )
  await syncRegularFile(manifestPath)
  await syncDirectory(dirname(manifestPath))
  return manifest
}

export async function verifyBackendCompilerSidecarCandidate(
  target: BackendCompilerSidecarTargetTriple,
  binaryPath = backendCompilerSidecarOutputPath(target),
  manifestPath = backendCompilerSidecarCandidateManifestPath(binaryPath)
): Promise<BackendCompilerSidecarCandidateProvenanceV1> {
  assertCanonicalCandidateBinaryName(target, binaryPath)
  const manifest = await readCandidateManifest(target, binaryPath, manifestPath)
  return verifyBackendCompilerSidecarBytes(target, binaryPath, manifest)
}

export async function verifyBackendCompilerSidecarBytes(
  target: BackendCompilerSidecarTargetTriple,
  binaryPath: string,
  expected: BackendCompilerSidecarCandidateProvenanceV1
): Promise<BackendCompilerSidecarCandidateProvenanceV1> {
  assertCanonicalCandidateBinaryName(target, binaryPath)
  const manifest = parseCandidateProvenance(expected, target, basename(binaryPath))
  const facts = await inspectCandidateBinary(target, binaryPath)
  if (facts.byteLength !== manifest.byteLength || facts.sha256 !== manifest.sha256) {
    throw new Error('Backend Compiler sidecar candidate provenance does not match the binary')
  }
  return manifest
}

interface BackendCompilerSidecarBuildOptions {
  target: BackendCompilerSidecarTargetTriple
  verifyOnly: boolean
  nativeRuntime: boolean
}

export function parseBackendCompilerSidecarBuildArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env
): BackendCompilerSidecarBuildOptions {
  let target: BackendCompilerSidecarTargetTriple | null = null
  let verifyOnly = false
  let nativeRuntime = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--verify-only') {
      if (verifyOnly) throw new Error('Duplicate --verify-only option')
      verifyOnly = true
      continue
    }
    if (argument === '--native-runtime') {
      if (nativeRuntime) throw new Error('Duplicate --native-runtime option')
      nativeRuntime = true
      continue
    }
    if (argument === '--target') {
      if (target || index + 1 >= args.length) throw new Error('Invalid --target option')
      target = parseBackendCompilerSidecarTarget(args[++index])
      continue
    }
    if (argument.startsWith('--target=')) {
      if (target) throw new Error('Duplicate --target option')
      target = parseBackendCompilerSidecarTarget(argument.slice('--target='.length))
      continue
    }
    throw new Error(`Unknown Backend Compiler sidecar build option: ${argument}`)
  }
  target ??= backendCompilerSidecarTargetFromTauriEnvironment(environment)
  if (!target) {
    throw new Error(
      'Backend Compiler sidecar target is required outside a Tauri build hook; pass --target <triple>.'
    )
  }
  if (verifyOnly && nativeRuntime) {
    throw new Error('--native-runtime is only valid while building the Backend Compiler sidecar')
  }
  return { target, verifyOnly, nativeRuntime }
}

export function backendCompilerSidecarBuildCommand(
  target: BackendCompilerSidecarTargetTriple,
  outputPath: string,
  nativeRuntime = false
): string[] {
  const command = [
    process.execPath,
    'build',
    '--compile',
    '--no-compile-autoload-dotenv',
    '--no-compile-autoload-bunfig',
    '--no-compile-autoload-tsconfig',
    '--no-compile-autoload-package-json',
    '--minify',
    ENTRY_PATH,
    `--outfile=${outputPath}`
  ]
  if (!nativeRuntime) {
    command.splice(3, 0, `--target=${BACKEND_COMPILER_SIDECAR_TARGETS[target].bunTarget}`)
  }
  if (target.includes('windows')) command.push('--windows-hide-console')
  return command
}

export function resolveBackendCompilerSidecarOutputDirectory(
  outputDirectory: string,
  workingDirectory = process.cwd()
): string {
  return resolve(workingDirectory, outputDirectory)
}

export async function buildBackendCompilerSidecar(
  target: BackendCompilerSidecarTargetTriple,
  nativeRuntime: boolean,
  outputDirectory = DEFAULT_BACKEND_COMPILER_SIDECAR_OUTPUT_DIRECTORY
): Promise<BackendCompilerSidecarCandidateProvenanceV1> {
  if (nativeRuntime && !backendCompilerSidecarNativeRuntimeMatchesTarget(target)) {
    throw new Error(
      `Native Bun runtime does not match the ${target} Backend Compiler sidecar target`
    )
  }
  const canonicalOutputDirectory = resolveBackendCompilerSidecarOutputDirectory(outputDirectory)
  const destination = backendCompilerSidecarOutputPath(target, canonicalOutputDirectory)
  const manifestDestination = backendCompilerSidecarCandidateManifestPath(destination)
  await mkdir(dirname(destination), { recursive: true })
  const lock = await acquireCandidateBuildLock(target, canonicalOutputDirectory)
  let stagingDirectory: string | undefined
  let publicationStarted = false
  let operationFailed = false
  let operationFailure: unknown
  let result: BackendCompilerSidecarCandidateProvenanceV1 | undefined
  try {
    stagingDirectory = await mkdtemp(
      join(
        canonicalOutputDirectory,
        `.${backendCompilerSidecarBinaryName(target)}.candidate-staging-`
      )
    )
    await chmod(stagingDirectory, 0o700)
    const temporary = backendCompilerSidecarOutputPath(target, stagingDirectory)
    const temporaryManifest = backendCompilerSidecarCandidateManifestPath(temporary)
    const child = Bun.spawn(backendCompilerSidecarBuildCommand(target, temporary, nativeRuntime), {
      cwd: REPOSITORY_ROOT,
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' }
    })
    const exitCode = await child.exited
    if (exitCode !== 0) {
      throw new Error(`Backend Compiler sidecar compiler exited with status ${exitCode}`)
    }
    if (BACKEND_COMPILER_SIDECAR_TARGETS[target].extension === '') await chmod(temporary, 0o755)
    const facts = await inspectCandidateBinary(target, temporary)
    const manifest = candidateProvenance(target, basename(destination), facts)
    await writeFile(
      temporaryManifest,
      `${canonicalBackendCompilerSidecarCandidateProvenance(manifest)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    )
    await syncRegularFile(temporary)
    await syncRegularFile(temporaryManifest)
    await syncDirectory(stagingDirectory)
    await verifyBackendCompilerSidecarCandidate(target, temporary, temporaryManifest)

    // The manifest is the commit marker. Once publication starts, its absence means
    // the candidate is unavailable; a mismatched or partially replaced pair is never accepted.
    await removeRegularBuildFile(manifestDestination)
    publicationStarted = true
    await syncDirectory(canonicalOutputDirectory)
    await removeRegularBuildFile(destination)
    await rename(temporary, destination)
    await syncDirectory(canonicalOutputDirectory)
    await rename(temporaryManifest, manifestDestination)
    await syncDirectory(canonicalOutputDirectory)
    result = await verifyBackendCompilerSidecarCandidate(target, destination, manifestDestination)
  } catch (error) {
    operationFailed = true
    operationFailure = error
    if (publicationStarted) {
      // Fail closed after any interrupted publication. The next explicit build may
      // replace the orphaned regular binary, but no manifest means no candidate pin.
      try {
        await removeRegularBuildFile(manifestDestination)
        await syncDirectory(canonicalOutputDirectory)
      } catch (failClosedError) {
        operationFailure = new AggregateError(
          [error, failClosedError],
          'Backend Compiler sidecar publication failed and its commit marker could not be cleared'
        )
      }
    }
  }

  const cleanupFailures: unknown[] = []
  if (stagingDirectory) {
    try {
      await removeCandidateStagingDirectory(stagingDirectory)
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  try {
    await releaseCandidateBuildLock(lock, canonicalOutputDirectory)
  } catch (error) {
    cleanupFailures.push(error)
  }
  if (operationFailed) cleanupFailures.unshift(operationFailure)
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  if (cleanupFailures.length > 1) {
    throw new AggregateError(
      cleanupFailures,
      'Backend Compiler sidecar candidate build or cleanup did not complete'
    )
  }
  if (!result) throw new Error('Backend Compiler sidecar candidate build returned no result')
  return result
}

async function main(): Promise<void> {
  const options = parseBackendCompilerSidecarBuildArgs(Bun.argv.slice(2))
  const binaryPath = backendCompilerSidecarOutputPath(options.target)
  const manifest = options.verifyOnly
    ? await verifyBackendCompilerSidecarCandidate(options.target, binaryPath)
    : await buildBackendCompilerSidecar(options.target, options.nativeRuntime)
  process.stdout.write(
    `${options.verifyOnly ? 'Verified' : 'Prepared'} ${binaryPath} (${manifest.sha256})\n`
  )
}

if (import.meta.main) await main()
