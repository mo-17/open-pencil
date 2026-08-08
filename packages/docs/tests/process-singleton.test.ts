import { describe, expect, test } from 'bun:test'

import { getOrCreateProcessSingleton } from '../.vitepress/sdk/process-singleton'

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
    const firstModule = await import('../.vitepress/sdk/process-singleton?copy=one')
    const secondModule = await import('../.vitepress/sdk/process-singleton?copy=two')
    const identity = `test:bundles:${crypto.randomUUID()}`
    let creations = 0

    const first = firstModule.getOrCreateProcessSingleton(identity, () => ({ id: ++creations }))
    const second = secondModule.getOrCreateProcessSingleton(identity, () => ({ id: ++creations }))

    expect(firstModule.getOrCreateProcessSingleton).not.toBe(
      secondModule.getOrCreateProcessSingleton
    )
    expect(second).toBe(first)
    expect(creations).toBe(1)
  })
})
