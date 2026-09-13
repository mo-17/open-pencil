import {
  MANAGED_PREVIEW_MAX_COMMAND_BYTES,
  MANAGED_PREVIEW_MAX_EVENT_BYTES,
  parseManagedPreviewCommand,
  parseManagedPreviewEvent,
  parseManagedPreviewSessionId,
  type ManagedPreviewEvent
} from './protocol'
import { ManagedPreviewService } from './service'

function emit(event: ManagedPreviewEvent): void {
  const checked = parseManagedPreviewEvent(event)
  const value = JSON.stringify(checked) + '\n'
  if (Buffer.byteLength(value) > MANAGED_PREVIEW_MAX_EVENT_BYTES)
    throw new Error('Managed preview event exceeds its bounded protocol limit.')
  process.stdout.write(value)
}
function safeMessage(value: unknown): string {
  if (
    value instanceof Error &&
    /^(Managed |The managed |The reviewed |Review |This managed |A previously |Select |The selected |The approved |The pending )/.test(
      value.message
    )
  )
    return value.message.slice(0, 2048)
  return 'Managed preview operation failed. Check local dependencies, ports, ownership and trusted identity configuration. Private process output was withheld.'
}
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--session')
    throw new Error('Managed preview requires one fixed session identifier.')
  const sessionId = parseManagedPreviewSessionId(args[1])
  const service = await ManagedPreviewService.create({
    sessionId,
    onProgress: emit,
    onTerminal: emit
  })
  let closing = false
  let buffer = Buffer.alloc(0)
  const close = async () => {
    if (closing) return
    closing = true
    try {
      await service.execute({ version: 1, id: 'shutdown', command: 'close' })
    } finally {
      process.exit(0)
    }
  }
  const malformed = () => {
    emit({
      version: 1,
      type: 'error',
      id: null,
      code: 'managed-invalid-protocol',
      message: 'Invalid or oversized managed preview command. This session is closing.',
      state: service.status()
    })
    void close()
  }
  const dispatch = (command: ReturnType<typeof parseManagedPreviewCommand>): void => {
    void service
      .execute(command)
      .then((state) => {
        emit({ version: 1, type: 'result', id: command.id, state })
        if (command.command === 'close') {
          closing = true
          process.exit(0)
        }
        return undefined
      })
      .catch((error: unknown) => {
        emit({
          version: 1,
          type: 'error',
          id: command.id,
          code: 'managed-operation-failed',
          message: safeMessage(error),
          state: service.status()
        })
      })
  }
  process.stdin.on('data', (chunk: Buffer) => {
    if (closing) return
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const newline = buffer.indexOf(10)
      if (newline === -1) {
        if (buffer.byteLength > MANAGED_PREVIEW_MAX_COMMAND_BYTES) malformed()
        break
      }
      if (newline > MANAGED_PREVIEW_MAX_COMMAND_BYTES) {
        malformed()
        break
      }
      const line = buffer.subarray(0, newline)
      buffer = buffer.subarray(newline + 1)
      let command
      try {
        command = parseManagedPreviewCommand(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
        )
      } catch {
        malformed()
        break
      }
      dispatch(command)
    }
  })
  process.stdin.once('end', () => {
    void close()
  })
  process.once('SIGTERM', () => {
    void close()
  })
  process.once('SIGINT', () => {
    void close()
  })
  emit({ version: 1, type: 'ready', sessionId })
}
if ((import.meta as { main?: boolean }).main) {
  void main().catch((error: unknown) => {
    emit({
      version: 1,
      type: 'error',
      id: null,
      code: 'managed-startup-failed',
      message: safeMessage(error),
      state: null
    })
    process.exit(1)
  })
}
