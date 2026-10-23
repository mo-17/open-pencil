/** Serializable real-rendering samples shared by native acceptance and saved Safari fixtures. */
export async function createShaderSamples() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Shader sample editor missing')
  const graph = store.graph
  for (const child of graph.getChildren(store.state.currentPageId)) graph.deleteNode(child.id)
  const root = graph.createNode('FRAME', store.state.currentPageId, {
    name: 'Shader samples',
    x: 40,
    y: 40,
    width: 560,
    height: 180,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }]
  })
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Shader image source context missing')
  context.fillStyle = '#ef3020'
  context.fillRect(0, 0, 96, 96)
  context.fillStyle = '#2030ef'
  context.fillRect(8, 8, 32, 72)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve)
  })
  if (!blob) throw new Error('Shader image source PNG missing')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))
  const imageHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  graph.images.set(imageHash, bytes)
  const image = graph.createNode('RECTANGLE', root.id, {
    name: 'Image sample',
    x: 16,
    y: 16,
    width: 96,
    height: 96,
    fills: [
      {
        type: 'IMAGE',
        imageHash,
        visible: true,
        opacity: 1,
        color: { r: 0, g: 0, b: 0, a: 1 },
        imageScaleMode: 'FILL'
      } satisfies Fill
    ]
  })
  const text = graph.createNode('TEXT', root.id, {
    name: 'Text sample',
    x: 152,
    y: 20,
    width: 190,
    height: 60,
    text: 'Shader TEXT',
    fontSize: 26,
    fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.8, a: 1 }, visible: true, opacity: 1 }]
  })
  const decoration = graph.createNode('FRAME', root.id, {
    name: 'Container sample',
    x: 376,
    y: 16,
    width: 140,
    height: 112,
    clipsContent: true,
    fills: []
  })
  for (let index = 0; index < 4; index++)
    graph.createNode('RECTANGLE', decoration.id, {
      x: 8 + index * 26,
      y: 8 + index * 12,
      width: 20,
      height: 60,
      fills: [
        {
          type: 'SOLID',
          color: { r: index % 2, g: 0.3, b: 1 - (index % 2), a: 1 },
          visible: true,
          opacity: 1
        }
      ]
    })
  for (const node of [image, text, decoration]) store.setContentShader([node.id])
  await store.settleShaderFrames({ nodeIds: [root.id], requireFrames: true })
  store.select([image.id])
  const samples = [image, text, decoration].map((node) => {
    const shaderImage = node.fills.at(-1)?.imageHash
    const saved = shaderImage && graph.images.get(shaderImage)
    if (!shaderImage || !saved?.length) throw new Error(`Shader frame missing: ${node.name}`)
    return { id: node.id, name: node.name, image: shaderImage, saved: [...saved] }
  })
  return { root: root.id, samples }
}
import type { Fill } from '@open-pencil/scene-graph'
