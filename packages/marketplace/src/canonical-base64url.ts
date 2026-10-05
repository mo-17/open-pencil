import { fromUint8Array, isValid, toUint8Array } from 'js-base64'
export interface CanonicalBase64URLOptions {
  expectedLength?: number
  maxEncodedLength?: number
}

export function canonicalBase64URLBytes(
  value: string,
  path: string,
  options: CanonicalBase64URLOptions = {}
): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    (options.maxEncodedLength !== undefined && value.length > options.maxEncodedLength) ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    !isValid(value)
  ) {
    throw new TypeError(`${path} must be base64url without padding`)
  }
  let bytes: Uint8Array
  try {
    bytes = toUint8Array(value)
  } catch {
    throw new TypeError(`${path} must be valid base64url`)
  }
  if (fromUint8Array(bytes, true) !== value) {
    throw new TypeError(`${path} must use canonical base64url encoding`)
  }
  if (options.expectedLength !== undefined && bytes.byteLength !== options.expectedLength) {
    throw new TypeError(`${path} must decode to ${options.expectedLength} bytes`)
  }
  return bytes
}
