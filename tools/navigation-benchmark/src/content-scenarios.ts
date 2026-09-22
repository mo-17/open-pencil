import type { Page } from '@playwright/test'

/** Authored fixtures use generated images and existing, separately licensed font fixtures. */
export async function setupContentScenario(
  page: Page,
  scenario: 'image-heavy' | 'complex-text' | 'mixed-fonts'
): Promise<void> {
  await page.evaluate(async (scenario) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not available')
    const pageId = store.state.currentPageId
    for (const id of store.graph.getChildren(pageId).map((node) => node.id)) {
      store.graph.deleteNode(id)
    }
    const fill = {
      type: 'SOLID' as const,
      color: { r: 0.1, g: 0.2, b: 0.35, a: 1 },
      visible: true,
      opacity: 1
    }
    if (scenario === 'image-heavy') {
      const hashes: string[] = []
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image fixture canvas unavailable')
      for (let image = 0; image < 32; image++) {
        context.fillStyle = `hsl(${image * 11}, 65%, 55%)`
        context.fillRect(0, 0, 256, 256)
        context.fillStyle = '#14273d'
        for (let cell = 0; cell < 16; cell++) {
          context.fillRect((cell % 4) * 64 + image, Math.floor(cell / 4) * 64, 24, 32)
        }
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => {
            if (value) {
              resolve(value)
              return
            }
            reject(new Error('Image fixture encoding failed'))
          })
        })
        hashes.push(store.storeImage(new Uint8Array(await blob.arrayBuffer())))
      }
      for (let index = 0; index < 400; index++) {
        store.graph.createNode('RECTANGLE', pageId, {
          name: `Image ${index}`,
          x: (index % 20) * 96,
          y: Math.floor(index / 20) * 96,
          width: 80,
          height: 80,
          fills: [
            {
              ...fill,
              type: 'IMAGE',
              imageHash: hashes[index % hashes.length],
              imageScaleMode: 'FILL'
            }
          ]
        })
      }
    } else {
      const ids: string[] = []
      const count = scenario === 'mixed-fonts' ? 180 : 500
      for (let index = 0; index < count; index++) {
        const mixed = scenario === 'mixed-fonts'
        const text = mixed
          ? 'OpenPencil · 你好世界 · 123'
          : 'OpenPencil typography\nSpacing, wrapping and styles 0123456789'
        const node = store.graph.createNode('TEXT', pageId, {
          name: `Text ${index}`,
          x: (index % 3) * 420,
          y: Math.floor(index / 3) * 100,
          width: 390,
          height: 90,
          text,
          fontFamily: 'Inter',
          fontSize: 20,
          textAutoResize: 'NONE',
          letterSpacing: index % 3,
          styleRuns: [
            {
              start: mixed ? 13 : 0,
              length: mixed ? 4 : 10,
              style: {
                fontFamily: mixed ? 'Noto Sans CJK SC' : 'Inter',
                fontSize: 26
              }
            }
          ],
          fills: [fill]
        })
        ids.push(node.id)
      }
      await store.loadFontsForNodes(ids)
    }
    store.clearSelection()
    store.requestRender()
  }, scenario)
}
