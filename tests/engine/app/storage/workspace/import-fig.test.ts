import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { StorageFigImportError, prepareStorageFigImport } from '@/app/storage/workspace/import-fig'

const fixturePath = resolve(import.meta.dir, '../../../../fixtures/gold-preview.fig')

describe('prepareStorageFigImport', () => {
  test('validates a Chinese-named FIG and preserves its original bytes', async () => {
    const bytes = await readFile(fixturePath)
    const file = new File([bytes], '惊悚.fig', { type: 'application/octet-stream' })

    const prepared = await prepareStorageFigImport(file)

    expect(prepared.name).toBe('惊悚')
    expect(prepared.figBytes).toEqual(new Uint8Array(bytes))
  })

  test('rejects a non-FIG extension before parsing its contents', async () => {
    const bytes = await readFile(fixturePath)
    const file = new File([bytes], '惊悚.pen', { type: 'application/octet-stream' })

    await expect(prepareStorageFigImport(file)).rejects.toBeInstanceOf(StorageFigImportError)
  })

  test('rejects corrupt bytes even when the file name ends in .fig', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'fake.fig')

    await expect(prepareStorageFigImport(file)).rejects.toBeInstanceOf(Error)
  })
})
