import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'
import { writeNativeFile } from '#tests/helpers/tauri/invoke'

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
            for (const child of store.graph.getChildren(store.state.currentPageId)) {
              store.graph.deleteNode(child.id)
            }
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
          async (bytes, mode) => {
            const gpu = Object.getOwnPropertyDescriptor(navigator, 'gpu')
            if (mode === 'saved-fixture') {
              Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
            }
            try {
              const store = window.openPencil?.getStore?.()
              if (!store) throw new Error('Native editor missing')
              await store.openFigFile(new File([new Uint8Array(bytes)], 'native-shader.fig'))
              const current = window.openPencil?.getStore?.()
              if (!current) throw new Error('Reopened native editor missing')
              if (mode === 'saved-fixture') current.setShaderRasterizer(null)
              const node = current.graph
                .getChildren(current.state.currentPageId)
                .find((candidate) => candidate.name === 'Native Shader')
              const image = node?.fills.at(-1)?.imageHash
              if (!node || !image) throw new Error('Reopened native Shader paint missing')
              return {
                id: node.id,
                width: node.width,
                bytes: [...(current.graph.images.get(image) ?? [])]
              }
            } finally {
              if (mode === 'saved-fixture') {
                if (gpu) Object.defineProperty(navigator, 'gpu', gpu)
                else Reflect.deleteProperty(navigator, 'gpu')
              }
            }
          },
          bytes,
          mode
        )
        assert.equal(reopened.width, 140)
        assert.equal(Buffer.from(reopened.bytes).equals(Buffer.from(before.bytes)), true)
        // Real native rasterization and fs IPC. The system save dialog is a
        // separate manual acceptance target; no dialog is mocked here.
        const png = await browser.execute(async (id) => {
          const store = window.openPencil?.getStore?.()
          if (!store) throw new Error('Native editor missing')
          const bytes = await store.renderExportImage([id], 1, 'PNG')
          if (!bytes) throw new Error('Native Shader PNG missing')
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
          try {
            const canvas = document.createElement('canvas')
            canvas.width = bitmap.width
            canvas.height = bitmap.height
            const context = canvas.getContext('2d')
            if (!context) throw new Error('Native export pixel context missing')
            context.drawImage(bitmap, 0, 0)
            const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
            let colored = 0
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i + 3] > 0 && pixels[i] > pixels[i + 2]) colored++
            }
            return { bytes: [...bytes], colored }
          } finally {
            bitmap.close()
          }
        }, reopened.id)
        const imagePath = join(directory, 'shader.png')
        assert.ok(png.colored > 500, 'Native export must retain the colored source content')
        assert.equal(await writeNativeFile(imagePath, png.bytes), null)
        const exported = await readFile(imagePath)
        assert.deepEqual([...exported.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
        assert.equal(exported.readUInt32BE(16), 140)
        assert.equal(exported.readUInt32BE(20), 90)
        assert.ok(exported.length > 100)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
})
