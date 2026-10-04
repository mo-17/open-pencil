import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startPreviewCacheServer } from '#compiler/dev-server/cache'

describe('preview optimizer cache ownership', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    )
  })

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'open-pencil-cache-owner-'))
    directories.push(root)
    const shared = join(root, '.vite', 'deps')
    await mkdir(shared, { recursive: true })
    const sentinel = join(shared, 'existing.js')
    await writeFile(sentinel, 'existing unrelated cache')
    return { root, sentinel }
  }

  test('isolates simultaneous same-target caches and drains before precision cleanup', async () => {
    const { root, sentinel } = await fixture()
    const caches: string[] = []
    let closes = 0
    let listens = 0
    let disposed = 0
    let reentered: Promise<void> | undefined
    let release: () => void = () => undefined
    const drained = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = await startPreviewCacheServer(
      root,
      async (cache) => {
        caches.push(cache)
        await writeFile(join(cache, 'optimized.js'), 'first live module')
        return {
          async listen() {
            listens++
          },
          close() {
            closes++
            return drained
          }
        }
      },
      () => {
        disposed++
        reentered = first.close()
      }
    )
    const second = await startPreviewCacheServer(root, async (cache) => {
      caches.push(cache)
      await writeFile(join(cache, 'optimized.js'), 'second live module')
      return {
        async listen() {
          listens++
        },
        async close() {
          closes++
        }
      }
    })
    expect(caches[0]).not.toBe(caches[1])
    const closing = first.close()
    expect(first.close()).toBe(closing)
    await Promise.resolve()
    expect(closes).toBe(1)
    expect(reentered).toBe(closing)
    expect(existsSync(caches[0])).toBe(true)
    release()
    await closing
    await first.close()
    expect(closes).toBe(1)
    expect(disposed).toBe(1)
    expect(listens).toBe(2)
    expect(existsSync(caches[0])).toBe(false)
    expect(await readFile(join(caches[1], 'optimized.js'), 'utf8')).toBe('second live module')
    expect(await readFile(sentinel, 'utf8')).toBe('existing unrelated cache')
    await second.close()
    expect(existsSync(caches[1])).toBe(false)
    expect(existsSync(join(root, '.vite'))).toBe(true)
  })

  test('removes only its allocated cache when creation fails', async () => {
    const { root, sentinel } = await fixture()
    const original = new Error('creation failed')
    let cache = ''
    let disposed = 0
    await expect(
      startPreviewCacheServer(
        root,
        async (path) => {
          cache = path
          throw original
        },
        () => {
          disposed++
        }
      )
    ).rejects.toBe(original)
    expect(existsSync(cache)).toBe(false)
    expect(existsSync(sentinel)).toBe(true)
    expect(disposed).toBe(1)
  })

  test('preserves listen failure after closing the partial server and deleting its cache', async () => {
    const { root, sentinel } = await fixture()
    const original = new Error('listen failed')
    let cache = ''
    let closes = 0
    await expect(
      startPreviewCacheServer(root, async (path) => {
        cache = path
        return {
          async listen() {
            throw original
          },
          async close() {
            closes++
          }
        }
      })
    ).rejects.toBe(original)
    expect(closes).toBe(1)
    expect(existsSync(cache)).toBe(false)
    expect(existsSync(sentinel)).toBe(true)
  })

  test.each(['rejected promise', 'synchronous throw'] as const)(
    'retains the close error and cache after %s',
    async (failure) => {
      const { root, sentinel } = await fixture()
      const original = new Error('close failed')
      let cache = ''
      let closes = 0
      let listens = 0
      const preview = await startPreviewCacheServer(root, async (path) => {
        cache = path
        return {
          async listen() {
            listens++
          },
          close() {
            closes++
            if (failure === 'synchronous throw') throw original
            return Promise.reject(original)
          }
        }
      })
      await expect(preview.close()).rejects.toBe(original)
      await expect(preview.close()).rejects.toBe(original)
      expect(closes).toBe(1)
      expect(listens).toBe(1)
      expect(existsSync(cache)).toBe(true)
      expect(existsSync(sentinel)).toBe(true)
    }
  )

  test('disposes the service if cache allocation fails without touching existing files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-pencil-cache-owner-'))
    directories.push(root)
    const blockedCacheRoot = join(root, '.vite')
    await writeFile(blockedCacheRoot, 'existing file')
    let creates = 0
    let disposals = 0
    await expect(
      startPreviewCacheServer(
        root,
        async () => {
          creates++
          throw new Error('Must not create after cache allocation fails')
        },
        () => {
          disposals++
        }
      )
    ).rejects.toHaveProperty('code', 'EEXIST')
    expect(creates).toBe(0)
    expect(disposals).toBe(1)
    expect(await readFile(blockedCacheRoot, 'utf8')).toBe('existing file')
  })

  test('preserves the listen failure and cache when partial-server close also fails', async () => {
    const { root, sentinel } = await fixture()
    const original = new Error('listen failed before close failed')
    let cache = ''
    let closes = 0
    await expect(
      startPreviewCacheServer(root, async (path) => {
        cache = path
        return {
          async listen() {
            throw original
          },
          async close() {
            closes++
            throw new Error('secondary close failure')
          }
        }
      })
    ).rejects.toBe(original)
    expect(closes).toBe(1)
    expect(existsSync(cache)).toBe(true)
    expect(existsSync(sentinel)).toBe(true)
  })

  test.each(['creation', 'listen', 'close', 'success'] as const)(
    'owns the complete isolated VFS directory through %s',
    async (outcome) => {
      const { root, sentinel } = await fixture()
      const original = new Error(outcome)
      let owned = ''
      const starting = startPreviewCacheServer(
        root,
        async (directory) => {
          owned = directory
          expect(directory.startsWith(join(root, 'server-'))).toBe(true)
          await writeFile(join(directory, 'tsconfig.json'), '{}')
          await mkdir(join(directory, '.vite'))
          await writeFile(join(directory, '.vite', 'module.js'), 'owned optimizer')
          if (outcome === 'creation') throw original
          return {
            async listen() {
              if (outcome === 'listen') throw original
            },
            async close() {
              if (outcome === 'close') throw original
            }
          }
        },
        undefined,
        'vfs'
      )
      if (outcome === 'creation' || outcome === 'listen') {
        await expect(starting).rejects.toBe(original)
      } else {
        const preview = await starting
        if (outcome === 'close') await expect(preview.close()).rejects.toBe(original)
        else await preview.close()
      }
      expect(existsSync(owned)).toBe(outcome === 'close')
      expect(await readFile(sentinel, 'utf8')).toBe('existing unrelated cache')
      expect(existsSync(root)).toBe(true)
    }
  )
})
