import { fromUint8Array, toUint8Array, isValid } from 'js-base64'

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
  return fromUint8Array(bytes)
}

export function decodePreviewImage(input: string): Uint8Array {
  const maximumLength = Math.ceil(LIMITS.maxImageBytes / 3) * 4
  if (
    input.length === 0 ||
    input.length > maximumLength ||
    input.length % 4 !== 0 ||
    !isValid(input) ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(input)
  )
    return invalidFlutterPreviewSnapshot()
  const bytes = toUint8Array(input)
  if (bytes.length > LIMITS.maxImageBytes || fromUint8Array(bytes) !== input)
    return invalidFlutterPreviewSnapshot()
  return bytes
}
