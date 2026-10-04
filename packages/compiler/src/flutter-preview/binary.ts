import { FLUTTER_PREVIEW_SNAPSHOT_LIMITS as LIMITS, invalidFlutterPreviewSnapshot } from './limits'

const BYTE_LENGTH_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
)

export function previewBinaryLength(input: Uint8Array): number {
  if (Object.getPrototypeOf(input) !== Uint8Array.prototype || !BYTE_LENGTH_DESCRIPTOR?.get)
    return invalidFlutterPreviewSnapshot()
  return BYTE_LENGTH_DESCRIPTOR.get.call(input) as number
}

export function encodePreviewImage(input: Uint8Array): string {
  const length = previewBinaryLength(input)
  if (length === 0 || length > LIMITS.maxImageBytes) return invalidFlutterPreviewSnapshot()
  const bytes = Uint8Array.prototype.slice.call(input) as Uint8Array
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  }
  return btoa(chunks.join(''))
}

export function decodePreviewImage(input: string): Uint8Array {
  const maximumLength = Math.ceil(LIMITS.maxImageBytes / 3) * 4
  if (
    input.length === 0 ||
    input.length > maximumLength ||
    input.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(input)
  )
    return invalidFlutterPreviewSnapshot()
  const binary = atob(input)
  if (binary.length > LIMITS.maxImageBytes || btoa(binary) !== input)
    return invalidFlutterPreviewSnapshot()
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
