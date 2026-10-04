import { aborted, boundedText, checkSignal, FlutterPreviewError } from './errors'
import { boundedLines } from './lines'
import type { FlutterChild } from './process'

interface PendingRPC {
  resolve(value: unknown): void
  reject(error: Error): void
}
interface MachineOptions {
  deviceId: string
  directory: string
  onLog(message: string): void
  onProgress(message: string): void
  onExit(): void
  onStderr?(message: string): void
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class FlutterMachine {
  private readonly pending = new Map<number, PendingRPC>()
  private nextId = 1
  private appId: string | null = null
  private ready = false
  private terminal: Error | null = null
  private stopped = false
  private stopping: Promise<void> | null = null
  private exitReported = false
  private readonly listeners = new Set<() => void>()
  private readonly consumed: Promise<void>
  private logBytes = 0

  constructor(
    private readonly child: FlutterChild,
    private readonly options: MachineOptions
  ) {
    this.consumed = this.consume().catch((error: unknown) => {
      this.fail(
        error instanceof Error
          ? error
          : new FlutterPreviewError(
              'flutter-preview-machine-invalid',
              'The Flutter machine stream failed.'
            )
      )
      void child.stop().catch(() => undefined)
    })
    void this.consumeStderr().catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error('Flutter stderr failed'))
      void child.stop().catch(() => undefined)
    })
    void child.completed.then(() => {
      this.fail(
        new FlutterPreviewError('flutter-preview-exited', 'The owned Flutter run process exited.')
      )
      this.reportExit()
      return undefined
    })
  }

  private reportExit(): void {
    if (this.stopped || this.exitReported) return
    this.exitReported = true
    this.options.onExit()
  }

  isRunning(): boolean {
    return this.ready && !this.terminal && !this.stopped
  }

  private fail(error: Error): void {
    this.terminal ??= error
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
    for (const listener of this.listeners) listener()
  }

  private emitLog(message: string, progress = false): void {
    const text = boundedText(message)
    this.logBytes += Buffer.byteLength(text)
    if (this.logBytes > 256 * 1024 || !text) return
    if (progress) this.options.onProgress(text)
    else this.options.onLog(text)
  }

  private async consumeStderr(): Promise<void> {
    for await (const line of boundedLines(this.child.stderr, 64 * 1024))
      this.options.onStderr?.(boundedText(line))
  }

  private async consume(): Promise<void> {
    for await (const line of boundedLines(this.child.stdout, 256 * 1024)) {
      const text = line.trim()
      if (!text.startsWith('[')) {
        this.emitLog(text)
        continue
      }
      let entries: unknown
      try {
        entries = JSON.parse(text)
      } catch {
        this.emitLog(text)
        continue
      }
      if (!Array.isArray(entries) || entries.length > 64)
        throw new FlutterPreviewError(
          'flutter-preview-machine-invalid',
          'The Flutter machine message exceeded its event budget.'
        )
      for (const entry of entries) this.receive(entry)
    }
  }

  private receive(entry: unknown): void {
    if (!record(entry)) return
    if (typeof entry.id === 'number') {
      const pending = this.pending.get(entry.id)
      if (!pending) return
      this.pending.delete(entry.id)
      if ('error' in entry)
        pending.reject(
          new FlutterPreviewError(
            'flutter-preview-rpc-failed',
            'Flutter rejected the requested machine operation.'
          )
        )
      else pending.resolve(entry.result)
      return
    }
    if (!record(entry.params)) return
    const params = entry.params
    if (entry.event === 'app.start') {
      if (
        typeof params.appId === 'string' &&
        params.appId.length <= 256 &&
        params.deviceId === this.options.deviceId &&
        params.directory === this.options.directory
      )
        this.appId = params.appId
      return
    }
    if (!this.appId || params.appId !== this.appId) return
    switch (entry.event) {
      case 'app.started':
        this.ready = true
        for (const listener of this.listeners) listener()
        break
      case 'app.log':
        if (typeof params.log === 'string') this.emitLog(params.log)
        break
      case 'app.progress':
        if (typeof params.message === 'string') this.emitLog(params.message, true)
        break
      case 'app.stop':
        this.fail(
          new FlutterPreviewError('flutter-preview-app-stopped', 'The preview application stopped.')
        )
        this.reportExit()
        break
    }
  }

  async waitReady(timeoutMs: number, signal: AbortSignal): Promise<void> {
    checkSignal(signal)
    if (this.terminal) throw this.terminal
    if (this.ready) return
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.listeners.delete(changed)
        if (error) reject(error)
        else resolve()
      }
      const changed = () => {
        if (this.terminal) finish(this.terminal)
        else if (this.ready) finish()
      }
      const abort = () => finish(aborted())
      const timer = setTimeout(
        () =>
          finish(
            new FlutterPreviewError(
              'flutter-preview-start-timeout',
              'Flutter did not report app.started before the native build deadline.'
            )
          ),
        timeoutMs
      )
      this.listeners.add(changed)
      signal.addEventListener('abort', abort, { once: true })
      changed()
    })
  }

  private async rpc(
    method: 'app.restart' | 'app.stop',
    params: Record<string, unknown>,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<unknown> {
    checkSignal(signal)
    if (this.terminal) throw this.terminal
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    let interrupt: (error: Error) => void = () => {
      throw new Error('Machine deadline was not initialized')
    }
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = reject
    })
    const abort = () => interrupt(aborted())
    const timer = setTimeout(
      () =>
        interrupt(
          new FlutterPreviewError(
            'flutter-preview-rpc-timeout',
            'Flutter machine acknowledgement timed out.'
          )
        ),
      timeoutMs
    )
    signal.addEventListener('abort', abort, { once: true })
    try {
      // Correlate before writing; the deadline covers both transport and ACK, even an early ACK.
      const write = this.child.write(`${JSON.stringify([{ id, method, params }])}\n`).catch(() => {
        throw new FlutterPreviewError(
          'flutter-preview-exited',
          'Flutter machine stdin is unavailable.'
        )
      })
      const [, value] = await Promise.race([Promise.all([write, result]), interrupted])
      return value
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      this.pending.delete(id)
    }
  }

  async reload(signal: AbortSignal, timeoutMs = 60_000): Promise<void> {
    if (!this.appId || !this.ready)
      throw new FlutterPreviewError(
        'flutter-preview-not-running',
        'A started native preview is required for hot reload.'
      )
    const result = await this.rpc(
      'app.restart',
      {
        appId: this.appId,
        fullRestart: false,
        pause: false,
        debounce: false,
        reason: 'openpencil-preview-update'
      },
      timeoutMs,
      signal
    )
    if (!record(result) || result.code !== 0) {
      throw new FlutterPreviewError(
        'flutter-preview-reload-failed',
        'Flutter hot reload was rejected. The previous acknowledged preview revision is retained.'
      )
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopped = true
    this.stopping = (async () => {
      if (this.appId && !this.terminal) {
        await this.rpc(
          'app.stop',
          { appId: this.appId },
          3_000,
          new AbortController().signal
        ).catch(() => undefined)
      }
      await this.child.stop()
      this.fail(
        new FlutterPreviewError('flutter-preview-stopped', 'The owned Flutter preview was stopped.')
      )
      await this.consumed
    })()
    return this.stopping
  }
}
