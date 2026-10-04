import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { aborted, checkSignal, FlutterPreviewError } from './errors'

export interface FlutterChild {
  readonly stdout: AsyncIterable<Uint8Array | string>
  readonly stderr: AsyncIterable<Uint8Array | string>
  readonly completed: Promise<{ code: number | null }>
  write(value: string): Promise<void>
  stop(): Promise<void>
}

export interface FlutterSpawnOptions {
  cwd: string
  environment: NodeJS.ProcessEnv
}
export type FlutterSpawn = (
  executable: string,
  args: readonly string[],
  options: FlutterSpawnOptions
) => FlutterChild

export const spawnFlutterChild: FlutterSpawn = (executable, args, options) => {
  const child = spawn(executable, [...args], {
    cwd: options.cwd,
    env: options.environment,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  })
  return manageFlutterChild(child)
}

export function manageFlutterChild(
  child: ChildProcessWithoutNullStreams,
  killGroup: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void = (pid, signal) => {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-pid, signal)
  }
): FlutterChild {
  let closed = false
  let cleanupError: Error | null = null
  let stopping: Promise<void> | null = null
  function signalOwnedChild(signal: 'SIGTERM' | 'SIGKILL'): void {
    if (closed || !child.pid) return
    try {
      // The PID is taken only from this live ChildProcess, never from stdin or persisted state.
      killGroup(child.pid, signal)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') {
        throw new FlutterPreviewError(
          'flutter-preview-stop-failed',
          'The owned Flutter child could not be stopped.'
        )
      }
    }
  }
  const completed = new Promise<{ code: number | null }>((resolve) => {
    child.once('error', () => {
      closed = true
      resolve({ code: 1 })
    })
    // A CLI leader can exit while a compiler descendant still runs or owns a pipe.
    // Clean this live child's private group before releasing its cleanup handle.
    child.once('exit', () => {
      try {
        signalOwnedChild('SIGKILL')
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error('Owned process cleanup failed')
      }
    })
    child.once('close', (code) => {
      closed = true
      resolve({ code })
    })
  })
  child.stdin.on('error', () => undefined)
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    completed,
    write: (value) =>
      new Promise<void>((resolve, reject) => {
        if (child.stdin.destroyed) {
          reject(
            new FlutterPreviewError(
              'flutter-preview-exited',
              'The owned Flutter process is no longer accepting commands.'
            )
          )
          return
        }
        child.stdin.write(value, (error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
    stop() {
      if (stopping) return stopping
      stopping = (async () => {
        child.stdin.end()
        signalOwnedChild('SIGTERM')
        let timer: ReturnType<typeof setTimeout> | undefined
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            try {
              signalOwnedChild('SIGKILL')
            } catch (error) {
              reject(
                error instanceof Error
                  ? error
                  : new Error('Owned Flutter process termination failed')
              )
              return
            }
            timer = setTimeout(
              () =>
                reject(
                  new FlutterPreviewError(
                    'flutter-preview-stop-timeout',
                    'The owned Flutter child did not close after termination.'
                  )
                ),
              2_000
            )
          }, 2_000)
        })
        try {
          await Promise.race([completed, deadline])
          if (cleanupError) throw cleanupError
        } finally {
          clearTimeout(timer)
        }
      })()
      return stopping
    }
  }
}

const MAX_CAPTURE_BYTES = 512 * 1024
async function capture(
  source: AsyncIterable<Uint8Array | string>,
  maximum: number
): Promise<string> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of source) {
    const value = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    bytes += value.length
    if (bytes > maximum)
      throw new FlutterPreviewError(
        'flutter-preview-output-limit',
        'Flutter command output exceeded its byte budget.'
      )
    chunks.push(value)
  }
  return Buffer.concat(chunks, bytes).toString('utf8')
}

export async function runFlutterCommand(
  child: FlutterChild,
  timeoutMs: number,
  signal: AbortSignal
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  checkSignal(signal)
  let rejectInterrupted: ((error: Error) => void) | undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject
  })
  const abort = () => {
    rejectInterrupted?.(aborted())
    void child.stop().catch(() => undefined)
  }
  const timer = setTimeout(() => {
    rejectInterrupted?.(
      new FlutterPreviewError(
        'flutter-preview-timeout',
        'Flutter command timed out using the existing local SDK.'
      )
    )
    void child.stop().catch(() => undefined)
  }, timeoutMs)
  signal.addEventListener('abort', abort, { once: true })
  try {
    const work = Promise.all([
      child.completed,
      capture(child.stdout, MAX_CAPTURE_BYTES),
      capture(child.stderr, MAX_CAPTURE_BYTES)
    ])
    const [result, stdout, stderr] = await Promise.race([work, interrupted])
    checkSignal(signal)
    return { ...result, stdout, stderr }
  } catch (error) {
    await child.stop()
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
