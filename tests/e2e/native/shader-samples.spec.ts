import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createShaderSamples } from '#tests/helpers/shaders/samples'
import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'
import { writeNativeFile } from '#tests/helpers/tauri/invoke'

describe('native Shader source samples', () => {
  it('updates image and text frames before immediate native save and exports all three source kinds', async function () {
    await openNativeEditorDocument()
    const capable = await browser.execute(async () => {
      const gpu: { requestAdapter(): Promise<unknown | null> } | undefined = Reflect.get(
        navigator,
        'gpu'
      )
      return gpu ? Boolean(await gpu.requestAdapter()) : false
    })
    if (!capable) return this.skip()
    const retained = process.env.OPENPENCIL_SHADER_ACCEPTANCE_DIR
    const directory = retained ?? (await mkdtemp(join(tmpdir(), 'open-pencil-shader-samples-')))
    try {
      const fixture = await browser.execute(createShaderSamples)
      const path = join(directory, 'shader-samples.fig')
      const saved = await browser.execute(
        async ({ fixture, path }) => {
          const store = window.openPencil?.getStore?.()
          if (!store) throw new Error('Native editor missing')
          const [image, text] = fixture.samples
          if (!image || !text) throw new Error('Shader source samples missing')
          store.setContentShader([image.id], {
            components: [{ type: 'Twirl', props: { intensity: 1 } }]
          })
          store.graph.updateNode(image.id, { width: 120 })
          store.graph.updateNode(text.id, { text: 'Edited TEXT' })
          const success = await store.saveFigFileToPath(path)
          return {
            success,
            frames: fixture.samples.map((sample) => [
              ...(store.graph.images.get(sample.image) ?? [])
            ])
          }
        },
        { fixture, path }
      )
      assert.equal(saved.success, true)
      assert.equal(saved.frames.length, 3)
      saved.frames.forEach((frame) => assert.ok(frame.length > 100))
      assert.notDeepEqual(saved.frames[0], fixture.samples[0]?.saved)
      assert.notDeepEqual(saved.frames[1], fixture.samples[1]?.saved)
      const fig = [...(await readFile(path))]
      const reopened = await browser.execute(async (bytes) => {
        const previous = window.openPencil?.getStore?.()
        if (!previous) throw new Error('Native editor missing')
        await previous.openFigFile(new File([new Uint8Array(bytes)], 'shader-samples.fig'))
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('Reopened native editor missing')
        const root = store.graph
          .getChildren(store.state.currentPageId)
          .find((node) => node.name === 'Shader samples')
        if (!root) throw new Error('Reopened sample root missing')
        const frames = store.graph.getChildren(root.id).map((node) => ({
          name: node.name,
          width: node.width,
          text: node.text,
          saved: [...(store.graph.images.get(node.fills.at(-1)?.imageHash ?? '') ?? [])]
        }))
        const png = await store.renderExportImage([root.id], 1, 'PNG')
        if (!png) throw new Error('Native samples PNG missing')
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)]))
        try {
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Native sample pixel reader missing')
          context.drawImage(bitmap, 0, 0)
          const colored = [
            [16, 16, 120, 96],
            [152, 20, 190, 60],
            [376, 16, 140, 112]
          ].map(([x, y, width, height]) => {
            const pixels = context.getImageData(x, y, width, height).data
            let count = 0
            for (let index = 0; index < pixels.length; index += 4)
              if (
                pixels[index + 3] > 0 &&
                (pixels[index] < 240 || pixels[index + 1] < 240 || pixels[index + 2] < 240)
              )
                count++
            return count
          })
          return { frames, colored, png: [...png] }
        } finally {
          bitmap.close()
        }
      }, fig)
      for (const [index, sample] of fixture.samples.entries())
        assert.deepEqual(
          reopened.frames.find((frame) => frame.name === sample.name)?.saved,
          saved.frames[index]
        )
      assert.equal(reopened.frames.find((frame) => frame.name === 'Image sample')?.width, 120)
      assert.equal(
        reopened.frames.find((frame) => frame.name === 'Text sample')?.text,
        'Edited TEXT'
      )
      reopened.colored.forEach((count) =>
        assert.ok(count > 25, 'Every source kind must retain visible pixels')
      )
      assert.equal(await writeNativeFile(join(directory, 'shader-samples.png'), reopened.png), null)
      const png = await readFile(join(directory, 'shader-samples.png'))
      assert.equal(png.readUInt32BE(16), 560)
      assert.equal(png.readUInt32BE(20), 180)
      // A second edit/save exercises archive patching after canonical image names were read.
      const secondPath = join(directory, 'shader-samples-edited.fig')
      assert.equal(
        await browser.execute(async (path) => {
          const store = window.openPencil?.getStore?.()
          const root = store?.graph
            .getChildren(store.state.currentPageId)
            .find((node) => node.name === 'Shader samples')
          const image =
            root && store?.graph.getChildren(root.id).find((node) => node.name === 'Image sample')
          if (!store || !image) throw new Error('Reopened Shader image missing')
          store.setContentShader([image.id], {
            components: [{ type: 'Twirl', props: { intensity: 2 } }]
          })
          return store.saveFigFileToPath(path)
        }, secondPath),
        true
      )
      const twice = [...(await readFile(secondPath))]
      const count = await browser.execute(async (bytes) => {
        const previous = window.openPencil?.getStore?.()
        if (!previous) throw new Error('Native editor missing')
        await previous.openFigFile(new File([new Uint8Array(bytes)], 'shader-samples-edited.fig'))
        const store = window.openPencil?.getStore?.()
        const root = store?.graph
          .getChildren(store.state.currentPageId)
          .find((node) => node.name === 'Shader samples')
        if (!store || !root) throw new Error('Second Shader reopen failed')
        return store.graph
          .getChildren(root.id)
          .filter(
            (node) =>
              (store.graph.images.get(node.fills.at(-1)?.imageHash ?? '')?.length ?? 0) > 100
          ).length
      }, twice)
      assert.equal(count, 3)
    } finally {
      if (!retained) await rm(directory, { recursive: true, force: true })
    }
  })
})
