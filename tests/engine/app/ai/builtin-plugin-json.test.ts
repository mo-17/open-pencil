import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_JSON_LIMITS,
  cloneBuiltinPluginJSON,
  type BuiltinPluginJSONObject
} from '@/app/ai/tools/builtin/json'

describe('built-in plugin bounded JSON clone', () => {
  test('defensively clones and deeply freezes plain JSON', () => {
    const source = {
      name: 'chart',
      nested: { enabled: true },
      values: [1, null, '界']
    }

    const cloned = cloneBuiltinPluginJSON(source) as BuiltinPluginJSONObject
    const nested = cloned.nested as BuiltinPluginJSONObject
    const values = cloned.values as readonly unknown[]

    expect(cloned).toEqual(source)
    expect(cloned).not.toBe(source)
    expect(Object.getPrototypeOf(cloned)).toBeNull()
    expect(Object.getPrototypeOf(nested)).toBeNull()
    expect(Object.isFrozen(cloned)).toBe(true)
    expect(Object.isFrozen(nested)).toBe(true)
    expect(Object.isFrozen(values)).toBe(true)

    source.nested.enabled = false
    source.values[0] = 2
    expect(nested.enabled).toBe(true)
    expect(values[0]).toBe(1)
  })

  test('rejects getters and setters without invoking them', () => {
    let getterCalls = 0
    const getter = {}
    Object.defineProperty(getter, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'not read'
      }
    })
    const setter = {}
    Object.defineProperty(setter, 'secret', {
      enumerable: true,
      set(_value: unknown) {
        throw new Error('must not run')
      }
    })

    expect(() => cloneBuiltinPluginJSON(getter)).toThrow('getters or setters')
    expect(() => cloneBuiltinPluginJSON(setter)).toThrow('getters or setters')
    expect(getterCalls).toBe(0)
  })

  test('rejects symbol, non-enumerable, and prototype-unsafe object keys', () => {
    const symbolic = { visible: true }
    Object.defineProperty(symbolic, Symbol('secret'), { value: true, enumerable: true })
    const hidden = { visible: true }
    Object.defineProperty(hidden, 'secret', { value: true, enumerable: false })

    expect(() => cloneBuiltinPluginJSON(symbolic)).toThrow('symbol properties')
    expect(() => cloneBuiltinPluginJSON(hidden)).toThrow('enumerable data properties')

    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const unsafe: object = Object.create(null)
      Object.defineProperty(unsafe, key, { value: true, enumerable: true })
      expect(() => cloneBuiltinPluginJSON(unsafe)).toThrow(`unsafe key: ${key}`)
    }
  })

  test('rejects non-plain objects and arrays', () => {
    class CustomRecord {
      value = 1
    }
    class CustomArray extends Array<number> {}

    expect(() => cloneBuiltinPluginJSON(new Date(0))).toThrow('plain objects')
    expect(() => cloneBuiltinPluginJSON(new CustomRecord())).toThrow('plain objects')
    expect(() => cloneBuiltinPluginJSON(Object.create({ inherited: true }))).toThrow(
      'plain objects'
    )
    expect(() => cloneBuiltinPluginJSON(new CustomArray(1))).toThrow('plain arrays')
  })

  test('rejects sparse arrays, custom properties, accessors, and symbols', () => {
    const custom = [1] as number[] & { extra?: number }
    custom.extra = 2
    const hiddenIndex = [1]
    Object.defineProperty(hiddenIndex, '0', { value: 1, enumerable: false })
    const accessorIndex = [1]
    Object.defineProperty(accessorIndex, '0', {
      enumerable: true,
      get() {
        throw new Error('must not run')
      }
    })
    const symbolic = [1]
    Object.defineProperty(symbolic, Symbol('secret'), { value: true, enumerable: true })
    const sparse = [1, 2, 3]
    Reflect.deleteProperty(sparse, '1')

    expect(() => cloneBuiltinPluginJSON(sparse)).toThrow('must not be sparse')
    expect(() => cloneBuiltinPluginJSON(custom)).toThrow('custom properties')
    expect(() => cloneBuiltinPluginJSON(hiddenIndex)).toThrow('enumerable data properties')
    expect(() => cloneBuiltinPluginJSON(accessorIndex)).toThrow('getters or setters')
    expect(() => cloneBuiltinPluginJSON(symbolic)).toThrow('symbol properties')
  })

  test('rejects cycles while accepting repeated acyclic values', () => {
    const direct: Record<string, unknown> = {}
    direct.self = direct
    const left: Record<string, unknown> = {}
    const right: Record<string, unknown> = { left }
    left.right = right

    expect(() => cloneBuiltinPluginJSON(direct)).toThrow('cycles')
    expect(() => cloneBuiltinPluginJSON(left)).toThrow('cycles')

    const shared = { value: 1 }
    const cloned = cloneBuiltinPluginJSON({
      first: shared,
      second: shared
    }) as BuiltinPluginJSONObject
    expect(cloned).toEqual({ first: { value: 1 }, second: { value: 1 } })
    expect(cloned.first).not.toBe(cloned.second)
  })

  test('rejects non-finite numbers and non-JSON primitives', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => cloneBuiltinPluginJSON(value)).toThrow('must be finite')
    }
    for (const value of [undefined, 1n, Symbol('value'), () => undefined]) {
      expect(() => cloneBuiltinPluginJSON(value)).toThrow('JSON values')
    }
  })

  test('enforces depth, node, and serialized UTF-8 byte limits', () => {
    expect(() => cloneBuiltinPluginJSON([[true]], { maxDepth: 1 })).toThrow('depth limit')
    expect(() => cloneBuiltinPluginJSON([1, 2, 3], { maxNodes: 3 })).toThrow('node limit')

    const multibyte = { text: '界' }
    const exactBytes = new TextEncoder().encode(JSON.stringify(multibyte)).byteLength
    expect(cloneBuiltinPluginJSON(multibyte, { maxBytes: exactBytes })).toEqual(multibyte)
    expect(() => cloneBuiltinPluginJSON(multibyte, { maxBytes: exactBytes - 1 })).toThrow(
      'UTF-8 byte limit'
    )
  })

  test('does not allow callers to raise the shared hard limits', () => {
    expect(() =>
      cloneBuiltinPluginJSON(null, { maxDepth: BUILTIN_PLUGIN_JSON_LIMITS.maxDepth + 1 })
    ).toThrow('depth limit must be between')
    expect(() =>
      cloneBuiltinPluginJSON(null, { maxNodes: BUILTIN_PLUGIN_JSON_LIMITS.maxNodes + 1 })
    ).toThrow('node limit must be between')
    expect(() =>
      cloneBuiltinPluginJSON(null, { maxBytes: BUILTIN_PLUGIN_JSON_LIMITS.maxBytes + 1 })
    ).toThrow('UTF-8 byte limit must be between')
  })
})
