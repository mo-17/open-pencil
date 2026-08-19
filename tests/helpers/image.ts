const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

export function pngSignatureBytes(...payload: number[]): Uint8Array {
  return new Uint8Array([...PNG_SIGNATURE, ...payload])
}

export function sizedPNGSignatureBytes(byteLength: number): Uint8Array {
  if (byteLength < PNG_SIGNATURE.length) {
    throw new RangeError('PNG fixture is shorter than its signature')
  }
  const bytes = new Uint8Array(byteLength)
  bytes.set(PNG_SIGNATURE)
  return bytes
}
