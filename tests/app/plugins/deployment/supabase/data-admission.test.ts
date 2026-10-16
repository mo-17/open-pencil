import { describe, expect, test } from 'bun:test'

import {
  createSupabaseDataAdmission,
  isPlainSupabaseDataRecord,
  readSupabaseDataProperty
} from '@/app/plugins/host/deployment/supabase/data-admission'

const admission = createSupabaseDataAdmission((code: 'request' | 'response') => {
  throw new Error(code)
})

describe('Supabase data admission', () => {
  test('admits ordinary and null-prototype records while rejecting other shapes', () => {
    const ordinary = { value: 1 }
    const nullPrototype = Object.setPrototypeOf({ value: 2 }, null)
    expect(admission.plainRecord(ordinary, 'request')).toBe(ordinary)
    expect(admission.plainRecord(nullPrototype, 'request')).toBe(nullPrototype)
    for (const value of [null, undefined, [], new Date(), Object.setPrototypeOf({}, ordinary)]) {
      expect(() => admission.plainRecord(value, 'request')).toThrow('request')
    }
  })

  test('reads own enumerable data without invoking accessors or accepting inherited fields', () => {
    let getterCalls = 0
    const value = Object.defineProperties(
      {},
      {
        secret: {
          enumerable: true,
          get: () => {
            getterCalls++
            return 'hidden'
          }
        },
        hidden: { enumerable: false, value: 1 },
        empty: { enumerable: true, value: undefined }
      }
    )
    expect(admission.ownData(value, 'empty', 'response')).toBeUndefined()
    for (const key of ['secret', 'hidden', 'toString', 'missing']) {
      expect(() => admission.ownData(value, key, 'response')).toThrow('response')
    }
    expect(getterCalls).toBe(0)
  })

  test('keeps eager record validation separate from lazy property admission', () => {
    let getterCalls = 0
    const value = {
      get unread() {
        getterCalls++
        return 1
      }
    }
    expect(admission.plainRecord(value, 'request')).toBe(value)
    expect(() => admission.enumerableRecord(value, 'response')).toThrow('response')
    expect(getterCalls).toBe(0)
    const symbol = Symbol('unreviewed extension')
    const withSymbol = { [symbol]: 1 }
    expect(admission.ownKeys(withSymbol, 'response')).toEqual([symbol])
    expect(admission.ownData(withSymbol, symbol, 'response')).toBe(1)
    expect(() => admission.enumerableRecord(withSymbol, 'response')).toThrow('response')
  })

  test('translates guarded reflection failures using the caller error and outcome exactly once', () => {
    const failure = new Error('caller-owned error')
    const outcome = { dispatched: false }
    const seen: Array<readonly ['invalid', typeof outcome]> = []
    const guarded = createSupabaseDataAdmission((code: 'invalid', context: typeof outcome) => {
      seen.push([code, context])
      throw failure
    })
    const malformed = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('untrusted reflection trap')
        }
      }
    )
    expect(() => guarded.ownData(malformed, 'value', 'invalid', outcome)).toThrow(failure)
    expect(seen).toEqual([['invalid', outcome]])
    expect(seen[0]?.[1]).toBe(outcome)
  })

  test('translates throwing prototype and key traps without reading object fields', () => {
    const badPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('prototype trap')
        }
      }
    )
    const badKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('key trap')
        }
      }
    )
    expect(() => admission.plainRecord(badPrototype, 'request')).toThrow('request')
    expect(() => admission.ownKeys(badKeys, 'response')).toThrow('response')
  })

  test('leaves reflection errors observable for callers with an unguarded contract', () => {
    const reflectionFailure = new Error('native reflection failure')
    const invalid = () => {
      throw new Error('translated input error')
    }
    const badDescriptor = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw reflectionFailure
        }
      }
    )
    const badPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw reflectionFailure
        }
      }
    )
    expect(() => readSupabaseDataProperty(badDescriptor, 'value', invalid)).toThrow(
      reflectionFailure
    )
    expect(() => isPlainSupabaseDataRecord(badPrototype)).toThrow(reflectionFailure)
    expect(() => readSupabaseDataProperty({}, 'missing', invalid)).toThrow('translated input error')
  })

  test('freezes independent data snapshots without invoking accessors or admitting extra keys', () => {
    const original = Object.defineProperty({ value: 1 }, '__proto__', {
      enumerable: true,
      value: 'data'
    })
    const snapshot = admission.snapshotRecord(original, ['value', '__proto__'], 'request')
    original.value = 2
    expect(snapshot.value).toBe(1)
    expect(Object.getOwnPropertyDescriptor(snapshot, '__proto__')?.value).toBe('data')
    expect(Object.getPrototypeOf(snapshot)).toBeNull()
    expect(Object.isFrozen(snapshot)).toBe(true)
    let reads = 0
    const accessor = {
      get value() {
        reads++
        return 1
      }
    }
    expect(() => admission.snapshotRecord(accessor, ['value'], 'response')).toThrow('response')
    expect(() =>
      admission.snapshotRecord({ value: 1, [Symbol('extra')]: true }, ['value'], 'response')
    ).toThrow('response')
    expect(() => admission.exactRecord({ value: 1, extra: 2 }, ['value'], 'response')).toThrow(
      'response'
    )
    expect(reads).toBe(0)
  })

  test('preserves distinct row-array prototype and revoked-proxy admission contracts', () => {
    const row = { value: 1 }
    const array = Object.setPrototypeOf([row], null)
    expect(admission.singleItem(array, 'request')).toBe(row)
    expect(() => admission.canonicalSingleItem(array, 'response', false)).toThrow('response')
    expect(admission.canonicalSingleItem([row], 'request', false)).toBe(row)
    for (const value of [[], [row, row], Object.assign([row], { extra: true })]) {
      expect(() => admission.canonicalSingleItem(value, 'response', true)).toThrow('response')
    }
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    expect(() => admission.canonicalSingleItem(revoked.proxy, 'request', false)).toThrow(TypeError)
    expect(() => admission.canonicalSingleItem(revoked.proxy, 'response', true)).toThrow('response')
  })
})
