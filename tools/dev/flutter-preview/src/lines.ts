import { FlutterPreviewError } from './errors'

/** Byte budgets apply before decoding or parsing; partial UTF-8 bytes may span chunks. */
export async function* boundedLines(
  source: AsyncIterable<Uint8Array | string>,
  maximumBytes: number
): AsyncGenerator<string> {
  let storage = new Uint8Array(0)
  let bytes = 0
  const decode = () => {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(storage.subarray(0, bytes))
    bytes = 0
    return value.endsWith('\r') ? value.slice(0, -1) : value
  }
  for await (const chunk of source) {
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    let start = 0
    for (let index = 0; index <= data.length; index++) {
      if (index !== data.length && data[index] !== 10) continue
      const part = data.subarray(start, index)
      const nextBytes = bytes + part.length
      if (nextBytes > maximumBytes) {
        throw new FlutterPreviewError(
          'flutter-preview-line-limit',
          'Flutter preview input exceeded its line byte budget.'
        )
      }
      if (nextBytes > storage.length) {
        const grown = new Uint8Array(
          Math.min(maximumBytes, Math.max(nextBytes, storage.length * 2, 1_024))
        )
        grown.set(storage.subarray(0, bytes))
        storage = grown
      }
      storage.set(part, bytes)
      bytes = nextBytes
      if (index < data.length) yield decode()
      start = index + 1
    }
  }
  if (bytes > 0) yield decode()
}
