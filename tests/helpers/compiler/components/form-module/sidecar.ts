import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { withModuleFormCleanup } from './lifecycle'

interface FormPreviewSidecar {
  url: string
  port: number
  close: () => Promise<void>
}

interface PendingFrame {
  phase: string
  accept: (value: unknown) => void
  reject: (error: Error) => void
}

function bounded<T>(result: Promise<T>, phase: string, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Bun form preview ${phase} timed out`)), milliseconds)
  })
  return Promise.race([result, deadline]).finally(() => clearTimeout(timer))
}

/** Exercise the production Bun JSONL entrypoint outside Playwright's Node loader. */
export async function startFormPreviewSidecar(
  target: 'react' | 'vue',
  files: [string, string][]
): Promise<FormPreviewSidecar> {
  const child = spawn(
    'bun',
    [
      join(process.cwd(), 'packages/compiler/dist/dev-server.mjs'),
      '--root',
      process.cwd(),
      '--target',
      target
    ],
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const pending = new Set<PendingFrame>()
  const reader = createInterface({ input: child.stdout })
  let failure: Error | undefined
  const firstFailure = (): Error | undefined => failure
  let exited = false
  const isExited = (): boolean => exited
  const rejectPending = (error: Error): void => {
    failure ??= error
    for (const frame of pending) frame.reject(failure)
  }
  child.stderr.resume()
  child.on('error', rejectPending)
  child.stdin.on('error', rejectPending)
  const completed = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      exited = true
      resolve(code)
      rejectPending(new Error(`Bun form preview exited with code ${String(code)}`))
    })
  })
  reader.on('line', (line) => {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      // Vite's informational stdout is not a protocol frame.
      return
    }
    if (!value || typeof value !== 'object' || !('type' in value)) return
    if (value.type === 'error') {
      rejectPending(
        new Error(
          'message' in value && typeof value.message === 'string'
            ? value.message
            : 'Bun form preview reported an error'
        )
      )
    } else if (['ready', 'updated', 'closing'].includes(String(value.type))) {
      for (const frame of pending) {
        if (frame.phase === value.type) frame.accept(value)
      }
    }
  })

  async function waitFor(phase: 'ready' | 'updated' | 'closing'): Promise<unknown> {
    if (failure) throw failure
    return new Promise((resolve, reject) => {
      const frame: PendingFrame = {
        phase,
        accept(value) {
          release()
          resolve(value)
        },
        reject(error) {
          release()
          reject(error)
        }
      }
      const timer = setTimeout(
        () => frame.reject(new Error(`Bun form preview ${phase} timed out`)),
        15_000
      )
      const release = (): void => {
        clearTimeout(timer)
        pending.delete(frame)
      }
      pending.add(frame)
    })
  }

  const write = (command: object): Promise<void> =>
    new Promise((resolve, reject) => {
      child.stdin.write(JSON.stringify(command) + '\n', (error) => {
        if (error) {
          rejectPending(error)
          reject(error)
          return
        }
        resolve()
      })
    })
  async function stopOwnedChild(): Promise<void> {
    if (!isExited()) {
      child.kill('SIGTERM')
      try {
        await bounded(completed, 'terminate', 2000)
      } catch {
        if (!isExited()) child.kill('SIGKILL')
        await bounded(completed, 'forced exit', 2000)
      }
    }
  }
  const closeReader = async (): Promise<void> => {
    reader.close()
  }
  const gracefullyClose = async (): Promise<void> => {
    if (failure) throw failure
    try {
      const closing = waitFor('closing')
      await Promise.all([closing, write({ type: 'close' })])
      const code = await bounded(completed, 'close', 5000)
      if (code !== 0) throw new Error(`Bun form preview close exited with code ${String(code)}`)
    } catch (error) {
      throw firstFailure() ?? error
    }
  }
  const finishClose = async (): Promise<void> => {
    await withModuleFormCleanup(gracefullyClose, stopOwnedChild, closeReader)
  }
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    closePromise ??= Promise.resolve().then(finishClose)
    return closePromise
  }

  try {
    const ready = await waitFor('ready')
    if (
      !ready ||
      typeof ready !== 'object' ||
      !('url' in ready) ||
      !('port' in ready) ||
      typeof ready.url !== 'string' ||
      typeof ready.port !== 'number' ||
      !Number.isInteger(ready.port) ||
      ready.port < 1 ||
      ready.port > 65535
    )
      throw new Error('Bun form preview sent an invalid ready event')
    const origin = new URL(ready.url)
    if (
      origin.protocol !== 'http:' ||
      origin.hostname !== '127.0.0.1' ||
      origin.username ||
      origin.password ||
      Number(origin.port) !== ready.port ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error('Bun form preview sent an invalid loopback URL')
    // Subscribe before writing: the acknowledgement can arrive before write completes.
    const updated = waitFor('updated')
    await Promise.all([updated, write({ type: 'update', files })])
    return { url: ready.url, port: ready.port, close }
  } catch (error) {
    const firstError = firstFailure() ?? error
    await withModuleFormCleanup(
      async () => {
        throw firstError
      },
      stopOwnedChild,
      closeReader
    )
    throw firstError
  }
}
