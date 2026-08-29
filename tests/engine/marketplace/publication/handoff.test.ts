import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_PUBLICATION_HANDOFF_LIMITS,
  createMarketplacePublicationHandoff,
  createMarketplacePublicationRequest,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceRepository,
  marketplacePublicationHandoffBytes,
  openMarketplacePublicationHandoff,
  parseMarketplacePublicationHandoffBytes,
  parseMarketplacePublicationHandoffJSON,
  prepareMarketplacePublicationProjection,
  serializeMarketplacePublicationHandoff,
  writeMarketplacePublicationHandoffFile,
  type MarketplacePublicationHandoffFileOperations
} from '@open-pencil/marketplace'

const MARKETPLACE_ID = 'handoff-marketplace'
const ROOT_KEY_ID = 'handoff-root-2026'
const PUBLIC_BASE_URL = 'https://plugins.example.com/'
const GENERATED_AT = '2026-08-28T00:00:00.000Z'

async function fixture() {
  const repository = createMemoryMarketplaceRepository()
  await repository.transaction((transaction) =>
    transaction.createPublisher(
      { id: 'state-anchor', displayName: 'State Anchor' },
      { actor: 'handoff-test', time: '2026-08-27T00:00:00.000Z' }
    )
  )
  const state = await repository.snapshot()
  const plan = await prepareMarketplacePublicationProjection(
    state,
    createMemoryMarketplaceArtifactStore(),
    {
      marketplaceId: MARKETPLACE_ID,
      rootKeyId: ROOT_KEY_ID,
      publicBaseUrl: PUBLIC_BASE_URL,
      now: () => new Date(GENERATED_AT)
    }
  )
  const request = createMarketplacePublicationRequest({
    state,
    purpose: 'routine',
    marketplaceId: MARKETPLACE_ID,
    rootKeyId: ROOT_KEY_ID,
    publicBaseUrl: PUBLIC_BASE_URL,
    baseline: null,
    plan
  })
  return { request, state }
}

describe('offline marketplace publication handoff', () => {
  test('round-trips one canonical request and its exact trusted state', async () => {
    const source = await fixture()
    const handoff = createMarketplacePublicationHandoff(source)
    const json = serializeMarketplacePublicationHandoff(handoff)
    const bytes = marketplacePublicationHandoffBytes(handoff)

    expect(parseMarketplacePublicationHandoffJSON(json)).toEqual(handoff)
    expect(parseMarketplacePublicationHandoffBytes(bytes)).toEqual(handoff)
    expect(openMarketplacePublicationHandoff(handoff)).toMatchObject(source)
    expect(new TextDecoder().decode(bytes)).toBe(json)
  })

  test('rejects a request/state mismatch, non-canonical JSON, and oversized input', async () => {
    const source = await fixture()
    const handoff = createMarketplacePublicationHandoff(source)
    const changedRequest = { ...source.request, stateDigest: 'A'.repeat(43) }

    expect(() =>
      createMarketplacePublicationHandoff({ request: changedRequest, state: source.state })
    ).toThrow('not bound to the current trusted state')
    expect(() => parseMarketplacePublicationHandoffJSON(`${JSON.stringify(handoff)}\n`)).toThrow(
      'exact canonical JSON'
    )
    expect(() =>
      parseMarketplacePublicationHandoffBytes(
        new Uint8Array(MARKETPLACE_PUBLICATION_HANDOFF_LIMITS.maxJsonBytes + 1)
      )
    ).toThrow('exceeds its byte limit')
  })

  test('syncs exact handoff bytes and then its parent directory before reporting durability', async () => {
    const source = await fixture()
    const handoff = createMarketplacePublicationHandoff(source)
    const calls: string[] = []
    const fileHandle = {
      async writeFile(value: string) {
        expect(value).toBe(serializeMarketplacePublicationHandoff(handoff))
        calls.push('file.write')
      },
      async sync() {
        calls.push('file.sync')
      },
      async close() {
        calls.push('file.close')
      }
    }
    const directoryHandle = {
      async writeFile() {
        throw new Error('directory must not be written')
      },
      async sync() {
        calls.push('directory.sync')
      },
      async close() {
        calls.push('directory.close')
      }
    }
    const operations: MarketplacePublicationHandoffFileOperations = {
      async mkdir(path, options) {
        expect(path).toBe('/tmp/publication-handoff')
        expect(options).toEqual({ recursive: true, mode: 0o700 })
        calls.push('directory.mkdir')
      },
      async open(path, flags, mode) {
        calls.push(`open:${path}:${flags}:${mode ?? ''}`)
        return path.endsWith('.json') ? fileHandle : directoryHandle
      },
      async unlink() {
        calls.push('file.unlink')
      }
    }

    expect(
      await writeMarketplacePublicationHandoffFile(
        '/tmp/publication-handoff/request.json',
        handoff,
        operations
      )
    ).toBe('/tmp/publication-handoff/request.json')
    expect(calls).toEqual([
      'directory.mkdir',
      'open:/tmp/publication-handoff/request.json:wx:384',
      'file.write',
      'file.sync',
      'file.close',
      'open:/tmp/publication-handoff:r:',
      'directory.sync',
      'directory.close'
    ])
  })

  test('syncs every newly created directory entry through the existing ancestor', async () => {
    const source = await fixture()
    const handoff = createMarketplacePublicationHandoff(source)
    const calls: string[] = []
    const operations: MarketplacePublicationHandoffFileOperations = {
      async mkdir() {
        calls.push('directory.mkdir')
        return '/tmp/new-handoff-root'
      },
      async open(path, flags) {
        calls.push(`open:${path}:${flags}`)
        if (path.endsWith('.json')) {
          return {
            async writeFile() {
              calls.push('file.write')
            },
            async sync() {
              calls.push('file.sync')
            },
            async close() {
              calls.push('file.close')
            }
          }
        }
        return {
          async writeFile() {
            throw new Error('directory must not be written')
          },
          async sync() {
            calls.push(`sync:${path}`)
          },
          async close() {
            calls.push(`close:${path}`)
          }
        }
      },
      async unlink() {
        calls.push('file.unlink')
      }
    }

    await writeMarketplacePublicationHandoffFile(
      '/tmp/new-handoff-root/nested/request.json',
      handoff,
      operations
    )
    expect(calls).toEqual([
      'directory.mkdir',
      'open:/tmp:r',
      'sync:/tmp',
      'close:/tmp',
      'open:/tmp/new-handoff-root:r',
      'sync:/tmp/new-handoff-root',
      'close:/tmp/new-handoff-root',
      'open:/tmp/new-handoff-root/nested:r',
      'sync:/tmp/new-handoff-root/nested',
      'close:/tmp/new-handoff-root/nested',
      'open:/tmp/new-handoff-root/nested/request.json:wx',
      'file.write',
      'file.sync',
      'file.close',
      'open:/tmp/new-handoff-root/nested:r',
      'sync:/tmp/new-handoff-root/nested',
      'close:/tmp/new-handoff-root/nested'
    ])
  })

  test('removes the handoff and fails closed when parent directory fsync fails', async () => {
    const source = await fixture()
    const handoff = createMarketplacePublicationHandoff(source)
    const calls: string[] = []
    const fileHandle = {
      async writeFile() {
        calls.push('file.write')
      },
      async sync() {
        calls.push('file.sync')
      },
      async close() {
        calls.push('file.close')
      }
    }
    let directorySyncCount = 0
    const directoryHandle = {
      async writeFile() {
        throw new Error('directory must not be written')
      },
      async sync() {
        calls.push('directory.sync')
        directorySyncCount += 1
        if (directorySyncCount === 1) {
          throw new Error('simulated parent directory fsync failure')
        }
      },
      async close() {
        calls.push('directory.close')
      }
    }
    const operations: MarketplacePublicationHandoffFileOperations = {
      async mkdir() {
        calls.push('directory.mkdir')
      },
      async open(path) {
        calls.push(path.endsWith('.json') ? 'file.open' : 'directory.open')
        return path.endsWith('.json') ? fileHandle : directoryHandle
      },
      async unlink(path) {
        expect(path).toBe('/tmp/publication-handoff/request.json')
        calls.push('file.unlink')
      }
    }

    await expect(
      writeMarketplacePublicationHandoffFile(
        '/tmp/publication-handoff/request.json',
        handoff,
        operations
      )
    ).rejects.toThrow('simulated parent directory fsync failure')
    expect(calls).toEqual([
      'directory.mkdir',
      'file.open',
      'file.write',
      'file.sync',
      'file.close',
      'directory.open',
      'directory.sync',
      'directory.close',
      'file.unlink',
      'directory.open',
      'directory.sync',
      'directory.close'
    ])
  })

  test('surfaces an unlink failure instead of claiming failed-output cleanup', async () => {
    const source = await fixture()
    const handoff = createMarketplacePublicationHandoff(source)
    const fileHandle = {
      async writeFile() {
        return undefined
      },
      async sync() {
        return undefined
      },
      async close() {
        return undefined
      }
    }
    const operations: MarketplacePublicationHandoffFileOperations = {
      async mkdir() {
        return undefined
      },
      async open(path) {
        if (path.endsWith('.json')) return fileHandle
        return {
          async writeFile() {
            return undefined
          },
          async sync() {
            throw new Error('simulated parent directory fsync failure')
          },
          async close() {
            return undefined
          }
        }
      },
      async unlink() {
        throw new Error('simulated unlink failure')
      }
    }

    await expect(
      writeMarketplacePublicationHandoffFile(
        '/tmp/publication-handoff/request.json',
        handoff,
        operations
      )
    ).rejects.toThrow('durable cleanup could not be confirmed')
  })

  test('fails closed when directory fsync rejects with a falsy value', async () => {
    const source = await fixture()
    const handoff = createMarketplacePublicationHandoff(source)
    let directorySyncCount = 0
    const fileHandle = {
      async writeFile() {
        return undefined
      },
      async sync() {
        return undefined
      },
      async close() {
        return undefined
      }
    }
    const operations: MarketplacePublicationHandoffFileOperations = {
      async mkdir() {
        return undefined
      },
      async open(path) {
        if (path.endsWith('.json')) return fileHandle
        return {
          async writeFile() {
            return undefined
          },
          async sync() {
            directorySyncCount += 1
            // oxlint-disable-next-line prefer-promise-reject-errors, unicorn/no-useless-promise-resolve-reject -- Regression injects a legal falsy rejection from an untrusted operation.
            if (directorySyncCount === 1) return Promise.reject(undefined)
            return undefined
          },
          async close() {
            return undefined
          }
        }
      },
      async unlink() {
        return undefined
      }
    }

    await expect(
      writeMarketplacePublicationHandoffFile(
        '/tmp/publication-handoff/request.json',
        handoff,
        operations
      )
    ).rejects.toThrow('Failed to sync directory')
    expect(directorySyncCount).toBe(2)
  })
})
