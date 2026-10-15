import { describe, expect, test } from 'bun:test'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getOrCreateProcessSingleton } from '../.vitepress/sdk/process-singleton'

type SingletonModule = { getOrCreateProcessSingleton: typeof getOrCreateProcessSingleton }

describe('documentation build process singletons', () => {
  test('creates one value for the same build-service identity', () => {
    const identity = `test:same:${crypto.randomUUID()}`
    let creations = 0
    const create = () => ({ creation: ++creations })

    const first = getOrCreateProcessSingleton(identity, create)
    const second = getOrCreateProcessSingleton(identity, create)

    expect(second).toBe(first)
    expect(creations).toBe(1)
  })

  test('keeps different repository or configuration identities isolated', () => {
    const scope = crypto.randomUUID()
    const first = getOrCreateProcessSingleton(`test:${scope}:one`, () => ({ value: 1 }))
    const second = getOrCreateProcessSingleton(`test:${scope}:two`, () => ({ value: 2 }))

    expect(first).not.toBe(second)
    expect(first.value).toBe(1)
    expect(second.value).toBe(2)
  })

  test('shares values across separately instantiated loader modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-pencil-docs-singleton-'))
    try {
      const source = new URL('../.vitepress/sdk/process-singleton.ts', import.meta.url)
      const firstPath = join(directory, 'one.ts')
      const secondPath = join(directory, 'two.ts')
      await Promise.all([copyFile(source, firstPath), copyFile(source, secondPath)])
      const firstModule: SingletonModule = await import(pathToFileURL(firstPath).href)
      const secondModule: SingletonModule = await import(pathToFileURL(secondPath).href)
      const identity = `test:bundles:${crypto.randomUUID()}`
      let creations = 0

      const first = firstModule.getOrCreateProcessSingleton(identity, () => ({ id: ++creations }))
      const second = secondModule.getOrCreateProcessSingleton(identity, () => ({ id: ++creations }))

      expect(firstModule.getOrCreateProcessSingleton).not.toBe(
        secondModule.getOrCreateProcessSingleton
      )
      expect(second).toBe(first)
      expect(creations).toBe(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
