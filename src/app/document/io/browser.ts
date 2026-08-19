import type { ViewportSize } from '@/app/document/io/types'

export function resolveBrowserFileURL(path: string): URL {
  const url = new URL(path, window.location.href)
  url.hash = ''
  return url
}

export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

type ViewportEditor = {
  zoomToFit: () => void
}

export function createDocumentViewportActions(editor: ViewportEditor, viewportSize: ViewportSize) {
  function setViewportSize(width: number, height: number) {
    viewportSize.width = width
    viewportSize.height = height
  }

  async function fitCurrentPageToViewport() {
    await yieldToUI()
    editor.zoomToFit()
  }

  return { setViewportSize, fitCurrentPageToViewport }
}

export function createBrowserDownloadBlob(data: Uint8Array, mime: string): Blob {
  const exactBuffer =
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
      ? data.buffer
      : new Uint8Array(data).buffer
  return new Blob([exactBuffer], { type: mime })
}

export function downloadBlob(data: Uint8Array, filename: string, mime: string) {
  const blob = createBrowserDownloadBlob(data, mime)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}
