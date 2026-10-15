import type { Page } from '@playwright/test'

import { repoPath } from '#tests/helpers/paths'

export async function openPreviewSyncDocument(page: Page): Promise<void> {
  const path = repoPath(
    'tests/engine/compiler/flutter-preview/fixtures/flutter-sync-acceptance.fig'
  )
  await page.evaluate(async (url) => {
    const api = window.openPencil
    if (!api) throw new Error('OpenPencil test host unavailable')

    if (!api?.openFile) throw new Error('Document opener not initialized.')
    await api.openFile(url)
  }, `/@fs${path}`)
}

export async function createPreviewSyncMarker(page: Page, text: string): Promise<string> {
  return page.evaluate((value) => {
    const api = window.openPencil
    if (!api) throw new Error('OpenPencil test host unavailable')

    const store = api?.getStore?.()
    if (!store) throw new Error('Editor not initialized.')
    return store.graph.createNode('TEXT', store.state.currentPageId, {
      name: 'Preview sync acceptance marker',
      text: value,
      x: 32,
      y: 32,
      width: 480,
      height: 48,
      fontSize: 24
    }).id
  }, text)
}

export async function updatePreviewSyncMarker(page: Page, id: string, text: string): Promise<void> {
  await page.evaluate(
    ({ nodeId, value }) => {
      const api = window.openPencil
      if (!api) throw new Error('OpenPencil test host unavailable')

      const store = api?.getStore?.()
      if (!store) throw new Error('Editor not initialized.')
      store.graph.updateNode(nodeId, { text: value })
    },
    { nodeId: id, value: text }
  )
}

export async function savePreviewSyncDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const downloaded = page.waitForEvent('download', { timeout: 20000 })
  await page.keyboard.press('Meta+s')
  const download = await downloaded
  if (await download.failure()) throw new Error('Document download failed.')
}
