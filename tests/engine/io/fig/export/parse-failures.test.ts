import { describe, expect, test } from 'bun:test'

import { parseFigKiwiContainer } from '@open-pencil/kiwi/fig/parse'

/** Build a minimal fig-kiwi container with an uncompressed data chunk. */
function buildRawFigKiwi(): { container: Uint8Array; dataRaw: Uint8Array } {
  const schemaDeflated = new Uint8Array([0x78, 0x01, 0x01, 0x00, 0x00]) // minimal deflate
  // Data chunk: random bytes that are neither valid zlib nor valid zstd
  const dataRaw = new Uint8Array(32)
  for (let i = 0; i < dataRaw.length; i++) dataRaw[i] = (i * 37) & 0xff

  const header = new TextEncoder().encode('fig-kiwi')

  const total = 8 + 4 + 4 + schemaDeflated.length + 4 + dataRaw.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  let offset = 0
  out.set(header, offset)
  offset += 8
  view.setUint32(offset, 101, true)
  offset += 4
  view.setUint32(offset, schemaDeflated.length, true)
  offset += 4
  out.set(schemaDeflated, offset)
  offset += schemaDeflated.length
  view.setUint32(offset, dataRaw.length, true)
  offset += 4
  out.set(dataRaw, offset)

  return { container: out, dataRaw }
}

describe('parseFigKiwiContainer: decompression failures', () => {
  test('preserves raw data chunks when deflate decoding is unavailable', () => {
    const { container, dataRaw } = buildRawFigKiwi()
    expect(parseFigKiwiContainer(container)?.dataRaw).toEqual(dataRaw)
  })

  test('returns null for missing header', () => {
    const buf = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    expect(parseFigKiwiContainer(buf)).toBeNull()
  })

  test('returns null for fewer than 2 chunks', () => {
    const header = new TextEncoder().encode('fig-kiwi')
    const schemaDeflated = new Uint8Array([0x78, 0x01])
    // No data chunk — only one chunk total

    const total = 8 + 4 + 4 + schemaDeflated.length
    const out = new Uint8Array(total)
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    let offset = 0
    out.set(header, offset)
    offset += 8
    view.setUint32(offset, 101, true)
    offset += 4
    view.setUint32(offset, schemaDeflated.length, true)
    offset += 4
    out.set(schemaDeflated, offset)

    expect(parseFigKiwiContainer(out)).toBeNull()
  })
})
