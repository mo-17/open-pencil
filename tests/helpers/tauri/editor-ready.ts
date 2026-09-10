export async function openNativeEditorDocument(): Promise<void> {
  await browser.execute(() => {
    document.querySelector<HTMLElement>('[data-test-id="home-new-document"]')?.click()
  })
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const store = window.openPencil?.getStore?.()
        return Boolean(document.querySelector('[data-test-id="canvas-area"]') && store?.textEditor)
      }),
    { timeout: 30_000, timeoutMsg: 'Native editor canvas and text renderer did not initialize' }
  )
}
