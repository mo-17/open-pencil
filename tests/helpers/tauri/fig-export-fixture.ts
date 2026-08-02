import { mockIPC } from '@tauri-apps/api/mocks'

const windowLike = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: unknown
  __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown
}
Object.assign(globalThis, { window: windowLike })

class PayloadReader {
  private offset = 0
  private readonly view: DataView

  constructor(private readonly payload: Uint8Array) {
    this.view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  }

  bytes(length: number): Uint8Array {
    const end = this.offset + length
    if (end > this.payload.byteLength) throw new Error('Raw payload is truncated')
    const value = this.payload.subarray(this.offset, end)
    this.offset = end
    return value
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  done(): boolean {
    return this.offset === this.payload.byteLength
  }
}

let buildCalls = 0
mockIPC((cmd, args) => {
  if (cmd !== 'build_fig_file') throw new Error(`Unexpected command: ${cmd}`)
  if (!(args instanceof Uint8Array)) throw new Error('build_fig_file payload must use raw IPC')
  buildCalls++

  const reader = new PayloadReader(args)
  if (new TextDecoder().decode(reader.bytes(8)) !== 'OPFIGIPC') throw new Error('Invalid magic')
  if (reader.u32() !== 1) throw new Error('Invalid envelope version')
  if (reader.u32() !== 1) throw new Error('Expected fig-kiwi version flag')
  if (reader.u32() !== 77) throw new Error('Expected custom fig-kiwi version')
  const schemaLength = reader.u32()
  const kiwiLength = reader.u32()
  const thumbnailLength = reader.u32()
  const metaLength = reader.u32()
  const imageCount = reader.u32()
  if (schemaLength === 0) throw new Error('schemaDeflated is empty')
  if (kiwiLength === 0) throw new Error('kiwiData is empty')
  if (thumbnailLength === 0) throw new Error('thumbnailPng is empty')
  reader.bytes(schemaLength)
  reader.bytes(kiwiLength)
  reader.bytes(thumbnailLength)
  JSON.parse(new TextDecoder().decode(reader.bytes(metaLength)))
  if (imageCount !== 1) throw new Error(`Expected one image, received ${imageCount}`)
  const nameLength = reader.u32()
  const dataLength = reader.u32()
  if (new TextDecoder().decode(reader.bytes(nameLength)) !== 'images/test-image') {
    throw new Error('Unexpected image name')
  }
  if (!reader.bytes(dataLength).every((value, index) => value === index + 1)) {
    throw new Error('Unexpected image data')
  }
  if (!reader.done()) throw new Error('Raw payload contains trailing data')
  return new Uint8Array([7, 8, 9]).buffer
})

const [{ exportFigFile }, { SceneGraph }] = await Promise.all([
  import('@open-pencil/core/io/formats/fig/export'),
  import('@open-pencil/scene-graph')
])
const graph = new SceneGraph()
graph.figKiwiVersion = 77
graph.images.set('test-image', new Uint8Array([1, 2, 3, 4]))
for (let attempt = 0; attempt < 2; attempt++) {
  const bytes = await exportFigFile(graph)
  if (bytes.length !== 3 || bytes[0] !== 7 || bytes[1] !== 8 || bytes[2] !== 9) {
    throw new Error(`Unexpected export bytes: ${Array.from(bytes).join(',')}`)
  }
}
if (buildCalls !== 2) throw new Error(`Expected two native builds, received ${buildCalls}`)
