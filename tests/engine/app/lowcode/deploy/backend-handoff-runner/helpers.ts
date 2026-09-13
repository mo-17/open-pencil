import { spyOn } from 'bun:test'

import { Child, Command } from '@tauri-apps/plugin-shell'

import {
  BACKEND_PROVIDER_DEPLOY_READY_PREFIX,
  createBackendProviderCompileHandoff,
  digestBackendProviderCompileHandoff,
  parseBackendProviderDeployMessage,
  type BackendProviderDeployMessage
} from '@open-pencil/compiler/backend'

import { runBackendProviderDeployCommand } from '@/app/lowcode/preview-pane/deploy/backend-handoff-runner'
import type { DeployCLIResult } from '@/app/lowcode/preview-pane/deploy/command'

import { deployMessage, handoffFixture } from '#tests/engine/compiler/backend/handoff/helpers'

export const DEPLOY_RESULT: DeployCLIResult = {
  provider: 'netlify',
  environment: 'preview',
  url: 'https://handoff-test.netlify.app',
  deployId: 'handoff-test',
  fileCount: 2
}

interface RunnerOptions {
  revalidate?: () => void | Promise<void>
  onWrite?: (frame: BackendProviderDeployMessage) => void | Promise<void>
}

const cleanupCallbacks = new Set<() => void>()

export function cleanupRunnerHarnesses(): void {
  for (const cleanup of cleanupCallbacks) cleanup()
  cleanupCallbacks.clear()
}

/** Drain the bounded Promise chain without running wall-clock timers. */
export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

export async function runnerHarness(options: RunnerOptions = {}) {
  const request = createBackendProviderCompileHandoff(handoffFixture().input)
  const ready = parseBackendProviderDeployMessage({
    ...deployMessage(),
    handoffDigest: digestBackendProviderCompileHandoff(request)
  })
  // Use the actual shell event emitters; only the process transport is substituted.
  const command = Command.create('lowcode-preview')
  const child = new Child(1)
  const controller = new AbortController()
  const initialWritten = Promise.withResolvers<undefined>()
  const writes: BackendProviderDeployMessage[] = []
  const write = spyOn(child, 'write').mockImplementation(async (data) => {
    if (typeof data !== 'string' || !data.endsWith('\n')) {
      throw new Error('Expected an LF-framed string')
    }
    const value: unknown = JSON.parse(data)
    if (writes.length === 0 && data === `${JSON.stringify(request)}\n`) {
      initialWritten.resolve(undefined)
      return
    }
    const frame = parseBackendProviderDeployMessage(value)
    writes.push(frame)
    await options.onWrite?.(frame)
  })
  const kill = spyOn(child, 'kill').mockResolvedValue(undefined)
  const spawn = spyOn(command, 'spawn').mockResolvedValue(child)
  const revalidate = options.revalidate ?? (() => undefined)
  const result = runBackendProviderDeployCommand(command, {
    request,
    revalidate,
    signal: controller.signal
  })
  let settled = false
  const outcome = result.then(
    (value) => {
      settled = true
      return { ok: true as const, value }
    },
    (error: unknown) => {
      settled = true
      return { ok: false as const, error }
    }
  )
  function close(code = 0): void {
    command.emit('close', { code, signal: null })
  }
  cleanupCallbacks.add(() => {
    controller.abort()
    close(1)
    spawn.mockRestore()
    write.mockRestore()
    kill.mockRestore()
  })
  await initialWritten.promise
  await flushMicrotasks()
  return {
    command,
    controller,
    ready,
    writes,
    kill,
    outcome,
    settled: () => settled,
    close,
    output(value: string) {
      command.stdout.emit('data', value)
    },
    sendReady(frame: unknown = ready) {
      command.stdout.emit(
        'data',
        `${BACKEND_PROVIDER_DEPLOY_READY_PREFIX}${JSON.stringify(frame)}\n`
      )
    },
    listeners() {
      return {
        stdout: command.stdout.listenerCount('data'),
        stderr: command.stderr.listenerCount('data'),
        close: command.listenerCount('close'),
        error: command.listenerCount('error')
      }
    }
  }
}

export const NO_RUNNER_LISTENERS = { stdout: 0, stderr: 0, close: 0, error: 0 }
