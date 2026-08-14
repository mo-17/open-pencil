import { decodeTauriStderr } from '@/app/shell/ui'

import { asCLIOutputError } from '../cli-output'
import {
  buildMicrofrontendExportArgs,
  parseMicrofrontendExportResult,
  type MicrofrontendExportCommandOptions,
  type MicrofrontendExportResult
} from './command'

const MICROFRONTEND_COMMAND = 'lowcode-preview'
const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_TAIL = 16 * 1024

export interface MicrofrontendExportChildProcess {
  kill(): Promise<void>
}

export abstract class MicrofrontendExportCommand {
  abstract stdout: {
    on(event: 'data', listener: (raw: Uint8Array | number[] | string) => void): unknown
  }
  abstract stderr: {
    on(event: 'data', listener: (raw: Uint8Array | number[] | string) => void): unknown
  }
  abstract on(event: 'close', listener: (data: { code: number | null }) => void): unknown
  abstract on(event: 'error', listener: (error: string) => void): unknown
  abstract spawn(): Promise<MicrofrontendExportChildProcess>
}

export interface MicrofrontendExportRunnerDependencies {
  createCommand(args: string[]): Promise<MicrofrontendExportCommand>
}

const DEFAULT_DEPENDENCIES: MicrofrontendExportRunnerDependencies = Object.freeze({
  async createCommand(args: string[]) {
    const { Command } = await import('@tauri-apps/plugin-shell')
    return Command.create(MICROFRONTEND_COMMAND, args, {
      cwd: __OPENPENCIL_PROJECT_ROOT__
    })
  }
})

export function createMicrofrontendExportAbortError(): DOMException {
  return new DOMException('Microfrontend export cancelled.', 'AbortError')
}

export function isMicrofrontendExportAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function runMicrofrontendExportCLI(
  options: MicrofrontendExportCommandOptions,
  signal?: AbortSignal,
  dependencies: MicrofrontendExportRunnerDependencies = DEFAULT_DEPENDENCIES
): Promise<MicrofrontendExportResult> {
  if (signal?.aborted) throw createMicrofrontendExportAbortError()

  const command = await dependencies.createCommand(buildMicrofrontendExportArgs(options))
  if (signal?.aborted) throw createMicrofrontendExportAbortError()
  let stdout = ''
  let stdoutBytes = 0
  let stdoutTooLarge = false
  let stderrTail = ''
  const encoder = new TextEncoder()

  command.stdout.on('data', (raw: Uint8Array | number[] | string) => {
    if (stdoutTooLarge) return
    const chunk = typeof raw === 'string' ? raw : decodeTauriStderr(raw)
    const chunkBytes = encoder.encode(chunk).byteLength
    if (stdoutBytes + chunkBytes > MAX_STDOUT_BYTES) {
      stdoutTooLarge = true
      stdout = ''
      return
    }
    stdout += chunk
    stdoutBytes += chunkBytes
  })
  command.stderr.on('data', (raw: Uint8Array | number[] | string) => {
    const chunk = decodeTauriStderr(raw)
    stderrTail = `${stderrTail}${chunk}`.slice(-MAX_STDERR_TAIL)
  })

  return new Promise<MicrofrontendExportResult>((resolve, reject) => {
    let settled = false
    let child: Awaited<ReturnType<typeof command.spawn>> | null = null
    let cancelRequested = false
    let killStarted = false

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      callback()
    }
    const requestKill = (): void => {
      if (!cancelRequested || !child || killStarted || settled) return
      killStarted = true
      void child.kill().catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        stderrTail = `${stderrTail}\nFailed to stop microfrontend build: ${detail}`.slice(
          -MAX_STDERR_TAIL
        )
      })
    }
    const abort = (): void => {
      cancelRequested = true
      requestKill()
    }

    signal?.addEventListener('abort', abort, { once: true })
    command.on('close', (data: { code: number | null }) => {
      if (cancelRequested) {
        finish(() => reject(createMicrofrontendExportAbortError()))
        return
      }
      if (data.code !== 0) {
        const detail = stderrTail.trim()
        finish(() =>
          reject(
            new Error(detail || `Microfrontend build failed (exit code ${data.code ?? 'null'}).`)
          )
        )
        return
      }
      if (stdoutTooLarge) {
        finish(() => reject(new Error('Microfrontend build output is too large.')))
        return
      }
      try {
        const result = parseMicrofrontendExportResult(stdout.trim())
        if (
          result.outDir !== options.outDir ||
          result.packageName !== options.packageName ||
          result.target !== options.target
        ) {
          throw new Error('Microfrontend build output does not match the requested build.')
        }
        finish(() => resolve(result))
      } catch (error) {
        finish(() => reject(asCLIOutputError(error)))
      }
    })
    command.on('error', (error: string) =>
      finish(() =>
        reject(cancelRequested ? createMicrofrontendExportAbortError() : new Error(error))
      )
    )
    void command
      .spawn()
      .then((spawned) => {
        child = spawned
        if (signal?.aborted) cancelRequested = true
        requestKill()
        return undefined
      })
      .catch((error: unknown) => {
        if (cancelRequested || signal?.aborted) {
          finish(() => reject(createMicrofrontendExportAbortError()))
          return
        }
        const hint =
          'Failed to spawn `bun`. Ensure bun is available to the desktop app launching environment.'
        finish(() =>
          reject(new Error(`${error instanceof Error ? error.message : String(error)} — ${hint}`))
        )
      })
  })
}
