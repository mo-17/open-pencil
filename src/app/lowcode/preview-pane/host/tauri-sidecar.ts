import {
  createPreviewFileEncodeCache,
  resetPreviewFileEncodeCache,
  serializePreviewFiles
} from '@open-pencil/compiler'

import { decodeTauriStderr } from '@/app/shell/ui'

import { parsePreviewSidecarReady, type PreviewSidecarReady } from '../sidecar-ready'
import { createPreviewStartupEventBuffer, waitForPreviewUpdateAck } from '../update-ack'
import type { PreviewTarget } from './types'

interface SidecarReadyEvent {
  type: 'ready'
  url: string
  port: number
}

interface SidecarErrorEvent {
  type: 'error'
  message: string
}

interface SidecarUpdatedEvent {
  type: 'updated'
}

interface SidecarClosingEvent {
  type: 'closing'
}

type SidecarEvent =
  | SidecarReadyEvent
  | SidecarErrorEvent
  | SidecarUpdatedEvent
  | SidecarClosingEvent

export interface TauriPreviewSidecar {
  url: string
  port: number
  readonly terminal: Promise<{ code: number | null; message: string }>
  isAlive(): boolean
  update(files: Map<string, string | Uint8Array>): Promise<void>
  dispose(): Promise<void>
}

const SIDECAR_NAME = 'lowcode-preview'
const SIDECAR_ENTRY = 'packages/compiler/src/dev-server.ts'
const READY_TIMEOUT_MS = 15_000
const NOOP = (): void => undefined

export function previewSidecarCommandArgs(projectRoot: string, target: PreviewTarget): string[] {
  return [SIDECAR_ENTRY, '--root', projectRoot, '--target', target]
}

function parsePreviewSidecarEvent(line: string): SidecarEvent {
  const value: unknown = JSON.parse(line)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Preview sidecar event must be an object')
  }
  const type = Object.getOwnPropertyDescriptor(value, 'type')?.value
  if (type === 'ready') return { type, ...parsePreviewSidecarReady(value) }
  if (type === 'updated' || type === 'closing') return { type }
  const message = Object.getOwnPropertyDescriptor(value, 'message')?.value
  if (type === 'error' && typeof message === 'string') return { type, message }
  throw new Error('Unsupported preview sidecar event')
}

export async function startTauriPreviewSidecar(
  target: PreviewTarget
): Promise<TauriPreviewSidecar> {
  const { Command } = await import('@tauri-apps/plugin-shell')
  const projectRoot: string = __OPENPENCIL_PROJECT_ROOT__
  const command = Command.create(SIDECAR_NAME, previewSidecarCommandArgs(projectRoot, target), {
    cwd: projectRoot
  })

  let stdoutBuffer = ''
  const stderrTail: string[] = []
  const listeners = new Set<(event: SidecarEvent) => void>()
  const processState: {
    closed: boolean
    unhealthy: boolean
    exitCode: number | null
    terminalMessage: string | null
  } = { closed: false, unhealthy: false, exitCode: null, terminalMessage: null }
  let resolveTerminal: (value: { code: number | null; message: string }) => void = NOOP
  const terminal = new Promise<{ code: number | null; message: string }>((resolve) => {
    resolveTerminal = resolve
  })
  const startupEvents = createPreviewStartupEventBuffer()
  const processIsClosed = (): boolean => processState.closed
  const processIsAlive = (): boolean => !processState.closed && !processState.unhealthy

  const settleTerminal = (message: string, code: number | null): void => {
    processState.unhealthy = true
    if (processState.terminalMessage !== null) return
    processState.terminalMessage = message
    resolveTerminal({ code, message })
  }

  const dispatch = (event: SidecarEvent): void => {
    startupEvents.capture(event)
    for (const listener of listeners) listener(event)
  }

  command.stdout.on('data', (raw: Uint8Array | number[] | string) => {
    const chunk = typeof raw === 'string' ? raw : decodeTauriStderr(raw)
    stdoutBuffer += chunk
    let newline = stdoutBuffer.indexOf('\n')
    while (newline !== -1) {
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      newline = stdoutBuffer.indexOf('\n')
      if (!line) continue
      try {
        dispatch(parsePreviewSidecarEvent(line))
      } catch (cause) {
        console.warn('[preview] non-JSON stdout:', line, cause)
      }
    }
  })

  command.stderr.on('data', (raw: Uint8Array | number[] | string) => {
    const text = decodeTauriStderr(raw)
    stderrTail.push(text)
    let total = stderrTail.reduce((bytes, entry) => bytes + entry.length, 0)
    while (total > 8_192 && stderrTail.length > 1) {
      total -= stderrTail.shift()?.length ?? 0
    }
    console.warn('[preview]', text)
  })

  command.on('close', (data: { code: number | null }) => {
    processState.closed = true
    processState.exitCode = data.code
    const message = `dev-server exited (code ${data.code ?? 'null'})`
    settleTerminal(message, data.code)
    dispatch({ type: 'error', message })
  })
  command.on('error', (message: string) => {
    settleTerminal(message, null)
    dispatch({ type: 'error', message })
  })

  let child: Awaited<ReturnType<typeof command.spawn>>
  try {
    child = await command.spawn()
  } catch (cause) {
    const hint =
      'Failed to spawn `bun`. Ensure bun is on the launching shell PATH ' +
      '(GUI apps on macOS may need `~/.bun/bin` exported in /etc/paths.d or via launchctl).'
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)} — ${hint}`)
  }

  let ready: PreviewSidecarReady
  try {
    ready = await new Promise<PreviewSidecarReady>((resolve, reject) => {
      const fail = (message: string): void => {
        clearTimeout(timer)
        listeners.delete(handle)
        const stderr = stderrTail.join('').trim()
        reject(new Error(stderr ? `${message}\n--- stderr ---\n${stderr}` : message))
      }
      const timer = setTimeout(() => {
        if (processIsClosed()) {
          fail(`dev-server exited (code ${processState.exitCode ?? 'null'}) before ready`)
        } else {
          fail(`Preview server did not become ready within ${READY_TIMEOUT_MS}ms`)
        }
      }, READY_TIMEOUT_MS)
      const handle = (event: SidecarEvent): void => {
        if (event.type === 'ready') {
          try {
            const parsed = parsePreviewSidecarReady(event)
            clearTimeout(timer)
            listeners.delete(handle)
            resolve(parsed)
          } catch (cause) {
            fail(cause instanceof Error ? cause.message : String(cause))
          }
        } else if (event.type === 'error') {
          fail(event.message)
        }
      }
      listeners.add(handle)
      startupEvents.replay(handle)
    })
    if (!processIsAlive()) {
      throw new Error(
        processState.terminalMessage ?? 'Preview sidecar stopped before startup completed'
      )
    }
  } catch (cause) {
    if (!processIsClosed()) {
      try {
        await child.kill()
      } catch (killError) {
        console.warn('[preview] startup cleanup failed:', killError)
      }
    }
    throw cause
  } finally {
    startupEvents.settle()
  }

  const encodeCache = createPreviewFileEncodeCache()
  let updateQueue: Promise<void> = Promise.resolve()
  let disposed = false
  return {
    url: ready.url,
    port: ready.port,
    terminal,
    isAlive: () => !disposed && processIsAlive(),
    async update(files) {
      if (disposed) return
      const pending = updateQueue.then(async () => {
        if (disposed) return undefined
        if (!processIsAlive()) {
          throw new Error(processState.terminalMessage ?? 'Preview sidecar is not running')
        }
        const acknowledgement = waitForPreviewUpdateAck(listeners)
        try {
          const serializable = serializePreviewFiles(files, encodeCache)
          await child.write(`${JSON.stringify({ type: 'update', files: serializable })}\n`)
          await acknowledgement.promise
          if (!processIsAlive()) {
            throw new Error(
              processState.terminalMessage ?? 'Preview sidecar stopped after the update'
            )
          }
        } catch (cause) {
          resetPreviewFileEncodeCache(encodeCache)
          settleTerminal(
            cause instanceof Error ? cause.message : 'Preview sidecar update failed',
            processState.exitCode
          )
          if (!processIsClosed()) {
            try {
              await child.kill()
            } catch (killError) {
              console.warn('[preview] update failure cleanup failed:', killError)
            }
          }
          throw cause
        } finally {
          acknowledgement.cancel()
        }
        return undefined
      })
      updateQueue = pending.catch(() => undefined)
      await pending
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await updateQueue
      try {
        await child.write(`${JSON.stringify({ type: 'close' })}\n`)
      } catch (cause) {
        console.warn('[preview] close write failed (stdin closed?):', cause)
      }
      try {
        await child.kill()
      } catch (cause) {
        console.warn('[preview] kill failed:', cause)
      }
    }
  }
}
