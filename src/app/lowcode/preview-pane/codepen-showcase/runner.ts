import { asCLIOutputError } from '../cli-output'

const CODEPEN_SIDECAR = 'binaries/openpencil-codepen-sidecar'
const MAX_REQUEST_BYTES = 64 * 1024 * 1024
const MAX_STDOUT_BYTES = 4 * 1024 * 1024
const MAX_STDERR_TAIL = 16 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_KILL_GRACE_MS = 2_000
const UTF8_ENCODER = new TextEncoder()

type CodePenOutputChunk = Uint8Array | number[] | string

export interface CodePenChildProcess {
  write(data: string | Uint8Array | number[]): Promise<void>
  kill(): Promise<void>
}

export interface CodePenCommand {
  stdout: { on(event: 'data', listener: (raw: CodePenOutputChunk) => void): unknown }
  stderr: { on(event: 'data', listener: (raw: CodePenOutputChunk) => void): unknown }
  on(event: 'close', listener: (data: { code: number | null }) => void): unknown
  on(event: 'error', listener: (error: string) => void): unknown
  spawn(): Promise<CodePenChildProcess>
}

export interface CodePenRunnerDependencies {
  createCommand(): Promise<CodePenCommand>
  timeoutMs?: number
  killGraceMs?: number
}

export interface CodePenSidecarCommandFactory {
  sidecar(program: string): CodePenCommand
}

export function createCodePenSidecarCommand(factory: CodePenSidecarCommandFactory): CodePenCommand {
  return factory.sidecar(CODEPEN_SIDECAR)
}

const DEFAULT_DEPENDENCIES: CodePenRunnerDependencies = Object.freeze({
  async createCommand() {
    const { Command } = await import('@tauri-apps/plugin-shell')
    return createCodePenSidecarCommand(Command)
  },
  timeoutMs: DEFAULT_TIMEOUT_MS,
  killGraceMs: DEFAULT_KILL_GRACE_MS
})

export function createCodePenShowcaseAbortError(detail?: string): DOMException {
  return new DOMException(
    detail ? `CodePen showcase cancelled. ${detail}` : 'CodePen showcase cancelled.',
    'AbortError'
  )
}

export function isCodePenShowcaseAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function requestLine(value: string): string {
  const byteLength = new TextEncoder().encode(value).byteLength
  if (
    value.length === 0 ||
    byteLength > MAX_REQUEST_BYTES ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    throw new Error('CodePen sidecar request must be one bounded JSON line.')
  }
  return `${value}\n`
}

function responseLine(value: string): string {
  let line = value
  if (line.endsWith('\n')) line = line.slice(0, -1)
  if (line.endsWith('\r')) line = line.slice(0, -1)
  if (line.length === 0 || line.includes('\n') || line.includes('\r')) {
    throw new Error('CodePen sidecar returned an invalid response frame.')
  }
  return line
}

function outputBytes(raw: CodePenOutputChunk): Uint8Array {
  if (typeof raw === 'string') return UTF8_ENCODER.encode(raw)
  return raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
}

function appendByteTail(
  current: Uint8Array,
  addition: Uint8Array,
  maximum: number
): Uint8Array<ArrayBuffer> {
  if (addition.byteLength >= maximum) {
    const tail = new Uint8Array(maximum)
    tail.set(addition.subarray(addition.byteLength - maximum))
    return tail
  }
  const keep = Math.min(current.byteLength, maximum - addition.byteLength)
  const tail = new Uint8Array(keep + addition.byteLength)
  tail.set(current.subarray(current.byteLength - keep))
  tail.set(addition, keep)
  return tail
}

function decodeUTF8Tail(value: Uint8Array): string {
  let start = 0
  while (start < value.byteLength && (value[start] & 0xc0) === 0x80) start++
  return new TextDecoder('utf-8', { fatal: true }).decode(value.subarray(start))
}

export async function runCodePenSidecarRequest<Result>(
  serializedRequest: string,
  parseResponse: (raw: string) => Result,
  signal?: AbortSignal,
  dependencies: CodePenRunnerDependencies = DEFAULT_DEPENDENCIES
): Promise<Result> {
  const framedRequest = requestLine(serializedRequest)
  if (signal?.aborted) throw createCodePenShowcaseAbortError()
  const command = await dependencies.createCommand()
  if (signal?.aborted) throw createCodePenShowcaseAbortError()
  let stdout = ''
  let stdoutBytes = 0
  let stdoutTooLarge = false
  let stdoutDecodeError = false
  let stderrDecodeError = false
  let stderrTailBytes = new Uint8Array()
  const stdoutDecoder = new TextDecoder('utf-8', { fatal: true })
  const stderrDecoder = new TextDecoder('utf-8', { fatal: true })
  const appendStderrText = (value: string): void => {
    stderrTailBytes = appendByteTail(stderrTailBytes, UTF8_ENCODER.encode(value), MAX_STDERR_TAIL)
  }
  command.stdout.on('data', (raw) => {
    if (stdoutTooLarge || stdoutDecodeError) return
    const bytes = outputBytes(raw)
    if (stdoutBytes + bytes.byteLength > MAX_STDOUT_BYTES) {
      stdoutTooLarge = true
      stdout = ''
      return
    }
    stdoutBytes += bytes.byteLength
    try {
      stdout += stdoutDecoder.decode(bytes, { stream: true })
    } catch {
      stdoutDecodeError = true
      stdout = ''
    }
  })
  command.stderr.on('data', (raw) => {
    if (stderrDecodeError) return
    try {
      appendStderrText(stderrDecoder.decode(outputBytes(raw), { stream: true }))
    } catch {
      stderrDecodeError = true
      stderrTailBytes = new Uint8Array()
    }
  })

  return new Promise<Result>((resolve, reject) => {
    let settled = false
    let child: CodePenChildProcess | null = null
    let cancelRequested = false
    let timedOut = false
    let commandError: string | null = null
    let killError: string | null = null
    let killStarted = false
    let killPromise: Promise<void> | null = null
    let cancellationSettlementStarted = false
    let commandFailureSettlementStarted = false
    const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const killGraceMs = dependencies.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    const timeout = setTimeout(() => {
      if (settled) return
      timedOut = true
      cancelRequested = true
      settleCancellation()
    }, timeoutMs)
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      callback()
    }
    const cancellationDetail = (): string | undefined => {
      const details = [
        killError ? `Failed to stop the compiler child: ${killError}` : null,
        commandError ? `Compiler process error: ${commandError}` : null
      ].filter((detail): detail is string => detail !== null)
      return details.length > 0 ? details.join(' ') : undefined
    }
    const requestKill = (force = false): void => {
      if (!child || killStarted || (!force && (!cancelRequested || settled))) return
      killStarted = true
      killPromise = child.kill().catch((error: unknown) => {
        void error
        killError = 'Compiler child could not be stopped.'
      })
    }
    const waitForKillBounded = async (): Promise<void> => {
      if (!killPromise) return
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        killPromise.then(() => 'settled' as const),
        new Promise<'expired'>((resolveGrace) => {
          graceTimer = setTimeout(() => {
            resolveGrace('expired')
          }, killGraceMs)
        })
      ])
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      if (result === 'expired') {
        killError = 'Compiler child did not stop within the kill grace period.'
      }
    }
    const settleCancellation = (): void => {
      if (settled || cancellationSettlementStarted) return
      cancellationSettlementStarted = true
      requestKill()
      void waitForKillBounded().then(() => {
        finish(() =>
          reject(
            timedOut
              ? new Error('CodePen sidecar timed out.')
              : createCodePenShowcaseAbortError(cancellationDetail())
          )
        )
        return undefined
      })
    }
    const abort = (): void => {
      cancelRequested = true
      settleCancellation()
    }
    const settleCommandFailure = (): void => {
      if (commandFailureSettlementStarted) return
      commandFailureSettlementStarted = true
      requestKill(true)
      void waitForKillBounded().then(() => {
        finish(() => reject(new Error('CodePen sidecar process failed.')))
        return undefined
      })
    }
    signal?.addEventListener('abort', abort, { once: true })
    command.on('close', ({ code }) => {
      if (cancelRequested) {
        settleCancellation()
        return
      }
      if (commandFailureSettlementStarted) return
      if (stdoutTooLarge) {
        finish(() => reject(new Error('CodePen sidecar output is too large.')))
        return
      }
      if (!stdoutDecodeError) {
        try {
          stdout += stdoutDecoder.decode()
        } catch {
          stdoutDecodeError = true
        }
      }
      if (!stderrDecodeError) {
        try {
          appendStderrText(stderrDecoder.decode())
        } catch {
          stderrDecodeError = true
        }
      }
      if (stdoutDecodeError) {
        finish(() => reject(new Error('CodePen sidecar stdout is not valid UTF-8.')))
        return
      }
      if (stderrDecodeError) {
        finish(() => reject(new Error('CodePen sidecar stderr is not valid UTF-8.')))
        return
      }
      let stderrTail = ''
      try {
        stderrTail = decodeUTF8Tail(stderrTailBytes)
      } catch {
        finish(() => reject(new Error('CodePen sidecar stderr is not valid UTF-8.')))
        return
      }
      if (stdoutBytes === 0 && code !== 0) {
        finish(() =>
          reject(new Error(stderrTail.trim() || `CodePen sidecar failed (exit ${code ?? 'null'}).`))
        )
        return
      }
      try {
        const result = parseResponse(responseLine(stdout))
        finish(() => resolve(result))
      } catch (error) {
        finish(() => reject(asCLIOutputError(error)))
      }
    })
    command.on('error', (error) => {
      if (cancelRequested) {
        void error
        commandError = 'Compiler process reported an error.'
        return
      }
      if (!child) {
        finish(() => reject(new Error(error)))
        return
      }
      settleCommandFailure()
    })
    void command
      .spawn()
      .then(async (spawned) => {
        child = spawned
        if (signal?.aborted) cancelRequested = true
        if (cancelRequested || settled) {
          requestKill(true)
          if (!settled) settleCancellation()
          return undefined
        }
        try {
          await child.write(framedRequest)
        } catch {
          cancelRequested = true
          requestKill(true)
          await waitForKillBounded()
          finish(() => reject(new Error('CodePen sidecar could not accept the request.')))
        }
        return undefined
      })
      .catch((error) => {
        finish(() =>
          reject(
            signal?.aborted
              ? createCodePenShowcaseAbortError(
                  `Compiler process could not start: ${error instanceof Error ? error.message : String(error)}`
                )
              : new Error('CodePen sidecar could not accept the request.')
          )
        )
      })
  })
}
