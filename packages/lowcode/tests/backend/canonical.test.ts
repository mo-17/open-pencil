import { describe, expect, test } from 'bun:test'

import {
  canonicalBackendApplicationBytes,
  digestBackendApplication,
  parseBackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { backendApplicationFixture } from './fixture'

describe('Backend Core canonical serialization', () => {
  test('produces identical bytes and digest for equivalent key and collection order', async () => {
    const left = backendApplicationFixture()
    const right = backendApplicationFixture()
    right.capabilities.reverse()
    right.dataModel.entities[0].fields.reverse()
    right.auth.rowAccess[0].operations.reverse()
    const leftBytes = canonicalBackendApplicationBytes(left)
    const rightBytes = canonicalBackendApplicationBytes(right)
    expect([...leftBytes]).toEqual([...rightBytes])
    expect(await digestBackendApplication(left)).toBe(await digestBackendApplication(right))
    expect(await digestBackendApplication(left)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('rejects raw secret-bearing or executable extension fields before hashing', () => {
    const unsafe: unknown = {
      ...backendApplicationFixture(),
      secretValue: 'must-not-enter-canonical-data',
      sql: 'drop table notes'
    }
    const parsed = parseBackendApplicationSpecV1(unsafe)
    expect(parsed.ok).toBe(false)
    expect(() => canonicalBackendApplicationBytes(unsafe)).toThrow('backend-unknown-field')
  })
})
