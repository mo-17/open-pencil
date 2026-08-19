import { describe, expect, test } from 'bun:test'

import { createBrowserDownloadBlob } from '@/app/document/io/browser'

describe('browser file downloads', () => {
  test('copies only the visible Uint8Array view into the Blob', async () => {
    const backing = new TextEncoder().encode('SECRETarchive-bytes')
    const view = backing.subarray('SECRET'.length)

    const blob = createBrowserDownloadBlob(view, 'application/zip')
    const downloaded = new Uint8Array(await blob.arrayBuffer())

    expect(blob.type).toBe('application/zip')
    expect(blob.size).toBe(view.byteLength)
    expect(downloaded).toEqual(view)
    expect(new TextDecoder().decode(downloaded)).toBe('archive-bytes')
  })
})
