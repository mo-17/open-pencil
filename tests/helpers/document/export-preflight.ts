/** Serialized product fixture: a missing image that can be repaired without external resources. */
export function createMissingImageExportFixture() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Editor is not ready')
  const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
    name: 'Missing source',
    x: 40,
    y: 40,
    width: 80,
    height: 60,
    fills: [
      {
        type: 'IMAGE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: '1'.repeat(40),
        imageScaleMode: 'FILL'
      }
    ],
    exportSettings: [{ format: 'png', scale: 1 }]
  })
  store.select([node.id])
  return node.id
}

export async function repairExportFixture(id: string) {
  const store = window.openPencil?.getStore?.()
  const node = store?.graph.getNode(id)
  if (!store || !node) throw new Error('Export fixture is missing')
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image fixture context is unavailable')
  context.fillStyle = 'red'
  context.fillRect(0, 0, 2, 2)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (!blob) throw new Error('Image fixture encoding failed')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))
  const imageHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  store.graph.images.set(imageHash, bytes)
  store.graph.updateNode(id, {
    fills: node.fills.map((paint) => ({ ...paint, imageHash }))
  })
  store.select([id])
}

export async function countRedExportPixels(bytes: number[]): Promise<number> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Export pixel reader is unavailable')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 200 && pixels[i + 1] < 50 && pixels[i + 2] < 50 && pixels[i + 3] > 200)
        count++
    return count
  } finally {
    bitmap.close()
  }
}
