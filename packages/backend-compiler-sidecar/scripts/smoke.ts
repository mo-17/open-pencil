import { constants } from 'node:fs'
import { chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'

import {
  BACKEND_COMPILER_SIDECAR_LIMITS,
  canonicalBackendCompilerSidecarJSON
} from '../src/protocol'
import {
  backendCompilerSidecarBinaryName,
  backendCompilerSidecarOutputPath,
  backendCompilerSidecarTargetFromHost,
  parseBackendCompilerSidecarTarget,
  verifyBackendCompilerSidecarBytes,
  verifyBackendCompilerSidecarCandidate,
  type BackendCompilerSidecarCandidateProvenanceV1,
  type BackendCompilerSidecarTargetTriple
} from './build'

const MAXIMUM_REQUEST_BYTES = BACKEND_COMPILER_SIDECAR_LIMITS.maxStdinBytes
const MAXIMUM_STDOUT_BYTES = BACKEND_COMPILER_SIDECAR_LIMITS.maxOutputBytes + 1
const MAXIMUM_STDERR_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const MAXIMUM_TIMEOUT_MS = 30_000
const HARD_KILL_WAIT_MS = 5_000
const FIXTURE_PATH = resolve(
  import.meta.dir,
  '../../../tests/fixtures/backend/supabase/backfill-compiler-sidecar-v1.json'
)
const UTF8_ENCODER = new TextEncoder()

interface BackendCompilerSidecarGoldenFixtureV1 {
  readonly fixtureFormat: 'openpencil.test.backend.supabase.backfill-compiler-sidecar.v1'
  readonly fixtureVersion: 1
  readonly request: unknown
  readonly response: unknown
}

interface BackendCompilerSidecarGoldenFixtureInputV1 {
  readonly [key: string]: unknown
  readonly fixtureFormat?: unknown
  readonly fixtureVersion?: unknown
  readonly request?: unknown
  readonly response?: unknown
}

interface BackendCompilerSidecarSmokeOptions {
  readonly target: BackendCompilerSidecarTargetTriple
  readonly binaryPath: string
  readonly timeoutMs: number
}

function isGoldenFixtureInput(value: unknown): value is BackendCompilerSidecarGoldenFixtureInputV1 {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${flag} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} is outside the safe integer range`)
  if (parsed > MAXIMUM_TIMEOUT_MS) {
    throw new Error(`${flag} must not exceed ${MAXIMUM_TIMEOUT_MS}`)
  }
  return parsed
}

export function backendCompilerSidecarSmokeEnvironment(
  snapshotDirectory: string,
  platform: NodeJS.Platform = process.platform,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Readonly<Record<string, string>> {
  const pathFlavor = platform === 'win32' ? win32 : posix
  if (!pathFlavor.isAbsolute(snapshotDirectory) || snapshotDirectory.includes('\0')) {
    throw new Error('Backend Compiler sidecar smoke directory must be an absolute path')
  }
  if (platform !== 'win32') {
    return Object.freeze({ LANG: 'C', LC_ALL: 'C', TZ: 'UTC' })
  }
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT
  if (!systemRoot || !win32.isAbsolute(systemRoot) || systemRoot.includes('\0')) {
    throw new Error('Backend Compiler sidecar smoke requires an absolute Windows SystemRoot')
  }
  return Object.freeze({ SystemRoot: systemRoot, TEMP: snapshotDirectory, TMP: snapshotDirectory })
}

export function parseBackendCompilerSidecarSmokeArgs(
  args: readonly string[]
): BackendCompilerSidecarSmokeOptions {
  let target: BackendCompilerSidecarTargetTriple | undefined
  let binaryPath: string | undefined
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let timeoutSet = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--target' && index + 1 < args.length && !target) {
      target = parseBackendCompilerSidecarTarget(args[++index])
      continue
    }
    if (argument.startsWith('--target=') && !target) {
      target = parseBackendCompilerSidecarTarget(argument.slice('--target='.length))
      continue
    }
    if (argument === '--binary' && index + 1 < args.length && !binaryPath) {
      binaryPath = resolve(args[++index])
      continue
    }
    if (argument.startsWith('--binary=') && !binaryPath) {
      binaryPath = resolve(argument.slice('--binary='.length))
      continue
    }
    if (argument === '--timeout-ms' && index + 1 < args.length && !timeoutSet) {
      timeoutMs = parsePositiveInteger(args[++index], '--timeout-ms')
      timeoutSet = true
      continue
    }
    if (argument.startsWith('--timeout-ms=') && !timeoutSet) {
      timeoutMs = parsePositiveInteger(argument.slice('--timeout-ms='.length), '--timeout-ms')
      timeoutSet = true
      continue
    }
    throw new Error(`Unknown or duplicate Backend Compiler sidecar smoke option: ${argument}`)
  }
  if (!target) throw new Error('Backend Compiler sidecar smoke requires --target <triple>')
  binaryPath ??= backendCompilerSidecarOutputPath(target)
  if (basename(binaryPath) !== backendCompilerSidecarBinaryName(target)) {
    throw new Error(
      `Backend Compiler sidecar candidate must be named ${backendCompilerSidecarBinaryName(target)}`
    )
  }
  return Object.freeze({ target, binaryPath, timeoutMs })
}

interface ActiveBoundedRead {
  readonly outcome: Promise<BoundedReadOutcome>
  readonly cancel: () => Promise<void>
}

type BoundedReadOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: unknown }

function startBoundedRead(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  label: string
): ActiveBoundedRead {
  const reader = stream.getReader()
  const reading = (async (): Promise<Uint8Array> => {
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      let chunk = await reader.read()
      while (!chunk.done) {
        total += chunk.value.byteLength
        if (total > maximumBytes) throw new Error(`${label} exceeded its byte limit`)
        chunks.push(chunk.value)
        chunk = await reader.read()
      }
    } finally {
      reader.releaseLock()
    }
    const output = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  })()
  const outcome: Promise<BoundedReadOutcome> = reading.then(
    (bytes) => Object.freeze({ ok: true as const, bytes }),
    (error: unknown) => Object.freeze({ ok: false as const, error })
  )
  return Object.freeze({
    outcome,
    cancel: async () => {
      await reader.cancel().catch(() => undefined)
    }
  })
}

function failOnBoundedRead(outcome: Promise<BoundedReadOutcome>): Promise<never> {
  return outcome.then((result) => {
    if (!result.ok) throw result.error
    return new Promise<never>(() => {
      // A successfully drained stream contributes no failure event to the sibling process race.
    })
  })
}

function failOnInput(input: Promise<void>): Promise<never> {
  return input.then(
    () =>
      new Promise<never>(() => {
        // A completed input write contributes no event to the sibling process/read failure race.
      })
  )
}

function boundedReadBytes(outcome: BoundedReadOutcome): Uint8Array {
  if (!outcome.ok) throw outcome.error
  return outcome.bytes
}

function decodeUTF8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} is not valid UTF-8`)
  }
}

async function goldenFixture(): Promise<BackendCompilerSidecarGoldenFixtureV1> {
  const bytes = await readFile(FIXTURE_PATH)
  let value: unknown
  try {
    value = JSON.parse(decodeUTF8(bytes, 'Backend Compiler sidecar golden fixture'))
  } catch {
    throw new Error('Backend Compiler sidecar golden fixture is invalid')
  }
  if (!isGoldenFixtureInput(value)) {
    throw new Error('Backend Compiler sidecar golden fixture has an invalid shape')
  }
  const source = value
  if (
    source.fixtureFormat !== 'openpencil.test.backend.supabase.backfill-compiler-sidecar.v1' ||
    source.fixtureVersion !== 1 ||
    !Object.hasOwn(source, 'request') ||
    !Object.hasOwn(source, 'response')
  ) {
    throw new Error('Backend Compiler sidecar golden fixture has an invalid shape')
  }
  return Object.freeze({
    fixtureFormat: source.fixtureFormat,
    fixtureVersion: source.fixtureVersion,
    request: source.request,
    response: source.response
  })
}

function exactResponseLine(stdout: Uint8Array): string {
  if (
    stdout.byteLength < 2 ||
    stdout.at(-1) !== 0x0a ||
    stdout.subarray(0, -1).includes(0x0a) ||
    stdout.includes(0x0d)
  ) {
    throw new Error('Backend Compiler sidecar did not write exactly one LF-terminated frame')
  }
  return decodeUTF8(stdout.subarray(0, -1), 'Backend Compiler sidecar stdout')
}

async function beforeDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  message: string
): Promise<T> {
  const remaining = deadline - performance.now()
  if (remaining <= 0) throw new Error(message)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), remaining)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ESRCH'
  )
}

function killUnixProcessGroup(child: Bun.Subprocess): void {
  if (process.platform === 'win32') return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (!isMissingProcessError(error)) throw error
  }
}

export async function hardKillBackendCompilerSidecar(child: Bun.Subprocess): Promise<void> {
  const failures: unknown[] = []
  try {
    killUnixProcessGroup(child)
  } catch (error) {
    failures.push(error)
  }
  try {
    child.kill(9)
  } catch (error) {
    if (!isMissingProcessError(error)) failures.push(error)
  }
  try {
    await beforeDeadline(
      child.exited,
      performance.now() + HARD_KILL_WAIT_MS,
      'Backend Compiler sidecar did not exit after hard kill'
    )
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Backend Compiler sidecar hard kill did not complete')
  }
}

export async function smokeBackendCompilerSidecar(
  options: BackendCompilerSidecarSmokeOptions
): Promise<BackendCompilerSidecarCandidateProvenanceV1> {
  const hostTarget = backendCompilerSidecarTargetFromHost()
  if (options.target !== hostTarget) {
    throw new Error(
      `Refusing to execute ${options.target} Backend Compiler sidecar on ${hostTarget} host`
    )
  }
  const manifest = await verifyBackendCompilerSidecarCandidate(options.target, options.binaryPath)
  const snapshotDirectory = await mkdtemp(join(tmpdir(), 'openpencil-backend-sidecar-smoke-'))
  await chmod(snapshotDirectory, 0o700)
  const snapshotPath = join(snapshotDirectory, backendCompilerSidecarBinaryName(options.target))
  let smokeFailed = false
  let smokeFailure: unknown
  try {
    await copyFile(options.binaryPath, snapshotPath, constants.COPYFILE_EXCL)
    if (process.platform !== 'win32') await chmod(snapshotPath, 0o500)
    await verifyBackendCompilerSidecarBytes(options.target, snapshotPath, manifest)
    await runVerifiedSnapshot(snapshotPath, options.timeoutMs)
  } catch (error) {
    smokeFailed = true
    smokeFailure = error
  }
  let cleanupFailed = false
  let cleanupFailure: unknown
  try {
    await rm(snapshotDirectory, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 50
    })
  } catch (error) {
    cleanupFailed = true
    cleanupFailure = error
  }
  if (smokeFailed && cleanupFailed) {
    throw new AggregateError(
      [smokeFailure, cleanupFailure],
      'Backend Compiler sidecar smoke and snapshot cleanup both failed'
    )
  }
  if (smokeFailed) throw smokeFailure
  if (cleanupFailed) throw cleanupFailure
  return manifest
}

async function runVerifiedSnapshot(snapshotPath: string, timeoutMs: number): Promise<void> {
  const fixture = await goldenFixture()
  const request = canonicalBackendCompilerSidecarJSON(fixture.request)
  const requestFrame = UTF8_ENCODER.encode(`${request}\n`)
  if (requestFrame.byteLength > MAXIMUM_REQUEST_BYTES + 1) {
    throw new Error('Backend Compiler sidecar golden request exceeds its byte limit')
  }
  const child = Bun.spawn([snapshotPath], {
    cwd: dirname(snapshotPath),
    detached: process.platform !== 'win32',
    env: backendCompilerSidecarSmokeEnvironment(dirname(snapshotPath)),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const stdout = startBoundedRead(
    child.stdout,
    MAXIMUM_STDOUT_BYTES,
    'Backend Compiler sidecar stdout'
  )
  const stderr = startBoundedRead(
    child.stderr,
    MAXIMUM_STDERR_BYTES,
    'Backend Compiler sidecar stderr'
  )
  const deadline = performance.now() + timeoutMs
  const input = (async () => {
    await child.stdin.write(requestFrame)
    await child.stdin.end()
  })()
  const exitOrReadFailure = Promise.race([
    child.exited,
    failOnInput(input),
    failOnBoundedRead(stdout.outcome),
    failOnBoundedRead(stderr.outcome)
  ])
  try {
    const exitCode = await beforeDeadline(
      exitOrReadFailure,
      deadline,
      'Backend Compiler sidecar smoke timed out'
    )
    killUnixProcessGroup(child)
    const [, stdoutOutcome, stderrOutcome] = await beforeDeadline(
      Promise.all([input, stdout.outcome, stderr.outcome]),
      deadline,
      'Backend Compiler sidecar smoke pipes did not close before the deadline'
    )
    const stdoutBytes = boundedReadBytes(stdoutOutcome)
    const stderrBytes = boundedReadBytes(stderrOutcome)
    if (exitCode !== 0) throw new Error(`Backend Compiler sidecar exited with status ${exitCode}`)
    if (stderrBytes.byteLength !== 0) throw new Error('Backend Compiler sidecar wrote to stderr')
    const response = exactResponseLine(stdoutBytes)
    let parsed: unknown
    try {
      parsed = JSON.parse(response)
    } catch {
      throw new Error('Backend Compiler sidecar response is not valid JSON')
    }
    if (response !== canonicalBackendCompilerSidecarJSON(parsed)) {
      throw new Error('Backend Compiler sidecar response is not canonical')
    }
    if (response !== canonicalBackendCompilerSidecarJSON(fixture.response)) {
      throw new Error('Backend Compiler sidecar response does not match the cross-language golden')
    }
  } catch (error) {
    await Promise.allSettled([stdout.cancel(), stderr.cancel()])
    try {
      await hardKillBackendCompilerSidecar(child)
    } catch (killError) {
      throw new AggregateError(
        [error, killError],
        'Backend Compiler sidecar smoke failed and cleanup did not complete'
      )
    }
    throw error
  }
}

async function main(): Promise<void> {
  const options = parseBackendCompilerSidecarSmokeArgs(Bun.argv.slice(2))
  const manifest = await smokeBackendCompilerSidecar(options)
  process.stdout.write(`Smoked ${options.binaryPath} (${manifest.sha256})\n`)
}

if (import.meta.main) await main()
