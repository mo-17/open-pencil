import {
  MANAGED_PREVIEW_MAX_COMMAND_BYTES,
  MANAGED_PREVIEW_MAX_EVENT_BYTES,
  parseManagedPreviewEvent,
  type ManagedPreviewCommand,
  type ManagedPreviewEvent,
  type ManagedPreviewState
} from '@open-pencil/compiler/managed-preview'

export interface ManagedPreviewChild {
  write(data: string): Promise<void>
  kill(): Promise<void>
}

export interface ManagedPreviewProcess {
  request(command: ManagedPreviewCommand): Promise<ManagedPreviewState>
  cancelPending(): void
  close(): Promise<void>
}

export interface ManagedPreviewProcessCallbacks {
  onEvent?(event: ManagedPreviewEvent): void
  onTerminal?(message: string): void
}

interface PendingManagedRequest {
  resolve(state: ManagedPreviewState): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Only the reviewed companion entrypoint and a persisted UUID enter native command arguments. */
export function managedPreviewCommandArgs(sessionId: string): string[] {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(sessionId)) {
    throw new Error('Managed preview requires a valid session ID.')
  }
  return ['packages/compiler/src/managed-preview/cli.ts', '--session', sessionId]
}

export async function startManagedPreviewProcess(
  sessionId: string,
  callbacks: ManagedPreviewProcessCallbacks = {}
): Promise<ManagedPreviewProcess> {
  const { Command } = await import('@tauri-apps/plugin-shell')
  const command = Command.create('lowcode-preview', managedPreviewCommandArgs(sessionId), {
    cwd: __OPENPENCIL_PROJECT_ROOT__
  })
  const pending = new Map<string, PendingManagedRequest>()
  let buffer = ''
  let child: ManagedPreviewChild | undefined
  let terminal = false
  let closing = false
  let closePromise: Promise<void> | undefined
  let ready = false
  let resolveReady: (() => void) | undefined
  let rejectReady: ((error: Error) => void) | undefined
  let resolveExit: (() => void) | undefined
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  const started = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // A native spawn error may occur before the ready promise is awaited.
  void started.catch(() => undefined)

  function cancelPending(message = 'Managed preview operation was cancelled.'): void {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error(message))
    }
    pending.clear()
  }

  function fail(message: string): void {
    if (terminal) return
    terminal = true
    rejectReady?.(new Error(message))
    cancelPending(message)
    if (!closing) callbacks.onTerminal?.(message)
    if (child && !closing) void closeProcess()
  }

  function receive(event: ManagedPreviewEvent): void {
    if (terminal) return
    if (event.type === 'ready') {
      if (ready || event.sessionId !== sessionId)
        throw new Error('Unexpected managed preview readiness.')
      ready = true
      resolveReady?.()
      return
    }
    if (!ready) throw new Error('Managed preview sent data before readiness.')
    if (event.type === 'error' && event.id === null) {
      fail(event.message)
      return
    }
    const item = event.id === null ? undefined : pending.get(event.id)
    if (!item) return
    if ('state' in event && event.state && event.state.sessionId !== sessionId) {
      throw new Error('Managed preview session changed unexpectedly.')
    }
    callbacks.onEvent?.(event)
    if (event.type === 'progress') return
    if (event.id !== null) pending.delete(event.id)
    clearTimeout(item.timer)
    if (event.type === 'error') item.reject(new Error(event.message))
    else item.resolve(event.state)
  }

  command.stdout.on('data', (chunk: string) => {
    if (terminal) return
    buffer += chunk
    try {
      if (buffer.length > MANAGED_PREVIEW_MAX_EVENT_BYTES)
        throw new Error('Oversized managed preview event.')
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.length === 0) continue
        if (new TextEncoder().encode(line).byteLength > MANAGED_PREVIEW_MAX_EVENT_BYTES) {
          throw new Error('Oversized managed preview event.')
        }
        receive(parseManagedPreviewEvent(JSON.parse(line)))
      }
    } catch {
      fail('Managed preview returned invalid protocol data. Its session was stopped.')
    }
  })
  // The companion emits only structured, redacted events. Never surface raw package-manager stderr.
  command.stderr.on('data', () => undefined)
  command.on('error', () =>
    fail('Managed preview process failed. Check the local runtime prerequisites.')
  )
  command.on('close', () => {
    resolveExit?.()
    fail(
      closing
        ? 'Managed preview closed.'
        : 'Managed preview stopped unexpectedly. Prepare it again.'
    )
  })

  const timer = setTimeout(
    () => fail('Managed preview did not become ready within 15 seconds.'),
    15000
  )
  try {
    child = await command.spawn()
    await started
  } catch {
    if (child) await child.kill().catch(() => undefined)
    throw new Error(
      'Could not start managed preview. Ensure Bun and Node are installed for the desktop app.'
    )
  } finally {
    clearTimeout(timer)
  }

  async function request(input: ManagedPreviewCommand): Promise<ManagedPreviewState> {
    if (!child || terminal || (closing && input.command !== 'close')) {
      throw new Error('Managed preview is no longer running.')
    }
    const line = JSON.stringify(input) + '\n'
    if (new TextEncoder().encode(line).byteLength > MANAGED_PREVIEW_MAX_COMMAND_BYTES) {
      throw new Error('Managed preview command is too large.')
    }
    if (pending.has(input.id)) throw new Error('Managed preview request ID was reused.')
    const response = new Promise<ManagedPreviewState>((resolve, reject) => {
      const timeout = input.command === 'setup' ? 900000 : 180000
      const requestTimer = setTimeout(() => {
        pending.delete(input.id)
        reject(new Error('Managed preview operation timed out. Stop the session before retrying.'))
      }, timeout)
      pending.set(input.id, { resolve, reject, timer: requestTimer })
    })
    void response.catch(() => undefined)
    try {
      await child.write(line)
    } catch {
      fail('Managed preview command could not be delivered.')
    }
    return response
  }

  function closeProcess(): Promise<void> {
    if (closePromise) return closePromise
    const owned = child
    if (!owned) return Promise.resolve()
    closing = true
    cancelPending()
    closePromise = (async () => {
      // Even a malformed response must not leave the owned backend running.
      await owned
        .write(JSON.stringify({ version: 1, id: crypto.randomUUID(), command: 'close' }) + '\n')
        .catch(() => undefined)
      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 10000)
        })
      ])
      if (timeout) clearTimeout(timeout)
      await owned.kill().catch(() => undefined)
      fail('Managed preview closed.')
    })()
    return closePromise
  }

  return {
    request,
    cancelPending,
    close: closeProcess
  }
}
