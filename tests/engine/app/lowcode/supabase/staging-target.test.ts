import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_STAGING_TARGET_STORAGE_KEY,
  createSupabaseStagingTargetStore,
  parseSupabaseStagingTargetBinding,
  parseSupabaseStagingTargetBindingJSON,
  serializeSupabaseStagingTargetBinding,
  type BindSupabaseStagingTargetInput
} from '@/app/lowcode/supabase/staging-target'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'org_01.example-account'
const BOUND_AT = '2026-09-02T01:02:03.004Z'

const BINDING = Object.freeze({
  schemaVersion: 1,
  projectRef: PROJECT_REF,
  accountId: ACCOUNT_ID,
  boundAt: BOUND_AT
})

const CONFIRMATION: BindSupabaseStagingTargetInput = Object.freeze({
  projectRef: PROJECT_REF,
  accountId: ACCOUNT_ID,
  projectRefConfirmation: PROJECT_REF,
  confirmedIndependentStaging: true
})

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

describe('Supabase staging target binding', () => {
  test('binds, reads, and clears one exact non-secret V1 record under the dedicated key', () => {
    const storage = new MemoryStorage()
    const store = createSupabaseStagingTargetStore(storage, () => BOUND_AT)

    expect(store.read()).toBeNull()
    const bound = store.bind(CONFIRMATION)
    expect(bound).toEqual(BINDING)
    expect(Object.isFrozen(bound)).toBeTrue()

    const raw = storage.getItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)
    expect(raw).toBe(JSON.stringify(BINDING))
    expect(Object.keys(JSON.parse(raw as string))).toEqual([
      'schemaVersion',
      'projectRef',
      'accountId',
      'boundAt'
    ])
    expect(raw).not.toContain('personalAccessToken')
    expect(raw).not.toContain('grantGeneration')

    const read = store.read()
    expect(read).toEqual(bound)
    expect(read).not.toBe(bound)
    expect(Object.isFrozen(read)).toBeTrue()

    store.clear()
    expect(store.read()).toBeNull()
  })

  test('requires exact project confirmation and a literal independent-staging decision', () => {
    const storage = new MemoryStorage()
    const store = createSupabaseStagingTargetStore(storage, () => BOUND_AT)
    const invalid: unknown[] = [
      { ...CONFIRMATION, projectRefConfirmation: 'ABCDEFGHIJKLMNOPQRST' },
      { ...CONFIRMATION, projectRefConfirmation: 'abcdefghijklmnopqrsu' },
      { ...CONFIRMATION, confirmedIndependentStaging: false },
      { ...CONFIRMATION, environment: 'staging' },
      { ...CONFIRMATION, production: false },
      { ...CONFIRMATION, preview: false },
      { ...CONFIRMATION, personalAccessToken: 'sbp_must-not-be-stored' },
      { ...CONFIRMATION, grantGeneration: '123e4567-e89b-42d3-a456-426614174000' }
    ]

    for (const candidate of invalid) {
      expect(() => store.bind(candidate as BindSupabaseStagingTargetInput)).toThrow(
        'Supabase staging target confirmation is invalid'
      )
      expect(storage.getItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)).toBeNull()
    }
  })

  test('strictly parses and clones only canonical plain data records', () => {
    const source: {
      schemaVersion: number
      projectRef: string
      accountId: string
      boundAt: string
    } = { ...BINDING }
    const parsed = parseSupabaseStagingTargetBinding(source)
    source.accountId = 'changed-after-parse'
    expect(parsed).toEqual(BINDING)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBeTrue()
    expect(
      parseSupabaseStagingTargetBindingJSON(serializeSupabaseStagingTargetBinding(parsed))
    ).toEqual(BINDING)
    expect(
      parseSupabaseStagingTargetBinding({ ...BINDING, accountId: 'eyj-valid-public-id' }).accountId
    ).toBe('eyj-valid-public-id')

    const accessor = { ...BINDING }
    let accessorRead = false
    Object.defineProperty(accessor, 'accountId', {
      enumerable: true,
      get() {
        accessorRead = true
        return ACCOUNT_ID
      }
    })
    expect(() => parseSupabaseStagingTargetBinding(accessor)).toThrow(
      'Stored Supabase staging target binding is invalid'
    )
    expect(accessorRead).toBeFalse()

    expect(() =>
      parseSupabaseStagingTargetBinding(Object.assign(Object.create({}), BINDING))
    ).toThrow('Stored Supabase staging target binding is invalid')
    expect(() =>
      parseSupabaseStagingTargetBinding({ ...BINDING, [Symbol('extension')]: true })
    ).toThrow('Stored Supabase staging target binding is invalid')
    expect(() => parseSupabaseStagingTargetBinding(new Proxy({ ...BINDING }, {}))).toThrow(
      'Stored Supabase staging target binding is invalid'
    )
  })

  test('rejects invalid identities, secret-like account values, extensions, and timestamps', () => {
    const invalid = [
      { ...BINDING, schemaVersion: 2 },
      { ...BINDING, projectRef: 'abcdefghijklmnopqrs' },
      { ...BINDING, projectRef: 'abcdefghijklmnopqrs1' },
      { ...BINDING, projectRef: 'ABCDEFGHIJKLMNOPQRST' },
      { ...BINDING, accountId: '' },
      { ...BINDING, accountId: 'account id' },
      { ...BINDING, accountId: 'a'.repeat(129) },
      { ...BINDING, accountId: 'sbp_secret-shaped-value' },
      { ...BINDING, accountId: 'sb_secret_secret-shaped-value' },
      { ...BINDING, accountId: 'eyJsecretShapedJwt' },
      { ...BINDING, boundAt: '2026-09-02T01:02:03Z' },
      { ...BINDING, boundAt: '2026-09-02T09:02:03.004+08:00' },
      { ...BINDING, boundAt: 'not-a-timestamp' },
      { ...BINDING, environment: 'staging' },
      { ...BINDING, production: false },
      { ...BINDING, preview: false },
      { ...BINDING, personalAccessToken: 'sbp_must-not-be-stored' },
      { ...BINDING, grantGeneration: '123e4567-e89b-42d3-a456-426614174000' }
    ]

    for (const candidate of invalid) {
      expect(() => parseSupabaseStagingTargetBinding(candidate)).toThrow(
        'Stored Supabase staging target binding is invalid'
      )
    }
  })

  test('fails closed on corrupt, oversized, or non-canonical persisted data and clock output', () => {
    const storage = new MemoryStorage()
    const store = createSupabaseStagingTargetStore(storage, () => '2026-09-02T01:02:03Z')

    expect(() => store.bind(CONFIRMATION)).toThrow(
      'Stored Supabase staging target binding is invalid'
    )
    expect(storage.getItem(SUPABASE_STAGING_TARGET_STORAGE_KEY)).toBeNull()

    for (const raw of [
      '{',
      JSON.stringify({ ...BINDING, environment: 'production' }),
      'x'.repeat(2049)
    ]) {
      storage.setItem(SUPABASE_STAGING_TARGET_STORAGE_KEY, raw)
      expect(() => store.read()).toThrow('Stored Supabase staging target binding is invalid')
    }
  })
})
