import {
  FLUTTER_PREVIEW_MAX_COMMAND_BYTES,
  FLUTTER_PREVIEW_MAX_EVENT_BYTES,
  parseFlutterPreviewEvent,
  type FlutterPreviewCommand,
  type FlutterPreviewEvent
} from '@open-pencil/compiler/flutter-preview'

import {
  createPreviewNativeCommand,
  type CreatePreviewNativeCommand,
  type PreviewNativeChild
} from '../host/native-command'

export interface FlutterNativeProcess {
  request(command: FlutterPreviewCommand): Promise<Extract<FlutterPreviewEvent, { type: 'result' }>>
  close(): Promise<void>
}

export async function startFlutterNativeProcess(
  onEvent: (event: FlutterPreviewEvent) => void,
  onTerminal: (message: string) => void,
  createCommand: CreatePreviewNativeCommand = createPreviewNativeCommand,
  projectRoot = __OPENPENCIL_PROJECT_ROOT__,
  timing: { closeTimeoutMs?: number; requestTimeoutMs?: number; readyTimeoutMs?: number } = {}
): Promise<FlutterNativeProcess> {
  const command = await createCommand(
    'flutter-preview',
    ['tools/dev/flutter-preview/src/index.ts'],
    {
      cwd: projectRoot
    }
  )
  const pending = new Map<
    string,
    {
      resolve(result: Extract<FlutterPreviewEvent, { type: 'result' }>): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  let child: PreviewNativeChild | undefined
  let terminal = false
  let closing = false
  let ready = false
  let buffer = ''
  let closePromise: Promise<void> | undefined
  let resolveReady: (() => void) | undefined
  let rejectReady: ((error: Error) => void) | undefined
  let resolveExit: (() => void) | undefined
  const started = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  void started.catch(() => undefined)
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  const isTerminal = (): boolean => terminal

  function cancelPending(message: string): void {
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
    if (!closing) {
      onTerminal(message)
      void closeProcess()
    }
  }
  function receive(event: FlutterPreviewEvent): void {
    if (terminal) return
    if (event.type === 'ready') {
      if (ready) throw new Error('Duplicate Flutter readiness.')
      ready = true
      resolveReady?.()
      return
    }
    if (!ready) throw new Error('Flutter event arrived before readiness.')
    if (event.type === 'error' && event.id === null) return fail(event.message)
    const item = event.id === null ? undefined : pending.get(event.id)
    if (!item) return
    onEvent(event)
    if (event.type === 'progress' || event.type === 'log') return
    if (event.id !== null) pending.delete(event.id)
    clearTimeout(item.timer)
    if (event.type === 'error') item.reject(new Error(event.message))
    else item.resolve(event)
  }
  command.stdout.on('data', (chunk) => {
    if (terminal) return
    try {
      buffer += chunk
      // Check complete frames individually: a native chunk may contain multiple valid frames.
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        if (new TextEncoder().encode(line).byteLength > FLUTTER_PREVIEW_MAX_EVENT_BYTES)
          throw new Error('Oversized frame.')
        receive(parseFlutterPreviewEvent(JSON.parse(line)))
      }
      if (new TextEncoder().encode(buffer).byteLength > FLUTTER_PREVIEW_MAX_EVENT_BYTES)
        throw new Error('Oversized frame.')
    } catch {
      fail('Flutter preview returned invalid data. Its session was stopped.')
    }
  })
  command.stderr.on('data', () => undefined)
  command.on('error', () =>
    fail('Flutter preview process failed. Check the installed Bun and Flutter runtimes.')
  )
  command.on('close', () => {
    resolveExit?.()
    fail(closing ? 'Flutter preview closed.' : 'Flutter preview stopped unexpectedly.')
  })
  const timer = setTimeout(
    () => fail('Flutter preview did not start within 15 seconds.'),
    timing.readyTimeoutMs ?? 15000
  )
  try {
    child = await command.spawn()
    if (isTerminal()) {
      await child.kill()
      throw new Error('Flutter preview could not start.')
    }
    await started
  } catch (cause) {
    await child?.kill().catch(() => undefined)
    throw cause
  } finally {
    clearTimeout(timer)
  }

  async function request(
    input: FlutterPreviewCommand
  ): Promise<Extract<FlutterPreviewEvent, { type: 'result' }>> {
    if (!child || terminal || closing) throw new Error('Flutter preview is no longer running.')
    const line = JSON.stringify(input) + '\n'
    if (new TextEncoder().encode(line).byteLength > FLUTTER_PREVIEW_MAX_COMMAND_BYTES)
      throw new Error('Flutter preview document is too large.')
    if (pending.has(input.id)) throw new Error('Flutter preview request ID was reused.')
    const response = new Promise<Extract<FlutterPreviewEvent, { type: 'result' }>>(
      (resolve, reject) => {
        const requestTimer = setTimeout(
          () => fail('Flutter preview operation timed out. Its session was stopped.'),
          timing.requestTimeoutMs ?? (input.command === 'start' ? 300000 : 60000)
        )
        pending.set(input.id, { resolve, reject, timer: requestTimer })
      }
    )
    void response.catch(() => undefined)
    void child.write(line).catch(() => fail('Flutter preview command could not be delivered.'))
    return response
  }
  function closeProcess(): Promise<void> {
    if (closePromise) return closePromise
    closing = true
    cancelPending('Flutter preview was stopped.')
    const owned = child
    if (!owned) return Promise.resolve()
    closePromise = (async () => {
      void owned
        .write(
          JSON.stringify({
            version: 1,
            type: 'command',
            id: crypto.randomUUID(),
            command: 'close'
          }) + '\n'
        )
        .catch(() => undefined)
      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, timing.closeTimeoutMs ?? 10000)
        })
      ])
      clearTimeout(timeout)
      await owned.kill().catch(() => undefined)
      fail('Flutter preview closed.')
    })()
    return closePromise
  }
  return { request, close: closeProcess }
}
