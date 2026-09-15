/** Narrow generated pre-decode guard. Bounds match the shared image inspector;
 * browser decoding still validates the actual bitstream after the size check. */
export const VR_TOUR_IMAGE_HEADER_SOURCE = String.raw`
export function panoramaDimensions(bytes: Uint8Array, mime: string, locale: TourLocale = 'en'): readonly [number, number] {
  const copy = tourCopy(locale)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const matches = (at: number, values: readonly number[]) => values.every((value, index) => bytes[at + index] === value)
  const text = (at: number, value: string) => [...value].every((character, index) => bytes[at + index] === character.charCodeAt(0))
  let dimensions: readonly [number, number] | undefined
  if (mime === 'image/png' && bytes.length >= 33 && matches(0, [137,80,78,71,13,10,26,10]) && text(12, 'IHDR') && view.getUint32(8) === 13) {
    dimensions = [view.getUint32(16), view.getUint32(20)]
  } else if (mime === 'image/jpeg' && matches(0, [255,216,255])) {
    let at = 2
    let segments = 0
    const limit = Math.min(bytes.length, 1024 * 1024)
    while (at < limit && segments++ < 4096) {
      if (bytes[at] !== 255) break
      while (at < limit && bytes[at] === 255) at++
      const marker = bytes[at++]
      if (marker === 1 || (marker >= 208 && marker <= 216)) continue
      if (!marker || marker === 217 || marker === 218 || at + 2 > limit) break
      const size = view.getUint16(at)
      if (size < 2 || at + size > bytes.length) break
      if (marker >= 192 && marker <= 207 && ![196,200,204].includes(marker)) {
        if (size >= 7 && at + 7 <= limit) dimensions = [view.getUint16(at + 5), view.getUint16(at + 3)]
        break
      }
      at += size
    }
  } else if (mime === 'image/webp' && bytes.length >= 20 && text(0, 'RIFF') && text(8, 'WEBP')) {
    const declared = view.getUint32(4, true) + 8
    const limit = Math.min(declared, 1024 * 1024)
    if (declared > bytes.length) throw new PanoramaError(copy.invalidWebPHeader)
    let at = 12
    let chunks = 0
    while (at + 8 <= limit && chunks++ < 4096) {
      const size = view.getUint32(at + 4, true)
      const data = at + 8
      if (data + size > declared) break
      if (text(at, 'VP8X') && size >= 10) {
        // Animated WebP is not an equirectangular still image.
        if (bytes[data] & 2) break
        const uint24 = (offset: number) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536
        dimensions = [uint24(data + 4) + 1, uint24(data + 7) + 1]
        break
      }
      if (text(at, 'VP8 ') && size >= 10 && matches(data + 3, [157,1,42])) { dimensions = [view.getUint16(data + 6, true) & 16383, view.getUint16(data + 8, true) & 16383]; break }
      if (text(at, 'VP8L') && size >= 5 && bytes[data] === 47) { const bits = view.getUint32(data + 1, true); dimensions = [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1]; break }
      at = data + size + (size & 1)
    }
  }
  if (!dimensions || dimensions[0] < 512 || dimensions[0] > 8192 || dimensions[1] > 4096 || dimensions[0] !== dimensions[1] * 2) throw new PanoramaError(copy.invalidDimensions)
  return dimensions
}
`
