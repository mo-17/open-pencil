/**
 * Serializable native fixture. These are real PNG saved frames made by Canvas 2D,
 * not WebGPU output; the native test exercises inspector/storage/history delivery.
 */
export async function createNativeShaderPresetFixture(name: string) {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Native Shader preset editor missing')
  store.setShaderRasterizer(null)
  const root = store.graph.createNode('FRAME', store.state.currentPageId, {
    name,
    x: 40,
    y: 40,
    width: 360,
    height: 120,
    fills: []
  })
  const decoration = store.graph.createNode('FRAME', root.id, {
    name: `${name} decoration`,
    x: 8,
    y: 8,
    width: 96,
    height: 64,
    fills: [],
    clipsContent: true
  })
  store.graph.createNode('RECTANGLE', decoration.id, {
    name: `${name} source`,
    x: 8,
    y: 8,
    width: 40,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0.2, b: 0, a: 1 }, visible: true, opacity: 1 }]
  })
  const text = store.graph.createNode('TEXT', root.id, {
    name: `${name} text`,
    text: 'Editable native source',
    x: 128,
    y: 8,
    width: 180,
    height: 48,
    fontSize: 18,
    fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.8, a: 1 }, visible: true, opacity: 1 }]
  })
  const targets = [decoration, text]
  const dimensions = [
    [96, 64],
    [180, 48]
  ]
  const frameBytes: number[] = []
  for (const [index, node] of targets.entries()) {
    store.setContentShader([node.id], {
      components: [{ type: 'Pixelate', props: { scale: index === 0 ? 8 : 4 } }]
    })
    const image = store.graph.getNode(node.id)?.fills.at(-1)?.imageHash
    if (!image) throw new Error('Native own-content Shader output missing')
    const canvas = document.createElement('canvas')
    const [width, height] = dimensions[index]
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Native saved-frame fixture context missing')
    context.fillStyle = index === 0 ? '#ef3020' : '#2040cc'
    context.fillRect(8, 8, 40, 32)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) throw new Error('Native saved-frame fixture PNG missing')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    store.graph.images.set(image, bytes)
    frameBytes.push(bytes.length)
  }
  const ids = targets.map((node) => node.id)
  await store.settleShaderFrames({ nodeIds: ids, requireFrames: true })
  store.select([decoration.id])
  return { mode: 'saved-frame-fixture' as const, root: root.id, ids, frameBytes }
}

/** Only the fixture's authored sources, excluding its last own-content output paint. */
export function nativeShaderPresetSources(ids: string[]) {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Native Shader preset editor missing')
  return ids.map((id) => {
    const node = store.graph.getNode(id)
    if (!node) throw new Error('Native Shader preset target missing')
    const image = node.fills.at(-1)?.imageHash
    if (!image) throw new Error('Native Shader preset saved output missing')
    return {
      id,
      type: node.type,
      text: node.text ?? '',
      width: node.width,
      fills: node.fills.slice(0, -1),
      frameBytes: store.graph.images.get(image)?.length ?? 0,
      children: store.graph.getChildren(id).map((child) => ({
        id: child.id,
        type: child.type,
        text: child.text ?? '',
        width: child.width,
        fills: child.fills
      }))
    }
  })
}

export function selectNativeShaderPresetTargets(ids: string[]) {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Native Shader preset editor missing')
  store.select(ids)
}
