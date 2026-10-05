import {
  FLUTTER_PREVIEW_MAX_COMMAND_BYTES,
  FLUTTER_PREVIEW_MAX_EVENT_BYTES,
  parseFlutterPreviewCommand,
  parseFlutterPreviewEvent,
  type FlutterPreviewCommand,
  type FlutterPreviewEvent,
  type FlutterPreviewState
} from '@open-pencil/compiler/flutter-preview'

import { FlutterPreviewController } from './controller'
import { boundedText, FlutterPreviewError } from './errors'
import { boundedLines } from './lines'

interface ProtocolController {
  execute(command: FlutterPreviewCommand): Promise<FlutterPreviewEvent>
  getState(): FlutterPreviewState
  stop(): Promise<FlutterPreviewState>
}

export class BoundedEventWriter {
  private queued = 0
  private work: Promise<void> = Promise.resolve()
  private failure: Error | null = null

  constructor(
    private readonly write: (line: string) => Promise<void>,
    private readonly maximumQueuedBytes = 256 * 1024
  ) {}

  send(event: FlutterPreviewEvent): void {
    if (this.failure) throw this.failure
    const line = `${JSON.stringify(parseFlutterPreviewEvent(event))}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes > FLUTTER_PREVIEW_MAX_EVENT_BYTES || this.queued + bytes > this.maximumQueuedBytes) {
      throw new FlutterPreviewError(
        'flutter-preview-output-limit',
        'Flutter preview protocol output exceeded its byte budget.'
      )
    }
    this.queued += bytes
    this.work = this.work
      .then(() => this.write(line))
      .finally(() => {
        this.queued -= bytes
      })
    void this.work.catch((error: unknown) => {
      this.failure =
        error instanceof Error ? error : new Error('Flutter preview protocol write failed')
    })
  }

  async flush(): Promise<void> {
    await this.work
  }
}

export async function runFlutterPreviewProtocol(
  source: AsyncIterable<Uint8Array | string>,
  writer: BoundedEventWriter,
  createController: (onEvent: (event: FlutterPreviewEvent) => void) => ProtocolController = (
    onEvent
  ) => new FlutterPreviewController({ onEvent }),
  installShutdown?: (stop: () => Promise<void>) => () => void
): Promise<void> {
  const send = (event: FlutterPreviewEvent) => writer.send(event)
  const controller = createController(send)
  const pending = new Set<Promise<void>>()
  const lifecycle = { priorityPending: false, closing: false }
  let shutdown: Promise<void> | null = null
  const close = () => {
    lifecycle.closing = true
    shutdown ??= controller.stop().then(() => undefined)
    return shutdown
  }
  const unbind = installShutdown?.(close)
  const error = (id: string | null, value: unknown) => {
    send({
      version: 1,
      type: 'error',
      id,
      code: value instanceof FlutterPreviewError ? value.code : 'flutter-preview-invalid',
      message:
        value instanceof FlutterPreviewError || value instanceof TypeError
          ? boundedText(value.message)
          : 'Flutter preview host operation failed.',
      state: controller.getState()
    })
  }
  const dispatch = (command: FlutterPreviewCommand, priority: boolean) => {
    if (priority) lifecycle.priorityPending = true
    const task = controller
      .execute(command)
      .then(send)
      .catch((cause: unknown) => error(command.id, cause))
    pending.add(task)
    void task
      .finally(() => {
        pending.delete(task)
        if (priority) lifecycle.priorityPending = false
      })
      .catch(() => undefined)
    return task
  }
  send({ version: 1, type: 'ready', id: null })
  try {
    for await (const line of boundedLines(source, FLUTTER_PREVIEW_MAX_COMMAND_BYTES)) {
      if (lifecycle.closing) break
      if (!line.trim()) continue
      let input: unknown
      try {
        input = JSON.parse(line)
      } catch {
        error(null, new TypeError('Invalid Flutter preview JSON.'))
        continue
      }
      let command: FlutterPreviewCommand
      try {
        command = parseFlutterPreviewCommand(input)
      } catch (cause) {
        error(null, cause)
        continue
      }
      const priority = command.command === 'stop' || command.command === 'close'
      if (priority ? lifecycle.priorityPending && command.command !== 'close' : pending.size >= 4) {
        error(
          command.id,
          new FlutterPreviewError(
            'flutter-preview-busy',
            'Flutter preview command capacity is full.'
          )
        )
        continue
      }
      const task = dispatch(command, priority)
      if (command.command === 'close') {
        lifecycle.closing = true
        await task
        break
      }
    }
  } catch (cause) {
    try {
      error(null, cause)
    } catch {
      process.stderr.write(
        'Flutter preview protocol output is unavailable; stopping owned processes.\n'
      )
    }
  } finally {
    await close()
    await Promise.allSettled(pending)
    unbind?.()
    await writer.flush()
  }
}
