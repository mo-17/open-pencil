import { describe, expect, test } from 'bun:test'

import { startFlutterNativeProcess } from '@/app/lowcode/preview-pane/flutter-native/process'
import type { CreatePreviewNativeCommand } from '@/app/lowcode/preview-pane/host/native-command'

const idle = {
  sessionId: null,
  phase: 'idle',
  deviceId: null,
  revision: null,
  projectDirectory: null
}
const request = () => ({
  version: 1 as const,
  type: 'command' as const,
  id: crypto.randomUUID(),
  command: 'devices' as const
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture() {
  let stdout = (_chunk: string): void => undefined
  let stderr = (_chunk: string): void => undefined
  let closed = (_data: { code: number | null }): void => undefined
  let errored = (_error: string): void => undefined
  let respond = (input: { id: string; command: string }) => {
    stdout(
      JSON.stringify({ version: 1, type: 'result', id: input.id, state: idle, devices: [] }) + '\n'
    )
  }
  let writeGate = (_input: { id: string; command: string }): Promise<void> | undefined => undefined
  const writes: Array<{ id: string; command: string }> = []
  const events: unknown[] = []
  const terminal: string[] = []
  let kills = 0
  function on(event: 'close', listener: typeof closed): void
  function on(event: 'error', listener: typeof errored): void
  function on(event: 'close' | 'error', listener: typeof closed | typeof errored): void {
    if (event === 'close') closed = listener as typeof closed
    else errored = listener as typeof errored
  }
  const createCommand: CreatePreviewNativeCommand = (program, args, options) => {
    expect(program).toBe('flutter-preview')
    expect(args).toEqual(['tools/flutter-preview/src/index.ts'])
    expect(options).toEqual({ cwd: '/reviewed/project' })
    return {
      stdout: {
        on(_event, listener) {
          stdout = listener
        }
      },
      stderr: {
        on(_event, listener) {
          stderr = listener
        }
      },
      on,
      async spawn() {
        queueMicrotask(() => stdout('{"version":1,"type":"ready","id":null}\n'))
        return {
          async write(line) {
            const input = JSON.parse(line)
            writes.push(input)
            await writeGate(input)
            if (input.command === 'close') closed({ code: 0 })
            else respond(input)
          },
          async kill() {
            ++kills
          }
        }
      }
    }
  }
  return {
    start: (options?: Parameters<typeof startFlutterNativeProcess>[4]) =>
      startFlutterNativeProcess(
        (event) => events.push(event),
        (message) => terminal.push(message),
        createCommand,
        '/reviewed/project',
        options
      ),
    emit: (value: string) => stdout(value),
    stderr: (value: string) => stderr(value),
    error: (value: string) => errored(value),
    setRespond: (value: typeof respond) => {
      respond = value
    },
    setWriteGate: (value: typeof writeGate) => {
      writeGate = value
    },
    closed: () => closed({ code: 0 }),
    writes,
    events,
    terminal,
    kills: () => kills
  }
}

describe('Flutter native process boundary', () => {
  test('fixed entrypoint, split frames and cooperative idempotent close', async () => {
    const f = fixture()
    const child = await f.start()
    f.setRespond((input) => {
      const line =
        JSON.stringify({
          version: 1,
          type: 'result',
          id: input.id,
          state: idle,
          devices: [{ id: 'booted', name: 'Simulator', platform: 'ios' }]
        }) + '\n'
      f.emit(line.slice(0, 12))
      f.emit(line.slice(12))
    })
    expect((await child.request(request())).devices).toHaveLength(1)
    await child.close()
    await child.close()
    expect(f.writes.map((input) => input.command)).toEqual(['devices', 'close'])
    expect(f.kills()).toBe(1)
    expect(f.terminal).toEqual([])
    await expect(child.request(request())).rejects.toThrow('no longer running')
  })

  test('stale responses cannot resolve a different request', async () => {
    const f = fixture()
    const child = await f.start()
    f.setRespond((input) => {
      f.emit(
        JSON.stringify({ version: 1, type: 'result', id: crypto.randomUUID(), state: idle }) + '\n'
      )
      f.emit(
        JSON.stringify({ version: 1, type: 'progress', id: input.id, message: 'Preparing' }) + '\n'
      )
      f.emit(JSON.stringify({ version: 1, type: 'result', id: input.id, state: idle }) + '\n')
    })
    await child.request(request())
    expect(f.events).toHaveLength(2)
    await child.close()
  })

  test('malformed data rejects pending work and stops only owned child', async () => {
    const f = fixture()
    const child = await f.start()
    f.setRespond(() => {
      f.stderr('secret stderr')
      f.emit('{broken}\n')
    })
    await expect(child.request(request())).rejects.toThrow('invalid data')
    await child.close()
    expect(f.terminal).toHaveLength(1)
    expect(f.terminal[0]).not.toContain('secret')
    expect(f.kills()).toBe(1)
  })

  test('duplicate ready and oversized residual frames fail closed', async () => {
    for (const invalid of ['{"version":1,"type":"ready","id":null}\n', 'x'.repeat(65537)]) {
      const f = fixture()
      const child = await f.start()
      f.emit(invalid)
      await child.close()
      expect(f.terminal).toHaveLength(1)
      expect(f.kills()).toBe(1)
    }
  })

  test('close cancels in-flight work and ignores late events', async () => {
    const f = fixture()
    const child = await f.start()
    f.setRespond(() => undefined)
    const input = request()
    const pending = child.request(input)
    void pending.catch(() => undefined)
    await child.close()
    await expect(pending).rejects.toThrow('stopped')
    f.emit(JSON.stringify({ version: 1, type: 'result', id: input.id, state: idle }) + '\n')
    expect(f.events).toEqual([])
  })

  test('oversized commands are rejected before writing stdin', async () => {
    const f = fixture()
    const child = await f.start()
    await expect(
      child.request({ ...request(), extra: 'x'.repeat(16 * 1024 * 1024) } as never)
    ).rejects.toThrow('too large')
    expect(f.writes).toEqual([])
    await child.close()
  })

  test('native errors suppress raw messages and terminate once', async () => {
    const f = fixture()
    const child = await f.start()
    f.error('secret runtime path')
    f.error('second failure')
    await child.close()
    expect(f.terminal).toHaveLength(1)
    expect(f.terminal[0]).not.toContain('secret')
  })

  test('close cancels a request even while its native stdin write is unresolved', async () => {
    const f = fixture(),
      gate = deferred()
    const child = await f.start({ closeTimeoutMs: 20, requestTimeoutMs: 1000 })
    f.setWriteGate((input) => (input.command === 'devices' ? gate.promise : undefined))
    let failure: Error | undefined
    const pending = child.request(request()).catch((error: Error) => {
      failure = error
    })
    try {
      await child.close()
      await Bun.sleep(0)
      expect(failure?.message).toContain('stopped')
      expect(f.kills()).toBe(1)
    } finally {
      gate.resolve()
      await pending
      await child.close()
    }
  })

  test('close deadline kills the owned child even if the close write never completes', async () => {
    const f = fixture(),
      gate = deferred()
    const child = await f.start({ closeTimeoutMs: 20 })
    f.setWriteGate((input) => (input.command === 'close' ? gate.promise : undefined))
    let settled = false
    const stopping = child.close().then(() => {
      settled = true
      return undefined
    })
    try {
      await Bun.sleep(80)
      expect(f.kills()).toBe(1)
      expect(settled).toBe(true)
      expect(f.terminal).toEqual([])
    } finally {
      gate.resolve()
      f.closed()
      await stopping
    }
  })
})
