/** Return a copy of an sfnt font with the OpenType OS/2 fsType field replaced. */
export function fontBytesWithFsType(bytes: ArrayBuffer, fsType: number): ArrayBuffer {
  const copy = bytes.slice(0)
  const view = new DataView(copy)
  if (view.byteLength < 12) throw new Error('Font fixture has no sfnt table directory')
  const tableCount = view.getUint16(4)
  for (let index = 0; index < tableCount; index++) {
    const recordOffset = 12 + index * 16
    if (recordOffset + 16 > view.byteLength) break
    const tag = String.fromCharCode(
      view.getUint8(recordOffset),
      view.getUint8(recordOffset + 1),
      view.getUint8(recordOffset + 2),
      view.getUint8(recordOffset + 3)
    )
    if (tag !== 'OS/2') continue
    const tableOffset = view.getUint32(recordOffset + 8)
    const fsTypeOffset = tableOffset + 8
    if (fsTypeOffset + 2 > view.byteLength)
      throw new Error('Font fixture has a truncated OS/2 table')
    view.setUint16(fsTypeOffset, fsType)
    return copy
  }
  throw new Error('Font fixture has no OS/2 table')
}
