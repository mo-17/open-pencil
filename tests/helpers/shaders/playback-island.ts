/** Serializable setup shared by browser and the native test WebView; no module closures. */
export async function createShaderPlaybackIsland() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Shader island editor missing')
  for (const child of store.graph.getChildren(store.state.currentPageId))
    store.graph.deleteNode(child.id)
  const graph = store.graph
  const root = graph.createNode('FRAME', store.state.currentPageId, {
    name: 'Shader island',
    x: 40,
    y: 40,
    width: 400,
    height: 200,
    fills: []
  })
  const decoration = graph.createNode('FRAME', root.id, {
    name: 'Live decoration',
    x: 10,
    y: 10,
    width: 128,
    height: 96,
    fills: [],
    clipsContent: true
  })
  for (let i = 0; i < 5; i++)
    graph.createNode('RECTANGLE', decoration.id, {
      x: 8 + i * 20,
      y: 8 + i * 8,
      width: 16,
      height: 40,
      fills: [
        {
          type: 'SOLID',
          color: { r: i % 2, g: 0.3, b: 1 - (i % 2), a: 1 },
          visible: true,
          opacity: 1
        }
      ]
    })
  store.setContentShader([decoration.id])
  store.setShaderPaint([decoration.id], 'fills', 0, {
    components: [{ type: 'WaveDistortion', props: { strength: 0.3, frequency: 2, speed: 1 } }]
  })
  await store.settleShaderFrames({ nodeIds: [decoration.id], requireFrames: true })
  const image = graph.getNode(decoration.id)?.fills.at(-1)?.imageHash
  if (!image) throw new Error('Shader island saved frame missing')
  const saved = [...(graph.images.get(image) ?? [])]
  const field = graph.createNode('COMPONENT', store.state.currentPageId, {
    name: 'Field',
    x: -1000,
    width: 160,
    height: 36,
    componentPropertyDefinitions: [
      { id: 'value', name: 'Value', type: 'TEXT', defaultValue: 'Name' }
    ]
  })
  graph.createNode('TEXT', field.id, {
    x: 8,
    y: 8,
    width: 140,
    height: 20,
    text: 'Name',
    componentPropertyReferences: [{ propertyId: 'value', field: 'TEXT' }]
  })
  store.setBehaviour(field.id, {
    kind: 'textField',
    booleans: {},
    texts: { value: { propertyId: 'value' } },
    numbers: {},
    parts: {}
  })
  graph.createInstance(field.id, root.id, { x: 180, y: 20 })
  // Freeze the persisted fallback. Playback must capture independently, without saving live frames.
  store.setShaderRasterizer(null)
  store.select([])
  store.startPlay()
  return { root: root.id, decoration: decoration.id, image, saved }
}

/** Read actual island pixels; animation and source edits are observable in both WebViews. */
export function shaderIslandPixels() {
  const canvas = document.querySelector('[data-island]')?.shadowRoot?.querySelector('canvas')
  const context = canvas?.getContext('2d', { willReadFrequently: true })
  if (!canvas || !context) return { png: '', colored: 0, green: 0, width: 0, height: 0 }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let colored = 0
  let green = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0) colored++
    if (pixels[i + 1] > 180 && pixels[i] < 80 && pixels[i + 2] < 80) green++
  }
  return { png: canvas.toDataURL(), colored, green, width: canvas.width, height: canvas.height }
}
