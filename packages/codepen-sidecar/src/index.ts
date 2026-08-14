import {
  CODEPEN_SIDECAR_LIMITS,
  CODEPEN_SIDECAR_PROTOCOL_VERSION,
  CodePenSidecarProtocolError,
  parseCodePenSidecarRequest,
  requestIdFromUntrustedJSON,
  type CodePenSidecarRequest,
  type CodePenSidecarResponse,
  type CodePenSidecarSuccessResult
} from './protocol'
import { createCodePenSidecarShowcase, CodePenSidecarRuntimeError } from './runtime'

type ShowcaseBuilder = (request: CodePenSidecarRequest) => Promise<CodePenSidecarSuccessResult>

export async function readCodePenSidecarFrame(
  stream: ReadableStream<Uint8Array> = Bun.stdin.stream()
): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let complete = false
  do {
    const chunk = await reader.read()
    if (chunk.done) {
      throw new CodePenSidecarProtocolError(
        'incomplete-frame',
        'CodePen sidecar request must end with one newline'
      )
    }
    if (chunk.value.includes(0x0d)) {
      await reader.cancel()
      throw new CodePenSidecarProtocolError('invalid-frame', 'Carriage returns are not allowed')
    }
    const newline = chunk.value.indexOf(0x0a)
    const framed = newline === -1 ? chunk.value : chunk.value.subarray(0, newline)
    if (newline !== -1 && newline + 1 !== chunk.value.byteLength) {
      await reader.cancel()
      throw new CodePenSidecarProtocolError(
        'invalid-frame',
        'Only one CodePen sidecar request frame is allowed'
      )
    }
    total += framed.byteLength
    if (total > CODEPEN_SIDECAR_LIMITS.maxStdinBytes) {
      await reader.cancel()
      throw new CodePenSidecarProtocolError('request-limit', 'Request exceeds the stdin byte limit')
    }
    chunks.push(framed)
    if (newline !== -1) {
      await reader.cancel()
      complete = true
    }
  } while (!complete)
  if (total === 0) throw new CodePenSidecarProtocolError('invalid-frame', 'Request frame is empty')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CodePenSidecarProtocolError('invalid-utf8', 'Request must be valid UTF-8')
  }
}

function failureResponse(
  requestId: string,
  error: unknown
): Extract<CodePenSidecarResponse, { ok: false }> {
  if (error instanceof CodePenSidecarProtocolError) {
    return {
      version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
      requestId,
      ok: false,
      error: { code: error.code, message: error.message }
    }
  }
  if (error instanceof CodePenSidecarRuntimeError) {
    return {
      version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
      requestId,
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        diagnostics: error.diagnostics
      }
    }
  }
  return {
    version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: {
      code: 'compile-failed',
      message: 'CodePen sidecar could not compile the generated project'
    }
  }
}

export async function handleCodePenSidecarInput(
  input: string,
  buildShowcase: ShowcaseBuilder = createCodePenSidecarShowcase
): Promise<CodePenSidecarResponse> {
  const untrustedRequestId = requestIdFromUntrustedJSON(input)
  try {
    const request = parseCodePenSidecarRequest(input)
    const result = await buildShowcase(request)
    return {
      version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result
    }
  } catch (error) {
    return failureResponse(untrustedRequestId, error)
  }
}

export async function runCodePenSidecar(): Promise<number> {
  if (Bun.argv.slice(2).length > 0) {
    const response = failureResponse(
      'invalid',
      new CodePenSidecarProtocolError('arguments-forbidden', 'CodePen sidecar accepts no arguments')
    )
    process.stdout.write(`${JSON.stringify(response)}\n`)
    return 2
  }
  let response: CodePenSidecarResponse
  try {
    const input = await readCodePenSidecarFrame()
    response = await handleCodePenSidecarInput(input)
  } catch (error) {
    response = failureResponse('invalid', error)
  }
  const output = JSON.stringify(response)
  if (new TextEncoder().encode(output).byteLength > CODEPEN_SIDECAR_LIMITS.maxOutputBytes) {
    response = failureResponse(
      response.requestId,
      new CodePenSidecarProtocolError('response-limit', 'CodePen sidecar response is too large')
    )
  }
  process.stdout.write(`${JSON.stringify(response)}\n`)
  return response.ok ? 0 : 1
}

if (import.meta.main) process.exitCode = await runCodePenSidecar()
