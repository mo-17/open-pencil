import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createFileMarketplaceArtifactStore,
  digestMarketplaceArtifact,
  type MarketplaceArtifactFileHandle,
  type MarketplaceArtifactFileSystem
} from '@open-pencil/marketplace'

const directories: string[] = []

function artifactDirectory(): string {
  const directory = join(tmpdir(), `openpencil-marketplace-phase8-artifacts-${randomUUID()}`)
  directories.push(directory)
  return directory
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function fileSystem(overrides: Partial<MarketplaceArtifactFileSystem> = {}) {
  return {
    link,
    lstat,
    mkdir,
    open: (path: string, flags: string | number, mode?: number) => open(path, flags, mode),
    realpath,
    unlink,
    syncDirectory,
    ...overrides
  } satisfies MarketplaceArtifactFileSystem
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('Phase 8 artifact durability failures', () => {
  test('rejects an artifact root that is a symbolic link', async () => {
    const directory = artifactDirectory()
    const outside = artifactDirectory()
    await mkdir(outside, { recursive: true })
    await symlink(outside, directory, 'dir')

    const store = createFileMarketplaceArtifactStore(directory)
    await expect(store.put(new TextEncoder().encode('root-symlink-artifact'))).rejects.toThrow()
    expect(await readdir(outside)).toEqual([])
  })

  test('rejects a final artifact entry that is a symbolic link', async () => {
    const directory = artifactDirectory()
    const outside = artifactDirectory()
    const bytes = new TextEncoder().encode('final-symlink-artifact')
    const digest = digestMarketplaceArtifact(bytes)
    const source = join(outside, 'outside.blob')
    await mkdir(directory, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(source, bytes)
    await symlink(source, join(directory, `${digest}.blob`))

    const store = createFileMarketplaceArtifactStore(directory)
    await expect(store.get(digest)).rejects.toThrow()
  })

  test('rejects a final artifact entry with more than one hard link', async () => {
    const directory = artifactDirectory()
    const outside = artifactDirectory()
    const bytes = new TextEncoder().encode('hard-linked-artifact')
    const digest = digestMarketplaceArtifact(bytes)
    const source = join(outside, 'outside.blob')
    await mkdir(directory, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(source, bytes)
    await link(source, join(directory, `${digest}.blob`))

    const store = createFileMarketplaceArtifactStore(directory)
    await expect(store.get(digest)).rejects.toThrow(/hard link|invalid/i)
  })

  test('rejects a final artifact path exchanged while its descriptor is open', async () => {
    const directory = artifactDirectory()
    const bytes = new TextEncoder().encode('exchanged-artifact')
    const initial = createFileMarketplaceArtifactStore(directory)
    const { digest } = await initial.put(bytes)
    const target = join(directory, `${digest}.blob`)
    const base = fileSystem()
    let exchanged = false
    const store = createFileMarketplaceArtifactStore(directory, {
      fileSystem: fileSystem({
        async open(path, flags, mode) {
          const handle = await base.open(path, flags, mode)
          if (path !== target) return handle
          return {
            async read(buffer, offset, length, position) {
              const result = await handle.read(buffer, offset, length, position)
              if (!exchanged) {
                exchanged = true
                await unlink(target)
                await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
              }
              return result
            },
            stat: () => handle.stat(),
            writeFile: (value) => handle.writeFile(value),
            sync: () => handle.sync(),
            close: () => handle.close()
          }
        }
      })
    })

    await expect(store.get(digest)).rejects.toThrow(/path changed|hard-linked|invalid/i)
  })

  test('rejects a hard link added while an artifact descriptor is being read', async () => {
    const directory = artifactDirectory()
    const outside = artifactDirectory()
    const bytes = new TextEncoder().encode('linked-during-read')
    const initial = createFileMarketplaceArtifactStore(directory)
    const { digest } = await initial.put(bytes)
    const target = join(directory, `${digest}.blob`)
    const base = fileSystem()
    await mkdir(outside, { recursive: true })
    let linked = false
    const store = createFileMarketplaceArtifactStore(directory, {
      fileSystem: fileSystem({
        async open(path, flags, mode) {
          const handle = await base.open(path, flags, mode)
          if (path !== target) return handle
          return {
            async read(buffer, offset, length, position) {
              const result = await handle.read(buffer, offset, length, position)
              if (!linked) {
                linked = true
                await link(target, join(outside, 'raced-hardlink.blob'))
              }
              return result
            },
            stat: () => handle.stat(),
            writeFile: (value) => handle.writeFile(value),
            sync: () => handle.sync(),
            close: () => handle.close()
          }
        }
      })
    })

    await expect(store.get(digest)).rejects.toThrow(/hard link|invalid/i)
  })

  test('rejects a size change while an artifact descriptor is being read', async () => {
    const directory = artifactDirectory()
    const bytes = new TextEncoder().encode('grown-during-read')
    const initial = createFileMarketplaceArtifactStore(directory)
    const { digest } = await initial.put(bytes)
    const target = join(directory, `${digest}.blob`)
    const base = fileSystem()
    let grown = false
    const store = createFileMarketplaceArtifactStore(directory, {
      fileSystem: fileSystem({
        async open(path, flags, mode) {
          const handle = await base.open(path, flags, mode)
          if (path !== target) return handle
          return {
            async read(buffer, offset, length, position) {
              const result = await handle.read(buffer, offset, length, position)
              if (!grown) {
                grown = true
                await writeFile(target, new Uint8Array([0]), { flag: 'a' })
              }
              return result
            },
            stat: () => handle.stat(),
            writeFile: (value) => handle.writeFile(value),
            sync: () => handle.sync(),
            close: () => handle.close()
          }
        }
      })
    })

    await expect(store.get(digest)).rejects.toThrow(/changed while reading|file is invalid/i)
  })

  test('does not overwrite an artifact target created after the absence check', async () => {
    const directory = artifactDirectory()
    const bytes = new TextEncoder().encode('intended-artifact')
    const competitor = new TextEncoder().encode('concurrent-competitor')
    const base = fileSystem()
    const store = createFileMarketplaceArtifactStore(directory, {
      fileSystem: fileSystem({
        async link(source, target) {
          await writeFile(target, competitor)
          await base.link(source, target)
        }
      })
    })

    await expect(store.put(bytes)).rejects.toThrow()
    expect(
      new Uint8Array(await readFile(join(directory, `${digestMarketplaceArtifact(bytes)}.blob`)))
    ).toEqual(competitor)
  })

  test('accepts an identical securely verified target that wins the create-only race', async () => {
    const directory = artifactDirectory()
    const bytes = new TextEncoder().encode('identical-concurrent-artifact')
    const base = fileSystem()
    const store = createFileMarketplaceArtifactStore(directory, {
      fileSystem: fileSystem({
        async link(source, target) {
          await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
          await base.link(source, target)
        }
      })
    })

    await expect(store.put(bytes)).resolves.toMatchObject({
      digest: digestMarketplaceArtifact(bytes),
      byteLength: bytes.byteLength
    })
    expect(await readdir(directory)).toEqual([`${digestMarketplaceArtifact(bytes)}.blob`])
  })

  test('fails closed when the final target disappears before post-publication verification', async () => {
    const directory = artifactDirectory()
    const bytes = new TextEncoder().encode('disappearing-final-artifact')
    const target = join(directory, `${digestMarketplaceArtifact(bytes)}.blob`)
    const base = fileSystem()
    const store = createFileMarketplaceArtifactStore(directory, {
      fileSystem: fileSystem({
        async syncDirectory(path) {
          await base.syncDirectory(path)
          if (path === directory) await unlink(target)
        }
      })
    })

    await expect(store.put(bytes)).rejects.toThrow(/target disappeared/i)
  })

  test.each(['write', 'file-sync', 'link'] as const)(
    'removes the temporary artifact after a %s failure',
    async (failure) => {
      const directory = artifactDirectory()
      let targetHandle: MarketplaceArtifactFileHandle | null = null
      const base = fileSystem()
      const fs = fileSystem({
        async open(path, flags, mode) {
          const handle = await base.open(path, flags, mode)
          if (!path.endsWith('.tmp')) return handle
          targetHandle = handle
          if (failure === 'write') {
            return {
              read: (buffer, offset, length, position) =>
                handle.read(buffer, offset, length, position),
              stat: () => handle.stat(),
              writeFile: async () => {
                throw Object.assign(new Error('disk full while writing'), { code: 'ENOSPC' })
              },
              sync: () => handle.sync(),
              close: () => handle.close()
            }
          }
          if (failure === 'file-sync') {
            return {
              read: (buffer, offset, length, position) =>
                handle.read(buffer, offset, length, position),
              stat: () => handle.stat(),
              writeFile: (bytes) => handle.writeFile(bytes),
              sync: async () => {
                throw Object.assign(new Error('disk full while syncing'), { code: 'ENOSPC' })
              },
              close: () => handle.close()
            }
          }
          return handle
        },
        ...(failure === 'link'
          ? {
              async link() {
                throw Object.assign(new Error('disk full while linking'), { code: 'ENOSPC' })
              }
            }
          : {})
      })
      const store = createFileMarketplaceArtifactStore(directory, { fileSystem: fs })

      await expect(store.put(new TextEncoder().encode('phase-8-artifact'))).rejects.toThrow(
        /disk full/i
      )
      expect(targetHandle).not.toBeNull()
      expect(await readdir(directory)).toEqual([])
    }
  )

  test('syncs the artifact directory after create-only link publication', async () => {
    const directory = artifactDirectory()
    const steps: string[] = []
    const base = fileSystem()
    const store = createFileMarketplaceArtifactStore(directory, {
      fileSystem: fileSystem({
        async link(source, target) {
          await base.link(source, target)
          steps.push('link')
        },
        async unlink(path) {
          await base.unlink(path)
          if (path.endsWith('.tmp')) steps.push('unlink-temporary')
        },
        async syncDirectory(path) {
          steps.push(path === directory ? 'directory-sync' : 'parent-directory-sync')
          await base.syncDirectory(path)
        }
      })
    })

    await store.put(new TextEncoder().encode('durable-phase-8-artifact'))
    expect(steps).toEqual(['parent-directory-sync', 'link', 'unlink-temporary', 'directory-sync'])
  })
})
