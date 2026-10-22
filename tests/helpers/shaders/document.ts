import { readShaderPaints } from '@open-pencil/scene-graph'

function editor() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Shader document editor missing')
  return store
}

function layer() {
  const node = [...editor().graph.nodes.values()].find((node) => node.name === 'Shader acceptance')
  if (!node) throw new Error('Shader acceptance layer missing')
  return node
}

/** A static decorative subtree, with transparent margins and asymmetric colored details. */
export async function createShaderDocument(savedFixture = false) {
  const store = editor()
  if (savedFixture) store.setShaderRasterizer(null)
  const node = store.graph.createNode('FRAME', store.state.currentPageId, {
    name: 'Shader acceptance',
    x: 80,
    y: 80,
    width: 128,
    height: 96,
    fills: [],
    clipsContent: true,
    exportSettings: [{ format: 'png', scale: 1 }]
  })
  for (let index = 0; index < 6; index++) {
    store.graph.createNode('RECTANGLE', node.id, {
      x: 12 + index * 15,
      y: 12 + index * 6,
      width: 12,
      height: 50,
      fills: [
        {
          type: 'SOLID',
          color: { r: index % 2, g: 0.3, b: 1 - (index % 2), a: 1 },
          visible: true,
          opacity: 1
        }
      ]
    })
  }
  store.setContentShader([node.id])
  if (savedFixture) {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 96
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Saved fixture context missing')
    context.fillStyle = '#e43b12'
    context.fillRect(12, 12, 50, 50)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve)
    })
    const image = node.fills.at(-1)?.imageHash
    if (!blob || !image) throw new Error('Saved fixture frame missing')
    store.graph.images.set(image, new Uint8Array(await blob.arrayBuffer()))
  }
  await store.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
  store.select([node.id])
  return shaderDocumentObservation()
}

/** Deferred synthetic frame results for observing panel feedback and explicit retries. */
export function shaderFrameProbe() {
  const store = editor()
  const image = layer().fills.at(-1)?.imageHash ?? ''
  const saved = store.graph.images.get(image)
  if (!saved) throw new Error('Saved probe frame missing')
  const stats = { calls: 0 }
  let finish: ((bytes: Uint8Array | null) => void) | null = null
  store.setShaderRasterizer({
    render: () => {
      stats.calls++
      return new Promise<Uint8Array | null>((resolve) => {
        finish = resolve
      })
    }
  })
  return {
    stats,
    finish(success: boolean) {
      if (!finish) throw new Error('Probe frame has not started')
      finish(success ? new Uint8Array(saved) : null)
      finish = null
    },
    settle: () => store.settleShaderFrames({ nodeIds: [layer().id], requireFrames: true }),
    close: () => store.setShaderRasterizer(null)
  }
}

export async function settleShaderDocument() {
  await editor().settleShaderFrames({ nodeIds: [layer().id], requireFrames: true })
  return shaderDocumentObservation()
}

export function selectShaderDocument(selected: boolean) {
  const store = editor()
  if (selected) store.select([layer().id])
  else store.clearSelection()
}

/** Deliberately does not settle: the subsequent product save/export must wait for this edit. */
export function editShaderDocument(scale: number, width: number) {
  const store = editor()
  const node = layer()
  store.setShaderPaint([node.id], 'fills', node.fills.length - 1, {
    components: [{ type: 'Pixelate', props: { scale } }]
  })
  store.updateNodeWithUndo(node.id, { width })
}

export async function shaderDocumentObservation() {
  const store = editor()
  const node = layer()
  const shader = readShaderPaints(node).find((shader) => shader.input)
  if (!shader) throw new Error('Content Shader missing')
  const bytes = store.graph.images.get(shader.image)
  const digest = bytes && (await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
  return {
    width: node.width,
    preset: shader.preset,
    frame: shader.frame,
    bytes: bytes?.length ?? 0,
    digest: digest ? [...new Uint8Array(digest)].join(',') : null,
    children: store.graph.getChildren(node.id).length
  }
}

export async function reopenShaderDocument(bytes: number[]) {
  const store = editor()
  await store.openFigFile(new File([new Uint8Array(bytes)], 'shader-acceptance.fig'))
  store.select([layer().id])
  return shaderDocumentObservation()
}

export async function imageObservation(bytes: number[]) {
  const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image observation context missing')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let colored = 0
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index + 3] > 0 && pixels[index] !== pixels[index + 2]) colored++
    return { width: image.width, height: image.height, colored }
  } finally {
    image.close()
  }
}
