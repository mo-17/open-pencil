import { describe, expect, test } from 'bun:test'

import { createStorageRuntimeRegistry } from '@/app/integrations/storage/shared/runtime'

describe('storage runtime registry', () => {
  test('does not retain a disposed entry when replacement construction fails', () => {
    const registry = createStorageRuntimeRegistry<
      object,
      Readonly<{ id: string; oauth: Readonly<{ dispose(): void }> }>
    >()
    const manager = {}
    let disposedOriginal = 0
    let disposedReplacement = 0
    const original = {
      id: 'original',
      oauth: { dispose: () => disposedOriginal++ }
    }
    const replacement = {
      id: 'replacement',
      oauth: { dispose: () => disposedReplacement++ }
    }

    expect(
      registry.getOrCreate(
        manager,
        'default',
        () => false,
        () => original
      )
    ).toBe(original)
    expect(() =>
      registry.getOrCreate(
        manager,
        'default',
        () => false,
        () => {
          throw new Error('replacement construction failed')
        }
      )
    ).toThrow('replacement construction failed')
    expect(disposedOriginal).toBe(1)

    let matchedStaleEntry = false
    expect(
      registry.getOrCreate(
        manager,
        'default',
        () => {
          matchedStaleEntry = true
          return true
        },
        () => replacement
      )
    ).toBe(replacement)
    expect(matchedStaleEntry).toBe(false)

    registry.reset()
    expect(disposedOriginal).toBe(1)
    expect(disposedReplacement).toBe(1)
  })
})
