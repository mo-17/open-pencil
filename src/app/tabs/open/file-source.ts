export interface DeferredOpenFile {
  name: string
  type?: string
  read: () => Promise<Uint8Array>
}

export type OpenFileSource = File | DeferredOpenFile

export function isDeferredOpenFile(source: OpenFileSource): source is DeferredOpenFile {
  return 'read' in source
}

export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
