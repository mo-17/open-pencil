import type { Child, Command } from '@tauri-apps/plugin-shell'

import {
  BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES,
  BACKEND_PROVIDER_DEPLOY_READY_PREFIX,
  digestBackendProviderCompileHandoff,
  parseBackendProviderDeployMessage,
  type BackendProviderDeployMessage
} from '@open-pencil/compiler/backend'

import { decodeTauriStderr } from '@/app/shell/ui'

import type { BackendProviderDeployHandoffOptions } from './backend-handoff'
import { parseDeployCLIResult, type DeployCLIResult } from './command'

const MAX_READY_BYTES = 4096
const MAX_RESULT_BYTES = 1024 * 1024
const MAX_STDERR_LENGTH = 8192
const PREPARE_TIMEOUT_MS = 120_000
const CANCEL_GRACE_MS = 3000

/** No upload authorization was attempted; the caller may report a local preparation failure. */
export class BackendProviderDeployPreDispatchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BackendProviderDeployPreDispatchError'
  }
}

export function runBackendProviderDeployCommand(
  command: Command<string>,
  handoff: BackendProviderDeployHandoffOptions
): Promise<DeployCLIResult> {
  return new Promise((resolve, reject) => {
    const encoder = new TextEncoder()
    let child: Child | null = null
    let requestWrite: Promise<void> | null = null
    let authorizationWrite: Promise<void> | null = null
    let handoffDigest = ''
    let settled = false
    let closed = false
    let killStarted = false
    let readySeen = false
    let readyFrame: BackendProviderDeployMessage | null = null
    let pendingFailure: Error | null = null
    let cancelTimer: ReturnType<typeof setTimeout> | undefined
    let authorizeStarted = false
    let pending = ''
    let stdout = ''
    let stdoutBytes = 0
    let stderr = ''
    const timer = setTimeout(
      () => fail(new Error('Backend Provider deployment preparation timed out.')),
      PREPARE_TIMEOUT_MS
    )

    function cleanup(): void {
      clearTimeout(timer)
      clearTimeout(cancelTimer)
      handoff.signal?.removeEventListener('abort', onAbort)
      command.stdout.off('data', onStdout)
      command.stderr.off('data', onStderr)
      command.off('close', onClose)
      command.off('error', onError)
    }

    function stopChild(): void {
      if (!child || closed || killStarted) return
      killStarted = true
      void child.kill().catch(() => undefined)
    }

    function finishFailure(error: Error): void {
      if (settled) return
      settled = true
      cleanup()
      stopChild()
      reject(
        authorizeStarted
          ? error
          : new BackendProviderDeployPreDispatchError(error.message, { cause: error })
      )
    }

    function fail(cause: unknown): void {
      if (settled || pendingFailure) return
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (readyFrame && child && !authorizeStarted && !closed) {
        pendingFailure = error
        clearTimeout(timer)
        handoff.signal?.removeEventListener('abort', onAbort)
        cancelTimer = setTimeout(() => finishFailure(error), CANCEL_GRACE_MS)
        // Cooperative cancellation lets the CLI run its temporary-directory finally.
        void cancelPrepared(readyFrame).catch(() => finishFailure(error))
        return
      }
      finishFailure(error)
    }

    async function cancelPrepared(ready: BackendProviderDeployMessage): Promise<void> {
      await requestWrite
      if (!child || settled || closed) return
      await child.write(`${JSON.stringify({ ...ready, stage: 'cancel' })}\n`)
    }

    function onAbort(): void {
      fail(new Error('Backend Provider deployment was cancelled.'))
    }

    function preparationStopped(): boolean {
      return settled || pendingFailure !== null
    }

    async function authorize(ready: BackendProviderDeployMessage): Promise<void> {
      if (!requestWrite || !child) throw new Error('Unexpected Backend Provider ready message.')
      await requestWrite
      if (preparationStopped()) return
      const validation = handoff.revalidate()
      if (validation !== undefined) await validation
      if (preparationStopped()) return
      if (handoff.signal?.aborted) return onAbort()
      // A write may reach the CLI even when its Promise rejects. From here the outcome is unknown.
      authorizeStarted = true
      clearTimeout(timer)
      authorizationWrite = child.write(`${JSON.stringify({ ...ready, stage: 'authorize' })}\n`)
      await authorizationWrite
    }

    function appendResult(value: string): void {
      if (value.length > MAX_RESULT_BYTES - stdoutBytes) {
        throw new Error('Deploy output is too large.')
      }
      stdoutBytes += encoder.encode(value).byteLength
      if (stdoutBytes > MAX_RESULT_BYTES) throw new Error('Deploy output is too large.')
      stdout += value
      if (
        stdout.startsWith(BACKEND_PROVIDER_DEPLOY_READY_PREFIX) ||
        stdout.includes(`\n${BACKEND_PROVIDER_DEPLOY_READY_PREFIX}`)
      ) {
        throw new Error('Duplicate Backend Provider ready message.')
      }
    }

    function onStdout(raw: Uint8Array | number[] | string): void {
      if (settled || pendingFailure) return
      try {
        const value = typeof raw === 'string' ? raw : decodeTauriStderr(raw)
        if (readySeen) return appendResult(value)
        if (pending.length + value.length > MAX_READY_BYTES + MAX_RESULT_BYTES + 1) {
          throw new Error('Deploy output is too large.')
        }
        pending += value
        const newline = pending.indexOf('\n')
        const firstLine = newline === -1 ? pending : pending.slice(0, newline)
        if (encoder.encode(firstLine).byteLength > MAX_READY_BYTES) {
          throw new Error('Backend Provider ready message is too large.')
        }
        if (newline === -1) return
        if (!firstLine.startsWith(BACKEND_PROVIDER_DEPLOY_READY_PREFIX)) {
          throw new Error('Expected Backend Provider ready message before deploy output.')
        }
        const ready = parseBackendProviderDeployMessage(
          JSON.parse(firstLine.slice(BACKEND_PROVIDER_DEPLOY_READY_PREFIX.length))
        )
        if (ready.stage !== 'ready' || ready.handoffDigest !== handoffDigest) {
          throw new Error('Backend Provider ready message does not match this deployment.')
        }
        readySeen = true
        readyFrame = ready
        appendResult(pending.slice(newline + 1))
        pending = ''
        void authorize(ready).catch(fail)
      } catch (cause) {
        fail(cause)
      }
    }

    function onStderr(raw: Uint8Array | number[] | string): void {
      const value = typeof raw === 'string' ? raw : decodeTauriStderr(raw)
      stderr = `${stderr}${value}`.slice(-MAX_STDERR_LENGTH)
    }

    function onClose(data: { code: number | null }): void {
      closed = true
      if (settled) return
      if (pendingFailure) return finishFailure(pendingFailure)
      if (!authorizeStarted || data.code !== 0) {
        fail(
          new Error(
            stderr.trim() ||
              (authorizeStarted
                ? `Deploy failed (exit code ${data.code ?? 'null'}).`
                : 'Backend Provider deployment ended before upload authorization.')
          )
        )
        return
      }
      void finishAuthorized().catch(fail)
    }

    async function finishAuthorized(): Promise<void> {
      // Native close can arrive before the stdin write acknowledgement settles.
      await Promise.resolve()
      if (!authorizationWrite) throw new Error('Upload authorization was not written.')
      await authorizationWrite
      if (settled) return
      const result = parseDeployCLIResult(stdout.trim())
      settled = true
      cleanup()
      resolve(result)
    }

    function onError(error: string): void {
      if (pendingFailure) return finishFailure(pendingFailure)
      fail(new Error(error))
    }

    command.stdout.on('data', onStdout)
    command.stderr.on('data', onStderr)
    command.on('close', onClose)
    command.on('error', onError)
    handoff.signal?.addEventListener('abort', onAbort, { once: true })
    if (handoff.signal?.aborted) {
      onAbort()
      return
    }
    let frame: string
    try {
      handoffDigest = digestBackendProviderCompileHandoff(handoff.request)
      frame = `${JSON.stringify(handoff.request)}\n`
      if (encoder.encode(frame).byteLength > BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES + 1) {
        throw new Error('Backend Provider deployment request is too large.')
      }
    } catch (cause) {
      fail(cause)
      return
    }
    async function spawn(): Promise<void> {
      child = await command.spawn()
      if (settled) return stopChild()
      if (handoff.signal?.aborted) return onAbort()
      requestWrite = child.write(frame)
      await requestWrite
    }
    void spawn().catch(fail)
  })
}
