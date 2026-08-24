import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  ORDINARY_FIG_ARCHIVE_LIMITS,
  readFigFile,
  readFigSource
} from '@open-pencil/core/io/formats/fig'

const FIXTURES = resolve(import.meta.dir, '../../../../fixtures')

test('ordinary FIG reads merge finite archive limits and reject oversized input', async () => {
  const bytes = new Uint8Array(await readFile(resolve(FIXTURES, 'gold-preview.fig')))
  const maxArchiveBytes = bytes.byteLength - 1

  await expect(
    readFigSource(
      { read: async () => bytes.slice() },
      { archiveLimits: { maxArchiveBytes }, populate: 'first-page' }
    )
  ).rejects.toThrow(`.fig archive exceeds the ${maxArchiveBytes} compressed byte limit`)
  expect(Object.values(ORDINARY_FIG_ARCHIVE_LIMITS).every(Number.isSafeInteger)).toBe(true)
})

test('ordinary FIG readers reject a known oversized source before allocating it', async () => {
  let sourceReads = 0
  await expect(
    readFigSource(
      {
        size: 65,
        async read() {
          sourceReads += 1
          return new Uint8Array(65)
        }
      },
      { archiveLimits: { maxArchiveBytes: 64 } }
    )
  ).rejects.toThrow('.fig archive exceeds the 64 compressed byte limit')
  expect(sourceReads).toBe(0)

  let fileReads = 0
  const oversizedFile = {
    size: 65,
    async arrayBuffer() {
      fileReads += 1
      return new ArrayBuffer(65)
    }
  } as File
  await expect(
    readFigFile(oversizedFile, { archiveLimits: { maxArchiveBytes: 64 } })
  ).rejects.toThrow('.fig archive exceeds the 64 compressed byte limit')
  expect(fileReads).toBe(0)
})

test('ordinary FIG reads enforce the expanded graph budget', async () => {
  const bytes = new Uint8Array(await readFile(resolve(FIXTURES, 'gold-preview.fig')))

  await expect(
    readFigSource(
      { size: bytes.byteLength, read: async () => bytes.slice() },
      { archiveLimits: { maxGraphNodes: 2 }, populate: 'first-page' }
    )
  ).rejects.toThrow('SceneGraph node limit exceeded (2)')
})

test('ordinary FIG limits preserve a large legitimate design-system fixture', async () => {
  const file = resolve(FIXTURES, 'material3.fig')
  const graph = await readFigSource({ read: () => readFile(file) }, { populate: 'first-page' })

  expect(graph.getPages().length).toBeGreaterThan(1)
}, 30_000)
