export function exactArrayBuffer(content: Uint8Array): ArrayBuffer {
  if (
    content.buffer instanceof ArrayBuffer &&
    content.byteOffset === 0 &&
    content.byteLength === content.buffer.byteLength
  ) {
    return content.buffer
  }
  const copy = new Uint8Array(content.byteLength)
  copy.set(content)
  return copy.buffer
}
