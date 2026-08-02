const NATIVE_FIG_BUILD_MAGIC = new TextEncoder().encode('OPFIGIPC')
const NATIVE_FIG_BUILD_VERSION = 1
const FIG_KIWI_VERSION_PRESENT = 1
const FIXED_HEADER_BYTES = NATIVE_FIG_BUILD_MAGIC.byteLength + 8 * Uint32Array.BYTES_PER_ELEMENT
const IMAGE_HEADER_BYTES = 2 * Uint32Array.BYTES_PER_ELEMENT
const MAX_U32 = 0xffff_ffff

export interface NativeFigBuildPayload {
  schemaDeflated: Uint8Array
  kiwiData: Uint8Array
  thumbnailPng: Uint8Array
  metaJson: string
  images: readonly { name: string; data: Uint8Array }[]
  figKiwiVersion?: number
}

function assertU32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) {
    throw new RangeError(`${label} exceeds the native .fig payload limit`)
  }
  return value
}

function checkedTotal(total: number, increment: number): number {
  const next = total + increment
  if (!Number.isSafeInteger(next) || next > MAX_U32) {
    throw new RangeError('Native .fig payload exceeds 4 GiB')
  }
  return next
}

/**
 * Pack the Tauri `.fig` build request into one raw IPC body. Passing nested
 * `number[]` values makes WKWebView stringify every byte as JSON, multiplying a
 * 10 MB image-heavy document into tens of MB of transient strings and arrays.
 */
export function encodeNativeFigBuildPayload(input: NativeFigBuildPayload): Uint8Array {
  const encoder = new TextEncoder()
  const metaBytes = encoder.encode(input.metaJson)
  const images = input.images.map((image) => ({
    name: encoder.encode(image.name),
    data: image.data
  }))

  assertU32(input.schemaDeflated.byteLength, 'Schema')
  assertU32(input.kiwiData.byteLength, 'Kiwi data')
  assertU32(input.thumbnailPng.byteLength, 'Thumbnail')
  assertU32(metaBytes.byteLength, 'Metadata')
  assertU32(images.length, 'Image count')

  let total = FIXED_HEADER_BYTES
  total = checkedTotal(total, input.schemaDeflated.byteLength)
  total = checkedTotal(total, input.kiwiData.byteLength)
  total = checkedTotal(total, input.thumbnailPng.byteLength)
  total = checkedTotal(total, metaBytes.byteLength)
  for (const image of images) {
    assertU32(image.name.byteLength, 'Image name')
    assertU32(image.data.byteLength, 'Image data')
    total = checkedTotal(total, IMAGE_HEADER_BYTES)
    total = checkedTotal(total, image.name.byteLength)
    total = checkedTotal(total, image.data.byteLength)
  }

  const payload = new Uint8Array(total)
  const view = new DataView(payload.buffer)
  payload.set(NATIVE_FIG_BUILD_MAGIC)
  let offset = NATIVE_FIG_BUILD_MAGIC.byteLength
  const writeU32 = (value: number): void => {
    view.setUint32(offset, value, true)
    offset += Uint32Array.BYTES_PER_ELEMENT
  }
  const writeBytes = (value: Uint8Array): void => {
    payload.set(value, offset)
    offset += value.byteLength
  }

  writeU32(NATIVE_FIG_BUILD_VERSION)
  writeU32(input.figKiwiVersion === undefined ? 0 : FIG_KIWI_VERSION_PRESENT)
  writeU32(assertU32(input.figKiwiVersion ?? 0, 'figKiwiVersion'))
  writeU32(input.schemaDeflated.byteLength)
  writeU32(input.kiwiData.byteLength)
  writeU32(input.thumbnailPng.byteLength)
  writeU32(metaBytes.byteLength)
  writeU32(images.length)
  writeBytes(input.schemaDeflated)
  writeBytes(input.kiwiData)
  writeBytes(input.thumbnailPng)
  writeBytes(metaBytes)
  for (const image of images) {
    writeU32(image.name.byteLength)
    writeU32(image.data.byteLength)
    writeBytes(image.name)
    writeBytes(image.data)
  }
  return payload
}
