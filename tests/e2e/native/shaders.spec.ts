import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'

describe('native Shader save and reopen', () => {
  for (const mode of ['webgpu', 'saved-fixture'] as const) {
    it(`${mode}: retains a usable content frame through native file I/O`, async function () {
      await openNativeEditorDocument()
      const capable = await browser.execute(async () => {
        const gpu: { requestAdapter(): Promise<unknown | null> } | undefined = Reflect.get(
          navigator,
          'gpu'
        )
        return gpu ? Boolean(await gpu.requestAdapter()) : false
      })
      if (mode === 'webgpu' && !capable) return this.skip()
      const directory = await mkdtemp(join(tmpdir(), 'open-pencil-native-shader-'))
      try {
        const path = join(directory, 'shader.fig')
        const before = await browser.execute(
          async (mode, path) => {
            const store = window.openPencil?.getStore?.()
            if (!store) throw new Error('Native editor missing')
            if (mode === 'saved-fixture') store.setShaderRasterizer(null)
            const node = store.graph.createNode('FRAME', store.state.currentPageId, {
              name: 'Native Shader',
              x: 60,
              y: 60,
              width: 120,
              height: 90,
              fills: [],
              clipsContent: true
            })
            store.graph.createNode('RECTANGLE', node.id, {
              x: 12,
              y: 12,
              width: 50,
              height: 50,
              fills: [
                { type: 'SOLID', color: { r: 1, g: 0.2, b: 0, a: 1 }, visible: true, opacity: 1 }
              ]
            })
            store.setContentShader([node.id])
            const image = store.graph.getNode(node.id)?.fills.at(-1)?.imageHash
            if (!image) throw new Error('Native content paint missing')
            if (mode === 'saved-fixture') {
              // A known saved PNG tests unavailable-host fallback, not real GPU generation.
              const canvas = document.createElement('canvas')
              canvas.width = 120
              canvas.height = 90
              const context = canvas.getContext('2d')
              if (!context) throw new Error('Native fixture context missing')
              context.fillStyle = '#e43b12'
              context.fillRect(12, 12, 50, 50)
              const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve)
              })
              if (!blob) throw new Error('Native fixture PNG missing')
              store.graph.images.set(image, new Uint8Array(await blob.arrayBuffer()))
            }
            await store.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
            const initial = [...(store.graph.images.get(image) ?? [])]
            store.setShaderPaint([node.id], 'fills', 0, {
              components: [{ type: 'Pixelate', props: { scale: 8 } }]
            })
            store.graph.updateNode(node.id, { width: 140 })
            const saved = await store.saveFigFileToPath(path)
            return {
              id: node.id,
              image,
              initial,
              bytes: [...(store.graph.images.get(image) ?? [])],
              saved
            }
          },
          mode,
          path
        )
        assert.equal(before.saved, true)
        assert.ok(before.bytes.length > 100)
        if (mode === 'saved-fixture') assert.deepEqual(before.bytes, before.initial)
        else assert.notDeepEqual(before.bytes, before.initial)
        const bytes = [...(await readFile(path))]
        const reopened = await browser.execute(
          async (bytes, id, image) => {
            const store = window.openPencil?.getStore?.()
            if (!store) throw new Error('Native editor missing')
            await store.openFigFile(new File([new Uint8Array(bytes)], 'native-shader.fig'))
            return {
              width: store.graph.getNode(id)?.width,
              bytes: [...(store.graph.images.get(image) ?? [])]
            }
          },
          bytes,
          before.id,
          before.image
        )
        assert.equal(reopened.width, 140)
        assert.deepEqual(reopened.bytes, before.bytes)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
})
