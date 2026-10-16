type BodyReader = ReadableStreamDefaultReader<Uint8Array>

/** Callers own cancellation, reader release and error classification around this bounded loop. */
export async function collectManagementResponseChunks(
  reader: BodyReader,
  maximum: number,
  read: (reader: BodyReader) => Promise<ReadableStreamReadResult<Uint8Array>>,
  overflow: (reader: BodyReader) => never
) {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  let chunk = await read(reader)
  while (!chunk.done) {
    byteLength += chunk.value.byteLength
    if (byteLength > maximum) return overflow(reader)
    chunks.push(chunk.value)
    chunk = await read(reader)
  }
  return { chunks, byteLength }
}

export function joinManagementResponseChunks(
  chunks: readonly Uint8Array[],
  byteLength: number
): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function parseManagementResponseJSON(bytes: Uint8Array, invalid: () => never): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return invalid()
  }
}

export async function readManagementResponseBytes(
  response: Response,
  maximum: number,
  read: (reader: BodyReader) => Promise<ReadableStreamReadResult<Uint8Array>>,
  invalid: () => never,
  failed: (cause: unknown) => never = (cause) => {
    throw cause
  }
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) return invalid()
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  let collected: Awaited<ReturnType<typeof collectManagementResponseChunks>>
  try {
    collected = await collectManagementResponseChunks(reader, maximum, read, (reader) => {
      void reader.cancel().catch(() => undefined)
      return invalid()
    })
  } catch (cause) {
    void reader.cancel().catch(() => undefined)
    return failed(cause)
  } finally {
    reader.releaseLock()
  }
  return joinManagementResponseChunks(collected.chunks, collected.byteLength)
}

export function validateManagementContentLength(
  response: Response,
  maximum: number,
  invalid: () => never,
  tooLarge: () => never
): void {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0) return invalid()
    if (parsed > maximum) {
      void response.body?.cancel().catch(() => undefined)
      return tooLarge()
    }
  }
}

export async function readManagementJSONBody(
  response: Response,
  maximum: number,
  read: (reader: BodyReader) => Promise<ReadableStreamReadResult<Uint8Array>>,
  fail: (code: 'invalid-response' | 'response-too-large') => never,
  classifyFailure: (cause: unknown) => never,
  afterRead: () => void = () => undefined
): Promise<unknown> {
  validateManagementContentLength(
    response,
    maximum,
    () => fail('invalid-response'),
    () => fail('response-too-large')
  )
  if (!response.body) return fail('invalid-response')
  const reader = response.body.getReader()
  let collected: Awaited<ReturnType<typeof collectManagementResponseChunks>>
  try {
    collected = await collectManagementResponseChunks(reader, maximum, read, () =>
      fail('response-too-large')
    )
    afterRead()
  } catch (cause) {
    void reader.cancel().catch(() => undefined)
    return classifyFailure(cause)
  } finally {
    reader.releaseLock()
  }
  const bytes = joinManagementResponseChunks(collected.chunks, collected.byteLength)
  return parseManagementResponseJSON(bytes, () => fail('invalid-response'))
}
