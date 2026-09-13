import { createHash, randomUUID } from 'node:crypto'
import process from 'node:process'
import type { Readable } from 'node:stream'

import {
  BACKEND_PROVIDER_DEPLOY_READY_PREFIX,
  BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES,
  digestBackendProviderCompileHandoff,
  parseBackendProviderCompileHandoff,
  parseBackendProviderDeployMessage,
  type BackendProviderCompileHandoff,
  type BackendProviderDeployMessage
} from '@open-pencil/compiler/backend'
const AUTHORIZATION_MAX_BYTES = 4096
const FRAME_TIMEOUT_MS = 30_000

interface PendingFrame {
  readonly resolve: (value: string) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly maxBytes: number
}

/** A single child's explicit input channel, never proof of installed App authority. */
export class BackendProviderInput {
  private pending: PendingFrame | undefined
  private chunks: Buffer[] = []
  private byteLength = 0
  private failure: Error | undefined
  private closed = false
  private phase: 'initial' | 'building' | 'authorizing' | 'authorized' = 'initial'
  private request: BackendProviderCompileHandoff | undefined

  constructor(
    private readonly input: Readable = process.stdin,
    private readonly timeoutMs = FRAME_TIMEOUT_MS
  ) {
    input.on('data', this.onData)
    input.on('end', this.onEnd)
    input.on('error', this.onError)
    // Attach listeners without accepting input before the first expected frame.
    input.pause()
  }

  private readonly onData = (value: Buffer | string): void => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value
    const pending = this.pending
    if (!pending) {
      this.fail('Unexpected Backend Provider input before an authorization request.')
      return
    }
    const newline = bytes.indexOf(10)
    const length = newline === -1 ? bytes.length : newline
    if (this.byteLength + length > pending.maxBytes) {
      this.fail('Backend Provider input exceeds its byte limit.')
      return
    }
    this.chunks.push(bytes.subarray(0, length))
    this.byteLength += length
    if (newline === -1) return
    if (newline !== bytes.length - 1) {
      this.fail('Backend Provider input must contain exactly one expected frame.')
      return
    }
    let line: string
    try {
      line = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(this.chunks))
      if (line.includes('\r')) throw new Error('Unexpected carriage return')
    } catch {
      this.fail('Backend Provider input must be one UTF-8 JSON line.')
      return
    }
    this.pending = undefined
    this.chunks = []
    this.byteLength = 0
    clearTimeout(pending.timer)
    pending.resolve(line)
  }

  private readonly onEnd = (): void => {
    this.fail('Backend Provider input closed before upload authorization.')
  }

  private readonly onError = (): void => {
    this.fail('Backend Provider input failed before upload authorization.')
  }

  private fail(message: string): void {
    this.failure ??= new Error(message)
    const pending = this.pending
    this.pending = undefined
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(this.failure)
    }
    this.dispose()
  }

  private assertOpen(): void {
    if (this.failure) throw this.failure
    if (this.closed) throw new Error('Backend Provider input is closed.')
  }

  private readFrame(maxBytes: number): Promise<string> {
    this.assertOpen()
    if (this.pending) throw new Error('A Backend Provider input frame is already pending.')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail('Timed out waiting for Backend Provider input; nothing was uploaded.')
      }, this.timeoutMs)
      this.pending = { resolve, reject, timer, maxBytes }
      this.input.resume()
    })
  }

  async readRequest(): Promise<BackendProviderCompileHandoff> {
    if (this.phase !== 'initial') throw new Error('Backend Provider request was already consumed.')
    const line = await this.readFrame(BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES)
    this.assertOpen()
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error('Backend Provider input is not valid JSON.')
    }
    this.request = parseBackendProviderCompileHandoff(value)
    this.phase = 'building'
    return this.request
  }

  /** Wait for a fresh Host decision after building the exact bytes about to be uploaded. */
  async authorizeUpload(
    dispatchDigest: string,
    writeReady: (line: string) => void = (line) => process.stdout.write(line)
  ): Promise<void> {
    this.assertOpen()
    if (this.phase !== 'building' || !this.request) {
      throw new Error('Backend Provider upload authorization is out of order.')
    }
    this.phase = 'authorizing'
    const ready: BackendProviderDeployMessage = {
      format: 'openpencil.backend-provider-deploy.v1',
      stage: 'ready',
      handoffDigest: digestBackendProviderCompileHandoff(this.request),
      dispatchDigest,
      challenge: randomUUID()
    }
    const response = this.readFrame(AUTHORIZATION_MAX_BYTES)
    // Install the receiver first: even an immediate matching reply cannot be lost.
    try {
      writeReady(`${BACKEND_PROVIDER_DEPLOY_READY_PREFIX}${JSON.stringify(ready)}\n`)
    } catch {
      this.fail('Could not request Backend Provider upload authorization.')
    }
    const line = await response
    this.assertOpen()
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error('Backend Provider upload authorization is not valid JSON.')
    }
    const authorization = parseBackendProviderDeployMessage(value)
    if (
      authorization.stage === 'ready' ||
      authorization.handoffDigest !== ready.handoffDigest ||
      authorization.dispatchDigest !== ready.dispatchDigest ||
      authorization.challenge !== ready.challenge
    ) {
      throw new Error('Backend Provider upload authorization does not match this build.')
    }
    if (authorization.stage === 'cancel') {
      throw new Error('Backend Provider deployment was cancelled before upload.')
    }
    this.phase = 'authorized'
    this.dispose()
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(new Error('Backend Provider input was disposed.'))
      this.pending = undefined
    }
    this.chunks = []
    this.input.pause()
    this.input.off('data', this.onData)
    this.input.off('end', this.onEnd)
    this.input.off('error', this.onError)
  }
}

/** Content binding only; caller passes public deployment settings, never provider credentials. */
export function backendProviderDispatchDigest(
  files: ReadonlyMap<string, Uint8Array>,
  publicSettings: string
): string {
  const entries = [...files]
    .sort(([left], [right]) => {
      if (left === right) return 0
      return left < right ? -1 : 1
    })
    .map(([path, bytes]) => ({
      path,
      byteLength: bytes.byteLength,
      digest: createHash('sha256').update(bytes).digest('base64url')
    }))
  return createHash('sha256')
    .update(JSON.stringify({ settings: publicSettings, files: entries }))
    .digest('base64url')
}
