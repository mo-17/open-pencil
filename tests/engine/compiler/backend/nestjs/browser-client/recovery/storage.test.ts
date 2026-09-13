import { describe, expect, test } from 'bun:test'

import { commandInput, recoveryEnvironment, recoveryFixture, recoveryInput } from './helpers'

describe('command recovery persistence failures', () => {
  test.each([
    { keyPath: 'key' },
    { keyPath: null },
    { keyPath: ['slot'] },
    { keyPath: 'slot', autoIncrement: true }
  ])('rejects an incompatible pre-existing object-store schema %j before HTTP', async (options) => {
    const environment = recoveryEnvironment()
    const factory = environment.indexedDB
    if (!factory) throw new Error('Test IndexedDB factory is required')
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('openpencil:backend-command-journal:v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('attempts', options)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })
    const fixture = await recoveryFixture(environment)
    try {
      await expect(fixture.runtime.backendCommand(commandInput)).rejects.toMatchObject({
        status: 503
      })
      await expect(
        fixture.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
      ).rejects.toMatchObject({ status: 503 })
      expect(fixture.pending).toHaveLength(0)
      expect(fixture.values.get('attempt')).toBe('')
    } finally {
      fixture.dispose()
    }
  })

  test.each(['indexedDB', 'locks', 'quota', 'abort'] as const)(
    'blocks HTTP when %s is unavailable or fails before commit',
    async (mode) => {
      const environment = recoveryEnvironment()
      if (mode === 'indexedDB') environment.indexedDB = undefined
      if (mode === 'locks') environment.locks = undefined
      if (mode === 'quota' && environment.indexedDB)
        environment.indexedDB.open = () => {
          throw new DOMException('Private storage detail', 'QuotaExceededError')
        }
      if (mode === 'abort') {
        const factory = environment.indexedDB
        if (!factory) throw new Error('Test IndexedDB factory is required')
        const original = factory.open.bind(factory)
        factory.open = (...args) => {
          const request = original(...args)
          request.addEventListener('success', () => {
            const database = request.result
            const transaction = database.transaction.bind(database)
            database.transaction = (...input) => {
              const tx = transaction(...input)
              const objectStore = tx.objectStore.bind(tx)
              tx.objectStore = (name) => {
                const store = objectStore(name)
                const add = store.add.bind(store)
                store.add = (...values) => {
                  const pending = add(...values)
                  tx.abort()
                  return pending
                }
                return store
              }
              return tx
            }
          })
          return request
        }
      }
      const fixture = await recoveryFixture(environment)
      try {
        await expect(fixture.runtime.backendCommand(commandInput)).rejects.toMatchObject({
          status: 503,
          message: 'Backend command failed.'
        })
        expect(fixture.pending).toHaveLength(0)
        expect(fixture.values.get('attempt')).toBe('')
        if (mode === 'abort')
          expect(
            await fixture.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
          ).toMatchObject({ data: { status: 'empty' } })
        // The default, non-persistent command path remains usable on platforms without journal APIs.
        const memory = fixture.runtime.backendCommand({ ...commandInput, recovery: undefined })
        const request = await fixture.waitForRequest(0)
        request.respond({ id: 'memory-only', title: 'Memory' })
        await memory
      } finally {
        fixture.dispose()
      }
    }
  )

  test('bounds a blocked IndexedDB open and releases the same-slot lock', async () => {
    const environment = recoveryEnvironment()
    environment.indexedDB = {
      open() {
        const request = {} as IDBOpenDBRequest
        queueMicrotask(() => request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent))
        return request
      }
    } as IDBFactory
    const fixture = await recoveryFixture(environment)
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(fixture.runtime.backendCommand(commandInput)).rejects.toMatchObject({
          status: 503
        })
        expect(fixture.values.get('attempt')).toBe('')
      }
      expect(fixture.pending).toHaveLength(0)
    } finally {
      fixture.dispose()
    }
  })

  test.each(['open', 'transaction', 'abort-event'] as const)(
    'times out a hanging %s without dispatch and releases its lock',
    async (mode) => {
      const environment = recoveryEnvironment()
      environment.storageTimeoutMs = 25
      environment.indexedDB = {
        open() {
          const request = {} as IDBOpenDBRequest
          if (mode === 'open') return request
          const database = {
            close() {
              return undefined
            },
            transaction() {
              const tx = {
                objectStore() {
                  return {
                    get() {
                      return {}
                    }
                  }
                },
                abort() {
                  if (mode !== 'abort-event') queueMicrotask(() => tx.onabort?.(new Event('abort')))
                },
                onabort: undefined as undefined | ((event: Event) => void)
              }
              return tx
            }
          }
          Object.defineProperty(request, 'result', { value: database })
          queueMicrotask(() => request.onsuccess?.(new Event('success')))
          return request
        }
      } as IDBFactory
      const fixture = await recoveryFixture(environment)
      try {
        for (let attempt = 0; attempt < 2; attempt++)
          await expect(fixture.runtime.backendCommand(commandInput)).rejects.toMatchObject({
            status: 503
          })
        expect(fixture.pending).toHaveLength(0)
        expect(fixture.values.get('attempt')).toBe('')
      } finally {
        fixture.dispose()
      }
    }
  )
})
