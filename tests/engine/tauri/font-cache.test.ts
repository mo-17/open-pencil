import { afterEach, describe, expect, test } from 'bun:test'

import { inspectImportedFontBytes } from '@open-pencil/core/text'

import {
  clearDownloadedFontCache,
  createTauriDownloadedFontCache,
  downloadedFontCacheSummary,
  groupImportedFontCacheFamilies,
  listImportedFontCacheFaces,
  stageImportedFontCache,
  writeImportedFontCache,
  type ImportedFontCacheFace
} from '@/app/editor/fonts/cache'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

const encoder = new TextEncoder()

function copiedBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
  }
  if (Array.isArray(value)) return Uint8Array.from(value)
  throw new Error('Expected binary mock payload')
}

afterEach(async () => {
  await clearTauriMocks()
})

describe('Tauri downloaded font cache helpers', () => {
  test('summarizes manifest entries through mocked plugin-fs IPC', async () => {
    await mockTauriIPC((cmd, args) => {
      expect(cmd).toBe('plugin:fs|read_file')
      expect(args).toMatchObject({ path: 'cache/v1/font-cache/v1/manifest' })
      return [
        ...encoder.encode(
          JSON.stringify({
            updatedAt: 300,
            value: {
              version: 1,
              entries: {
                one: {
                  family: 'Noto Sans SC',
                  style: 'Regular',
                  file: 'one.ttf',
                  byteLength: 10,
                  sha256: 'a',
                  updatedAt: 100
                },
                two: {
                  family: 'Noto Naskh Arabic',
                  style: 'Regular',
                  file: 'two.ttf',
                  byteLength: 25,
                  sha256: 'b',
                  updatedAt: 250
                }
              }
            }
          })
        )
      ]
    })

    await expect(downloadedFontCacheSummary()).resolves.toEqual({
      count: 2,
      byteLength: 35,
      updatedAt: 250
    })
  })

  test('returns an empty summary when manifest is missing', async () => {
    await mockTauriIPC((cmd) => {
      expect(cmd).toBe('plugin:fs|read_file')
      throw new Error('missing')
    })

    await expect(downloadedFontCacheSummary()).resolves.toEqual({
      count: 0,
      byteLength: 0,
      updatedAt: null
    })
  })

  test('clears the cache directory through mocked plugin-fs IPC', async () => {
    const calls: Array<{ cmd: string; args: unknown }> = []
    await mockTauriIPC((cmd, args) => {
      calls.push({ cmd, args })
      return null
    })

    await clearDownloadedFontCache()

    const { BaseDirectory } = await import('@tauri-apps/plugin-fs')
    expect(calls).toEqual([
      {
        cmd: 'plugin:fs|remove',
        args: {
          path: 'cache/v1/font-cache/v1',
          options: { baseDir: BaseDirectory.AppLocalData, recursive: true }
        }
      }
    ])
  })

  test('creates nested directories before writing font bytes and the manifest', async () => {
    const calls: Array<{ cmd: string; args: unknown }> = []
    await mockTauriIPC((cmd, args) => {
      calls.push({ cmd, args })
      if (cmd === 'plugin:fs|read_file') throw new Error('missing')
      return null
    })

    const data = Uint8Array.from([1, 2, 3, 4]).buffer
    await createTauriDownloadedFontCache().write('Noto Sans SC', 'Regular', data, '中文')

    const directoryPaths = calls
      .filter(({ cmd }) => cmd === 'plugin:fs|mkdir')
      .map(({ args }) => (args as { path: string }).path)

    expect(directoryPaths).toContain('cache/v1/font-cache/v1/files')
    expect(directoryPaths).toContain('cache/v1/font-cache/v1')
    expect(calls.filter(({ cmd }) => cmd === 'plugin:fs|write_file')).toHaveLength(2)
  })

  test('persists imported provenance separately from exact remote coverage', async () => {
    const files = new Map<string, Uint8Array>()
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        files.set(decodeURIComponent(encodedPath), copiedBytes(args))
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      throw new Error(`Unexpected command: ${cmd}`)
    })

    const imported = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const inspection = await inspectImportedFontBytes(imported)
    const saved = await writeImportedFontCache(inspection, imported)

    expect(saved).toMatchObject({
      family: 'Inter',
      style: 'Regular',
      format: 'truetype',
      licenseDisplay: { status: 'free', evidence: 'reviewed_bundled_manifest' }
    })
    await expect(listImportedFontCacheFaces()).resolves.toEqual([saved])

    const remote = imported.slice(0)
    new Uint8Array(remote)[remote.byteLength - 1] ^= 1
    const cache = createTauriDownloadedFontCache()
    await cache.write('Inter', 'Regular', remote, 'ABC')

    const restored = await createTauriDownloadedFontCache().read('Inter', 'Regular', 'ABC')
    expect(new Uint8Array(restored ?? [])).toEqual(new Uint8Array(remote))
    const differentCoverage = await createTauriDownloadedFontCache().read(
      'Inter',
      'Regular',
      '不同字符'
    )
    expect(differentCoverage).toBeNull()
    const restoredImport = await createTauriDownloadedFontCache().readImported?.('Inter', 'Regular')
    expect(new Uint8Array(restoredImport ?? [])).toEqual(new Uint8Array(imported))
  })

  test('uses a fresh manifest after clear instead of retaining deleted entries', async () => {
    const files = new Map<string, Uint8Array>()
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        files.set(decodeURIComponent(encodedPath), copiedBytes(args))
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      if (cmd === 'plugin:fs|remove') {
        const prefix = payload.path ?? ''
        for (const path of files.keys()) {
          if (path === prefix || path.startsWith(`${prefix}/`)) files.delete(path)
        }
        return null
      }
      throw new Error(`Unexpected command: ${cmd}`)
    })

    const imported = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    await writeImportedFontCache(await inspectImportedFontBytes(imported), imported)
    await expect(downloadedFontCacheSummary()).resolves.toMatchObject({ count: 1 })

    await clearDownloadedFontCache()

    await expect(downloadedFontCacheSummary()).resolves.toEqual({
      count: 0,
      byteLength: 0,
      updatedAt: null
    })
    await expect(listImportedFontCacheFaces()).resolves.toEqual([])
  })

  test('lists and restores the newest valid face when the latest imported bytes are damaged', async () => {
    const files = new Map<string, Uint8Array>()
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        files.set(decodeURIComponent(encodedPath), copiedBytes(args))
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      throw new Error(`Unexpected command: ${cmd}`)
    })

    const olderBytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const newerBytes = await Bun.file('packages/core/assets/Inter-Bold.ttf').arrayBuffer()
    const inspection = await inspectImportedFontBytes(olderBytes)
    const older = await writeImportedFontCache(inspection, olderBytes)
    const newer = await writeImportedFontCache(inspection, newerBytes)
    expect(newer.updatedAt).toBeGreaterThan(older.updatedAt)
    files.set(`cache/v1/font-cache/v1/files/${newer.sha256}.ttf`, Uint8Array.from([0, 1, 2, 3]))

    await expect(listImportedFontCacheFaces()).resolves.toEqual([older])
    const restored = await createTauriDownloadedFontCache().readImported?.('Inter', 'Regular')
    expect(new Uint8Array(restored ?? [])).toEqual(new Uint8Array(olderBytes))
  })

  test('serializes concurrent manifest updates without losing either face', async () => {
    const files = new Map<string, Uint8Array>()
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        files.set(decodeURIComponent(encodedPath), copiedBytes(args))
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      throw new Error(`Unexpected command: ${cmd}`)
    })

    const cache = createTauriDownloadedFontCache()
    const first = Uint8Array.from([0, 1, 0, 0, 1, 2, 3, 4]).buffer
    const second = Uint8Array.from([0, 1, 0, 0, 5, 6, 7, 8]).buffer
    await Promise.all([
      cache.write('Concurrent One', 'Regular', first, 'ABC'),
      cache.write('Concurrent Two', 'Regular', second, '中文')
    ])

    await expect(downloadedFontCacheSummary()).resolves.toMatchObject({ count: 2 })
    expect(new Uint8Array((await cache.read('Concurrent One', 'Regular', 'ABC')) ?? [])).toEqual(
      new Uint8Array(first)
    )
    expect(new Uint8Array((await cache.read('Concurrent Two', 'Regular', '中文')) ?? [])).toEqual(
      new Uint8Array(second)
    )
  })

  test('restores an older entry and retains bytes still referenced by another import', async () => {
    const files = new Map<string, Uint8Array>()
    const removed: string[] = []
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        files.set(decodeURIComponent(encodedPath), copiedBytes(args))
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      if (cmd === 'plugin:fs|remove') {
        const path = payload.path ?? ''
        removed.push(path)
        files.delete(path)
        return null
      }
      throw new Error(`Unexpected command: ${cmd}`)
    })

    const bytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const inspected = await inspectImportedFontBytes(bytes)
    const firstInspection = { ...inspected, family: 'Referenced Import A' }
    const secondInspection = { ...inspected, family: 'Referenced Import B' }
    const original = await writeImportedFontCache(firstInspection, bytes)
    const staged = await stageImportedFontCache(firstInspection, bytes)
    const second = await writeImportedFontCache(secondInspection, bytes)

    await staged.rollback()

    const faces = await listImportedFontCacheFaces()
    expect(faces).toHaveLength(2)
    expect(faces).toEqual(expect.arrayContaining([original, second]))
    const cache = createTauriDownloadedFontCache()
    expect(
      new Uint8Array((await cache.readImported?.('Referenced Import A', 'Regular')) ?? [])
    ).toEqual(new Uint8Array(bytes))
    expect(
      new Uint8Array((await cache.readImported?.('Referenced Import B', 'Regular')) ?? [])
    ).toEqual(new Uint8Array(bytes))
    expect(removed).toEqual([])
  })

  test('removes unreferenced bytes when rollback persistence throws after committing', async () => {
    const files = new Map<string, Uint8Array>()
    const removed: string[] = []
    let manifestWrites = 0
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        const path = decodeURIComponent(encodedPath)
        files.set(path, copiedBytes(args))
        if (path.endsWith('/manifest') && ++manifestWrites === 2) {
          throw new Error('rollback manifest acknowledgement failed')
        }
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      if (cmd === 'plugin:fs|remove') {
        const path = payload.path ?? ''
        removed.push(path)
        files.delete(path)
        return null
      }
      throw new Error(`Unexpected command: ${cmd}`)
    })

    const bytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const inspection = {
      ...(await inspectImportedFontBytes(bytes)),
      family: 'Rollback Cleanup Family'
    }
    const staged = await stageImportedFontCache(inspection, bytes)

    await expect(staged.rollback()).rejects.toThrow('rollback manifest acknowledgement failed')

    await expect(listImportedFontCacheFaces()).resolves.toEqual([])
    expect(removed).toHaveLength(1)
    expect([...files.keys()].some((path) => path.includes('/files/'))).toBe(false)
  })

  test('groups imported family licenses conservatively with a stable audit style', () => {
    const common = {
      family: 'Mixed License Family',
      sha256: 'a',
      byteLength: 10,
      format: 'truetype' as const
    }
    const faces: ImportedFontCacheFace[] = [
      {
        ...common,
        style: 'Bold',
        updatedAt: 300,
        licenseDisplay: {
          status: 'free',
          scope: 'loaded_faces',
          evidence: 'reviewed_bundled_manifest',
          licenseIds: ['OFL-1.1'],
          hasConditions: true
        }
      },
      {
        ...common,
        style: 'Regular',
        updatedAt: 100,
        licenseDisplay: {
          status: 'requires_license',
          scope: 'loaded_faces',
          evidence: 'explicit_restriction',
          restriction: 'general'
        }
      }
    ]

    expect(groupImportedFontCacheFamilies(faces)).toEqual([
      {
        family: 'Mixed License Family',
        auditStyle: 'Regular',
        licenseDisplay: {
          status: 'requires_license',
          scope: 'loaded_faces',
          evidence: 'explicit_restriction',
          restriction: 'general'
        }
      }
    ])
  })
})
