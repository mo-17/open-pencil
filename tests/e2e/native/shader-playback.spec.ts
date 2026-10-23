import { strict as assert } from 'node:assert'
import { join } from 'node:path'

import {
  createShaderPlaybackIsland,
  shaderIslandPixels
} from '#tests/helpers/shaders/playback-island'
import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'
import { invokeNative } from '#tests/helpers/tauri/invoke'

describe('native own-content Shader playback', () => {
  it('animates actual island pixels, refreshes source and preserves the saved fallback', async function () {
    await openNativeEditorDocument()
    const capable = await browser.execute(async () => {
      const gpu: { requestAdapter(): Promise<unknown | null> } | undefined = Reflect.get(
        navigator,
        'gpu'
      )
      return gpu ? Boolean(await gpu.requestAdapter()) : false
    })
    if (!capable) return this.skip()
    const fixture = await browser.execute(createShaderPlaybackIsland, true)
    try {
      await browser.waitUntil(async () => (await browser.execute(shaderIslandPixels)).colored > 100)
      await browser.waitUntil(async () =>
        browser.execute(() =>
          Boolean(
            document.querySelector(
              '[data-property="shader-preview-status"] [data-playback="playing"]'
            )
          )
        )
      )
      const passive = await browser.execute(() => {
        const badge = document.querySelector('[data-property="shader-preview-status"]')
        const field = document.querySelector('[data-island]')?.shadowRoot?.querySelector('input')
        if (!badge || !field) throw new Error('Native preview feedback or field missing')
        field.focus()
        return getComputedStyle(badge).pointerEvents
      })
      assert.equal(passive, 'none')
      // The embedded driver targets the outer shadow host for keyboard actions.
      // Physical typing is a separate native application acceptance check.
      const input = await browser.execute(() => {
        const root = document.querySelector('[data-island]')?.shadowRoot
        const field = root?.querySelector('input')
        return { value: field?.value, focused: root?.activeElement === field }
      })
      assert.deepEqual(input, { value: 'Name', focused: true })
      await invokeNative('plugin:event|emit', {
        event: 'menu-event',
        payload: 'selection.selectAll'
      })
      await browser.waitUntil(() =>
        browser.execute(() => {
          const field = document.querySelector('[data-island]')?.shadowRoot?.querySelector('input')
          return field?.selectionStart === 0 && field.selectionEnd === field.value.length
        })
      )
      assert.deepEqual(
        await browser.execute(() => [
          ...(window.openPencil?.getStore?.()?.state.selectedIds ?? [])
        ]),
        []
      )
      const first = (await browser.execute(shaderIslandPixels)).png
      await browser.waitUntil(async () => (await browser.execute(shaderIslandPixels)).png !== first)
      await browser.execute(({ decoration }) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('Native editor missing')
        for (const child of store.graph.getChildren(decoration))
          store.graph.updateNode(child.id, {
            fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, visible: true, opacity: 1 }]
          })
      }, fixture)
      await browser.waitUntil(async () => (await browser.execute(shaderIslandPixels)).green > 100)
      const saved = await browser.execute(
        ({ image }) => [...(window.openPencil?.getStore?.()?.graph.images.get(image) ?? [])],
        fixture
      )
      assert.deepEqual(saved, fixture.saved)
      assert.equal(
        await browser.execute(() => {
          const root = document.querySelector('[data-island]')?.shadowRoot
          return root?.activeElement === root?.querySelector('input')
        }),
        true
      )
    } finally {
      await browser.execute(() => window.openPencil?.getStore?.()?.stopPlay())
    }
    await browser.waitUntil(async () =>
      browser.execute(() => !document.querySelector('[data-property="shader-preview-status"]'))
    )
    const directory = process.env.OPENPENCIL_SHADER_ACCEPTANCE_DIR
    if (directory)
      assert.equal(
        await browser.execute(
          async (path) => {
            const store = window.openPencil?.getStore?.()
            if (!store) throw new Error('Native editor missing')
            return store.saveFigFileToPath(path)
          },
          join(directory, 'shader-live-controls.fig')
        ),
        true
      )
  })
})
