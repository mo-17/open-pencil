import { describe, expect, test } from 'bun:test'

import {
  createCodePenSidecarCommand,
  runCodePenSidecarRequest,
  type CodePenChildProcess,
  type CodePenCommand,
  type CodePenRunnerDependencies
} from '@/app/lowcode/preview-pane/codepen-showcase/runner'

type OutputListener = (raw: Uint8Array | number[] | string) => void
type CloseListener = (data: { code: number | null }) => void
type ErrorListener = (error: string) => void

const REQUEST = '{"version":1,"requestId":"request-1"}'

class FakeCodePenCommand implements CodePenCommand {
  readonly writes: string[] = []
  readonly child: CodePenChildProcess
  spawnCount = 0
  killCount = 0

  private stdoutListeners: OutputListener[] = []
  private stderrListeners: OutputListener[] = []
  private closeListeners: CloseListener[] = []
  private errorListeners: ErrorListener[] = []

  readonly stdout = {
    on: (_event: 'data', listener: OutputListener): unknown => {
      this.stdoutListeners.push(listener)
      return undefined
    }
  }

  readonly stderr = {
    on: (_event: 'data', listener: OutputListener): unknown => {
      this.stderrListeners.push(listener)
      return undefined
    }
  }

  constructor(
    private readonly options: {
      killFailure?: Error
      killGate?: Promise<void>
      writeFailure?: Error
      spawnGate?: Promise<void>
    } = {}
  ) {
    this.child = {
      write: async (data) => {
        if (this.options.writeFailure) throw this.options.writeFailure
        this.writes.push(typeof data === 'string' ? data : String(data))
      },
      kill: async () => {
        this.killCount++
        await this.options.killGate
        if (this.options.killFailure) throw this.options.killFailure
      }
    }
  }

  on(event: 'close', listener: CloseListener): unknown
  on(event: 'error', listener: ErrorListener): unknown
  on(event: 'close' | 'error', listener: CloseListener | ErrorListener): unknown {
    if (event === 'close') this.closeListeners.push(listener as CloseListener)
    else this.errorListeners.push(listener as ErrorListener)
    return undefined
  }

  async spawn(): Promise<CodePenChildProcess> {
    this.spawnCount++
    await this.options.spawnGate
    return this.child
  }

  emitStdout(raw: Uint8Array | number[] | string): void {
    for (const listener of this.stdoutListeners) listener(raw)
  }

  emitStderr(raw: Uint8Array | number[] | string): void {
    for (const listener of this.stderrListeners) listener(raw)
  }

  emitClose(code: number | null): void {
    for (const listener of this.closeListeners) listener({ code })
  }

  emitError(error: string): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

function runnerHarness(
  command = new FakeCodePenCommand(),
  timeoutMs = 120_000,
  killGraceMs = 2_000
): {
  command: FakeCodePenCommand
  dependencies: CodePenRunnerDependencies
  createCount(): number
} {
  let created = 0
  return {
    command,
    dependencies: {
      async createCommand() {
        created++
        return command
      },
      timeoutMs,
      killGraceMs
    },
    createCount: () => created
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function neverSettles(): Promise<void> {
  return new Promise<void>(() => {
    // Deliberately unresolved to exercise the runner's secondary watchdog.
  })
}

describe('CodePen sidecar runner lifecycle', () => {
  test('creates the packaged sidecar without arguments or a working directory', () => {
    const command = new FakeCodePenCommand()
    const calls: unknown[][] = []
    const actual = createCodePenSidecarCommand({
      sidecar(...args: [string]) {
        calls.push(args)
        return command
      }
    })
    expect(actual).toBe(command)
    expect(calls).toEqual([['binaries/openpencil-codepen-sidecar']])
  })

  test('does not create or spawn a command for a pre-aborted request', async () => {
    const controller = new AbortController()
    const harness = runnerHarness()
    controller.abort()

    await expect(
      runCodePenSidecarRequest(REQUEST, JSON.parse, controller.signal, harness.dependencies)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.createCount()).toBe(0)
    expect(harness.command.spawnCount).toBe(0)
  })

  test('writes exactly one newline-framed request and parses one response', async () => {
    const harness = runnerHarness()
    const pending = runCodePenSidecarRequest(
      REQUEST,
      (raw) => JSON.parse(raw) as { ok: boolean },
      undefined,
      harness.dependencies
    )
    await flushMicrotasks()
    expect(harness.command.writes).toEqual([`${REQUEST}\n`])

    harness.command.emitStdout('{"ok":')
    harness.command.emitStdout('true}\n')
    harness.command.emitClose(0)
    await expect(pending).resolves.toEqual({ ok: true })
  })

  test('returns a structured protocol error response even when the sidecar exits nonzero', async () => {
    const harness = runnerHarness()
    const pending = runCodePenSidecarRequest(
      REQUEST,
      (raw) => JSON.parse(raw) as { ok: false; error: { code: string } },
      undefined,
      harness.dependencies
    )
    await flushMicrotasks()
    harness.command.emitStdout(
      '{"version":1,"requestId":"request-1","ok":false,"error":{"code":"unsafe-import"}}\n'
    )
    harness.command.emitClose(1)
    await expect(pending).resolves.toEqual({
      version: 1,
      requestId: 'request-1',
      ok: false,
      error: { code: 'unsafe-import' }
    })
  })

  test('decodes stdout UTF-8 characters split across byte chunks', async () => {
    const harness = runnerHarness()
    const pending = runCodePenSidecarRequest(
      REQUEST,
      (raw) => JSON.parse(raw) as { message: string },
      undefined,
      harness.dependencies
    )
    await flushMicrotasks()
    const encoded = new TextEncoder().encode('{"message":"编译完成"}\n')
    for (const byte of encoded) harness.command.emitStdout(new Uint8Array([byte]))
    harness.command.emitClose(0)
    await expect(pending).resolves.toEqual({ message: '编译完成' })
  })

  test('rejects request and response framing ambiguity', async () => {
    const harness = runnerHarness()
    await expect(
      runCodePenSidecarRequest(`${REQUEST}\n{}`, JSON.parse, undefined, harness.dependencies)
    ).rejects.toThrow('one bounded JSON line')
    expect(harness.createCount()).toBe(0)

    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await flushMicrotasks()
    harness.command.emitStdout('{"ok":true}\n{"ok":false}\n')
    harness.command.emitClose(0)
    await expect(pending).rejects.toThrow('invalid response frame')
  })

  test('settles user cancellation after kill without waiting for close', async () => {
    const controller = new AbortController()
    const harness = runnerHarness()
    const pending = runCodePenSidecarRequest(
      REQUEST,
      JSON.parse,
      controller.signal,
      harness.dependencies
    )
    await flushMicrotasks()

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.command.killCount).toBe(1)

    harness.command.emitClose(null)
    expect(harness.command.killCount).toBe(1)
  })

  test('bounds user cancellation when kill and close never settle', async () => {
    const killGate = neverSettles()
    const controller = new AbortController()
    const harness = runnerHarness(new FakeCodePenCommand({ killGate }), 120_000, 1)
    const pending = runCodePenSidecarRequest(
      REQUEST,
      JSON.parse,
      controller.signal,
      harness.dependencies
    )
    await flushMicrotasks()
    controller.abort()
    const error: unknown = await pending.catch((reason: unknown) => reason)
    expect(error).toMatchObject({ name: 'AbortError' })
    expect((error as Error).message).toContain('kill grace period')
    expect(harness.command.killCount).toBe(1)
  })

  test('surfaces bounded stderr for a nonzero sidecar exit', async () => {
    const harness = runnerHarness()
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await flushMicrotasks()
    harness.command.emitStderr('x'.repeat(20 * 1024))
    const encoded = new TextEncoder().encode('编译器安全失败')
    for (const byte of encoded) harness.command.emitStderr(new Uint8Array([byte]))
    harness.command.emitClose(2)
    const error: unknown = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('编译器安全失败')
    expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(16 * 1024)
  })

  test('rejects malformed UTF-8 instead of replacing invalid stdout bytes', async () => {
    const harness = runnerHarness()
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await flushMicrotasks()
    harness.command.emitStdout(new Uint8Array([0x7b, 0xff, 0x7d, 0x0a]))
    harness.command.emitClose(1)
    await expect(pending).rejects.toThrow('stdout is not valid UTF-8')
  })

  test('rejects malformed UTF-8 instead of replacing invalid stderr bytes', async () => {
    const harness = runnerHarness()
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await flushMicrotasks()
    harness.command.emitStderr(new Uint8Array([0xe4, 0xb8]))
    harness.command.emitClose(2)
    await expect(pending).rejects.toThrow('stderr is not valid UTF-8')
  })

  test('bounds a sidecar that never responds', async () => {
    const harness = runnerHarness(new FakeCodePenCommand(), 1)
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await expect(pending).rejects.toThrow('timed out')
    expect(harness.command.killCount).toBe(1)
  })

  test('bounds timeout when kill and close never settle', async () => {
    const killGate = neverSettles()
    const harness = runnerHarness(new FakeCodePenCommand({ killGate }), 1, 1)
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await expect(pending).rejects.toThrow('timed out')
    expect(harness.command.killCount).toBe(1)
  })

  test('best-effort kills a spawned child before settling a command error', async () => {
    const killGate = neverSettles()
    const harness = runnerHarness(new FakeCodePenCommand({ killGate }), 120_000, 1)
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await flushMicrotasks()
    harness.command.emitError('sensitive plugin-shell detail')
    await expect(pending).rejects.toThrow('CodePen sidecar process failed')
    expect(harness.command.killCount).toBe(1)
    harness.command.emitClose(null)
    expect(harness.command.killCount).toBe(1)
  })

  test('kills a delayed child that spawns after the timeout already settled', async () => {
    let releaseSpawn = (): void => undefined
    const spawnGate = new Promise<void>((resolve) => {
      releaseSpawn = resolve
    })
    const harness = runnerHarness(new FakeCodePenCommand({ spawnGate }), 1)
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await expect(pending).rejects.toThrow('timed out')
    expect(harness.command.killCount).toBe(0)

    releaseSpawn()
    await flushMicrotasks()
    expect(harness.command.killCount).toBe(1)
    expect(harness.command.writes).toEqual([])
  })

  test('settles abort before delayed spawn then best-effort kills the child', async () => {
    let releaseSpawn = (): void => undefined
    const spawnGate = new Promise<void>((resolve) => {
      releaseSpawn = resolve
    })
    const controller = new AbortController()
    const harness = runnerHarness(new FakeCodePenCommand({ spawnGate }))
    const pending = runCodePenSidecarRequest(
      REQUEST,
      JSON.parse,
      controller.signal,
      harness.dependencies
    )
    await flushMicrotasks()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.command.killCount).toBe(0)
    releaseSpawn()
    await flushMicrotasks()
    expect(harness.command.killCount).toBe(1)
    expect(harness.command.writes).toEqual([])
  })

  test('does not block a timed-out caller on a late-spawn child whose kill hangs', async () => {
    let releaseSpawn = (): void => undefined
    const spawnGate = new Promise<void>((resolve) => {
      releaseSpawn = resolve
    })
    const killGate = neverSettles()
    const harness = runnerHarness(new FakeCodePenCommand({ killGate, spawnGate }), 1, 1)
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await expect(pending).rejects.toThrow('timed out')
    releaseSpawn()
    await flushMicrotasks()
    expect(harness.command.killCount).toBe(1)
    expect(harness.command.writes).toEqual([])
  })

  test('kills a child that cannot accept its stdin request', async () => {
    const harness = runnerHarness(
      new FakeCodePenCommand({ writeFailure: new Error('stdin unavailable') })
    )
    const pending = runCodePenSidecarRequest(REQUEST, JSON.parse, undefined, harness.dependencies)
    await expect(pending).rejects.toThrow('could not accept the request')
    expect(harness.command.killCount).toBe(1)
  })
})
