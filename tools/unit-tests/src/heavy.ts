#!/usr/bin/env bun

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseUnitTestRunArgs } from './run'
import { listHeavyUnitTests } from './shards'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const TEST_TIMEOUT_MS = 180_000
const FILE_TIMEOUT_MS = 600_000
const KILL_GRACE_MS = 2_000

export interface HeavyTestOptions {
  timeoutMs?: number
  killGraceMs?: number
  signal?: AbortSignal
  log?: (message: string) => void
}

function cancellationCode(signal?: AbortSignal): number {
  return signal?.reason === 143 ? 143 : 130
}

/** A separate process also bounds synchronous parsing, which Bun's test timer cannot interrupt. */
export function runHeavyTestFile(file: string, options: HeavyTestOptions = {}): Promise<number> {
  if (options.signal?.aborted) return Promise.resolve(cancellationCode(options.signal))
  const timeoutMs = options.timeoutMs ?? FILE_TIMEOUT_MS
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS
  const log = options.log ?? console.log
  const processGroup = process.platform !== 'win32'

  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['test', '--timeout', String(TEST_TIMEOUT_MS), file], {
      cwd: REPO_ROOT,
      env: { ...process.env, BUN_HEAVY_TESTS: 'true' },
      stdio: 'inherit',
      detached: processGroup
    })
    let forcedExit: number | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (processGroup && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    const stop = (code: number) => {
      if (forcedExit !== undefined) return
      forcedExit = code
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), killGraceMs)
    }
    const deadline = setTimeout(() => {
      log(`TIMEOUT ${file}: exceeded ${timeoutMs}ms wall-clock limit`)
      stop(124)
    }, timeoutMs)
    const abort = () => stop(cancellationCode(options.signal))
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const cleanup = () => {
      clearTimeout(deadline)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
      // A CLI test may leave children behind after success, a test-level timeout, or
      // process.exit(). Clean our owned group even when the leader already exited.
      if (processGroup) kill('SIGKILL')
    }
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (code, signal) => {
      cleanup()
      resolveExit(forcedExit ?? code ?? (signal === 'SIGINT' ? 130 : 1))
    })
  })
}

export async function runHeavyTests(
  files: string[],
  options: HeavyTestOptions = {}
): Promise<number> {
  const log = options.log ?? console.log
  if (files.length === 0) {
    log('No heavy unit tests found in this group.')
    return 0
  }
  for (const [index, file] of files.entries()) {
    if (options.signal?.aborted) return cancellationCode(options.signal)
    log(`[${index + 1}/${files.length}] ${file}`)
    const started = performance.now()
    const code = await runHeavyTestFile(file, options)
    log(
      `${code === 0 ? 'PASS' : 'FAIL'} ${file} (${((performance.now() - started) / 1000).toFixed(1)}s, exit ${code})`
    )
    if (code !== 0) return code
  }
  log(`All ${files.length} heavy test files passed.`)
  return 0
}

if (import.meta.main) {
  const controller = new AbortController()
  const interrupt = () => controller.abort(130)
  const terminate = () => controller.abort(143)
  // Keep handling repeated interrupts until the owned test process group is gone.
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    const group = parseUnitTestRunArgs(process.argv.slice(2))
    process.exitCode = await runHeavyTests(await listHeavyUnitTests(group), {
      signal: controller.signal
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}
