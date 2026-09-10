import { parseSupabaseBackfillInspectionWireRequestV1 } from '@open-pencil/compiler/backend'

import {
  BACKEND_COMPILER_SIDECAR_LIMITS,
  BackendCompilerSidecarError,
  backendCompilerSidecarFailure,
  backendCompilerSidecarSuccess,
  byteLength,
  canonicalBackendCompilerSidecarJSON,
  type BackendCompilerSidecarResponseV1
} from './protocol'
import { createSupabaseBackfillInspectionFromWire } from './runtime'

type CompilerWireResult = ReturnType<typeof createSupabaseBackfillInspectionFromWire>
type CompilerWireHandler = (input: string) => CompilerWireResult

interface HandledBackendCompilerSidecarInput {
  readonly response: BackendCompilerSidecarResponseV1<CompilerWireResult>
  readonly validatedRequestNonce: string | null
}

export async function readBackendCompilerSidecarFrame(
  stream: ReadableStream<Uint8Array> = Bun.stdin.stream()
): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    let chunk = await reader.read()
    while (!chunk.done) {
      total += chunk.value.byteLength
      if (total > BACKEND_COMPILER_SIDECAR_LIMITS.maxStdinBytes + 1) {
        throw new BackendCompilerSidecarError('request-limit')
      }
      chunks.push(chunk.value)
      chunk = await reader.read()
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }

  if (total === 0) throw new BackendCompilerSidecarError('incomplete-frame')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (bytes.at(-1) !== 0x0a) {
    throw new BackendCompilerSidecarError('incomplete-frame')
  }
  const payload = bytes.subarray(0, -1)
  if (payload.byteLength === 0 || payload.includes(0x0a) || payload.includes(0x0d)) {
    throw new BackendCompilerSidecarError('invalid-frame')
  }
  if (payload.byteLength > BACKEND_COMPILER_SIDECAR_LIMITS.maxStdinBytes) {
    throw new BackendCompilerSidecarError('request-limit')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payload)
  } catch {
    throw new BackendCompilerSidecarError('invalid-utf8')
  }
}

function handleInput(
  input: string,
  handler: CompilerWireHandler = createSupabaseBackfillInspectionFromWire
): HandledBackendCompilerSidecarInput {
  let parsed: ReturnType<typeof parseSupabaseBackfillInspectionWireRequestV1>
  try {
    parsed = parseSupabaseBackfillInspectionWireRequestV1(input)
  } catch {
    return Object.freeze({
      response: backendCompilerSidecarFailure(null, 'invalid-request'),
      validatedRequestNonce: null
    })
  }
  const validatedRequestNonce = parsed.request.requestNonce
  try {
    return Object.freeze({
      response: backendCompilerSidecarSuccess(validatedRequestNonce, handler(input)),
      validatedRequestNonce
    })
  } catch (error) {
    return Object.freeze({
      response: backendCompilerSidecarFailure(
        validatedRequestNonce,
        error instanceof BackendCompilerSidecarError ? error.code : 'inspection-failed'
      ),
      validatedRequestNonce
    })
  }
}

export function handleBackendCompilerSidecarInput(
  input: string,
  handler: CompilerWireHandler = createSupabaseBackfillInspectionFromWire
): BackendCompilerSidecarResponseV1<CompilerWireResult> {
  return handleInput(input, handler).response
}

function serializedResponse(handled: HandledBackendCompilerSidecarInput): string {
  let output: string
  try {
    output = canonicalBackendCompilerSidecarJSON(handled.response)
  } catch {
    return canonicalBackendCompilerSidecarJSON(
      backendCompilerSidecarFailure(handled.validatedRequestNonce, 'response-limit')
    )
  }
  if (byteLength(output) <= BACKEND_COMPILER_SIDECAR_LIMITS.maxOutputBytes) return output
  return canonicalBackendCompilerSidecarJSON(
    backendCompilerSidecarFailure(handled.validatedRequestNonce, 'response-limit')
  )
}

/** Canonical output helper used by the process entry and adversarial boundary tests. */
export function serializeBackendCompilerSidecarInput(
  input: string,
  handler: CompilerWireHandler = createSupabaseBackfillInspectionFromWire
): string {
  return serializedResponse(handleInput(input, handler))
}

export async function runBackendCompilerSidecar(): Promise<number> {
  let handled: HandledBackendCompilerSidecarInput
  if (Bun.argv.slice(2).length > 0) {
    handled = Object.freeze({
      response: backendCompilerSidecarFailure(null, 'arguments-forbidden'),
      validatedRequestNonce: null
    })
  } else {
    try {
      const input = await readBackendCompilerSidecarFrame()
      handled = handleInput(input)
    } catch (error) {
      handled = Object.freeze({
        response: backendCompilerSidecarFailure(
          null,
          error instanceof BackendCompilerSidecarError ? error.code : 'invalid-frame'
        ),
        validatedRequestNonce: null
      })
    }
  }
  process.stdout.write(`${serializedResponse(handled)}\n`)
  return handled.response.ok ? 0 : 1
}

export * from './protocol'
export * from './runtime'

if (import.meta.main) process.exitCode = await runBackendCompilerSidecar()
