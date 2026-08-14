import { describe, expect, test } from 'bun:test'

import type { MicrofrontendExportCommandOptions } from '@/app/lowcode/preview-pane/microfrontend-export/command'
import {
  runMicrofrontendExportCLI,
  type MicrofrontendExportChildProcess,
  type MicrofrontendExportCommand,
  type MicrofrontendExportRunnerDependencies
} from '@/app/lowcode/preview-pane/microfrontend-export/runner'

type OutputListener = (raw: Uint8Array | number[] | string) => void
type CloseListener = (data: { code: number | null }) => void
type ErrorListener = (error: string) => void

const VALID_MANIFEST_DIGEST = 'A'.repeat(43)

function commandOptions(
  overrides: Partial<MicrofrontendExportCommandOptions> = {}
): MicrofrontendExportCommandOptions {
  return {
    snapshotPath: '/tmp/open-pencil-snapshot.fig',
    outDir: '/tmp/open-pencil-build',
    target: 'react',
    appId: 'acme.orders',
    version: '1.2.3',
    packageName: 'orders-app',
    uiKit: 'none',
    ...overrides
  }
}

function resultFixture(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    outDir: '/tmp/open-pencil-build',
    packageName: 'orders-app',
    target: 'react',
    files: ['assets/openpencil-microfrontend.js', 'openpencil.microfrontend.json'],
    warnings: [],
    microfrontend: {
      manifest: { digest: VALID_MANIFEST_DIGEST, byteLength: 512 }
    },
    ...overrides
  })
}

class FakeMicrofrontendCommand implements MicrofrontendExportCommand {
  readonly child: MicrofrontendExportChildProcess
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

  constructor(killFailure?: Error) {
    this.child = {
      kill: async () => {
        this.killCount++
        if (killFailure) throw killFailure
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

  async spawn(): Promise<MicrofrontendExportChildProcess> {
    this.spawnCount++
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

function runnerHarness(command = new FakeMicrofrontendCommand()): {
  command: FakeMicrofrontendCommand
  dependencies: MicrofrontendExportRunnerDependencies
  createCount(): number
} {
  let created = 0
  return {
    command,
    dependencies: {
      async createCommand() {
        created++
        return command
      }
    },
    createCount: () => created
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function observeSettlement(promise: Promise<unknown>): {
  state(): 'pending' | 'resolved' | 'rejected'
  observed: Promise<void>
} {
  let current: 'pending' | 'resolved' | 'rejected' = 'pending'
  const observed = promise.then(
    () => {
      current = 'resolved'
      return undefined
    },
    () => {
      current = 'rejected'
      return undefined
    }
  )
  return { state: () => current, observed }
}

describe('microfrontend export CLI runner', () => {
  test('does not create or spawn a command for a pre-aborted request', async () => {
    const controller = new AbortController()
    const harness = runnerHarness()
    controller.abort()

    await expect(
      runMicrofrontendExportCLI(commandOptions(), controller.signal, harness.dependencies)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.createCount()).toBe(0)
    expect(harness.command.spawnCount).toBe(0)
  })

  test('kills an active child and keeps the promise pending until close', async () => {
    const controller = new AbortController()
    const harness = runnerHarness()
    const pending = runMicrofrontendExportCLI(
      commandOptions(),
      controller.signal,
      harness.dependencies
    )
    const settlement = observeSettlement(pending)
    await flushMicrotasks()

    expect(harness.command.spawnCount).toBe(1)
    controller.abort()
    await flushMicrotasks()

    expect(harness.command.killCount).toBe(1)
    expect(settlement.state()).toBe('pending')

    harness.command.emitClose(null)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await settlement.observed
  })

  test('still waits for close when killing the child fails', async () => {
    const controller = new AbortController()
    const harness = runnerHarness(new FakeMicrofrontendCommand(new Error('permission denied')))
    const pending = runMicrofrontendExportCLI(
      commandOptions(),
      controller.signal,
      harness.dependencies
    )
    const settlement = observeSettlement(pending)
    await flushMicrotasks()

    controller.abort()
    await flushMicrotasks()

    expect(harness.command.killCount).toBe(1)
    expect(settlement.state()).toBe('pending')

    harness.command.emitClose(1)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await settlement.observed
  })

  test('lets cancellation win over an otherwise successful close', async () => {
    const controller = new AbortController()
    const harness = runnerHarness()
    const pending = runMicrofrontendExportCLI(
      commandOptions(),
      controller.signal,
      harness.dependencies
    )
    await flushMicrotasks()

    harness.command.emitStdout(resultFixture())
    controller.abort()
    harness.command.emitClose(0)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.command.killCount).toBe(1)
  })

  test('surfaces stderr when the child exits with a non-zero code', async () => {
    const harness = runnerHarness()
    const pending = runMicrofrontendExportCLI(commandOptions(), undefined, harness.dependencies)
    await flushMicrotasks()

    harness.command.emitStderr('compiler exploded')
    harness.command.emitClose(2)

    await expect(pending).rejects.toThrow('compiler exploded')
  })

  test('rejects a successful result whose identity does not match the request', async () => {
    const mismatches: Record<string, unknown>[] = [
      { outDir: '/tmp/different-build' },
      { packageName: 'different-app' },
      { target: 'vue' }
    ]

    for (const mismatch of mismatches) {
      const harness = runnerHarness()
      const pending = runMicrofrontendExportCLI(commandOptions(), undefined, harness.dependencies)
      await flushMicrotasks()

      harness.command.emitStdout(resultFixture(mismatch))
      harness.command.emitClose(0)

      await expect(pending).rejects.toThrow(
        'Microfrontend build output does not match the requested build.'
      )
    }
  })
})
