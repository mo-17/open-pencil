import { describe, expect, test } from 'bun:test'

import {
  MODULE_INSTANCE_LIMITS,
  cloneModuleInstance,
  moduleDefinitionKey,
  moduleInstanceKey,
  readModuleInstance,
  validateModuleIdentity,
  validateModuleInstance,
  type ModuleInstanceV1
} from '@open-pencil/scene-graph'

function instance(config: Record<string, unknown> = {}): ModuleInstanceV1 {
  return {
    version: 1,
    pluginId: 'test.plugin',
    moduleType: 'example',
    configVersion: 1,
    config
  }
}

describe('ModuleInstanceV1', () => {
  test('validates, clones, and keys a strict JSON envelope', () => {
    const source = instance({ nested: { enabled: true }, values: [1, 'two', null] })
    const result = validateModuleInstance(source)
    expect(result.ok).toBe(true)
    expect(readModuleInstance(source)).toEqual(source)
    expect(moduleDefinitionKey('test.plugin', 'example')).toBe('test.plugin/example')
    expect(moduleInstanceKey(source)).toBe('test.plugin/example')

    const cloned = cloneModuleInstance(source)
    expect(cloned).toEqual(source)
    expect(cloned).not.toBe(source)
    expect(cloned.config).not.toBe(source.config)
  })

  test('rejects unknown envelope keys, unsafe keys, and non-JSON values', () => {
    expect(validateModuleInstance({ ...instance(), extra: true })).toMatchObject({ ok: false })
    expect(validateModuleInstance(instance({ value: undefined }))).toMatchObject({ ok: false })
    expect(validateModuleInstance(instance({ value: Number.NaN }))).toMatchObject({ ok: false })
    expect(
      validateModuleInstance(instance(JSON.parse('{"__proto__":{"polluted":true}}')))
    ).toMatchObject({ ok: false })
  })

  test('enforces identity, depth, and serialized-size limits', () => {
    expect(validateModuleInstance({ ...instance(), pluginId: 'Bad Plugin' })).toMatchObject({
      ok: false
    })

    let nested: Record<string, unknown> = {}
    for (let index = 0; index < MODULE_INSTANCE_LIMITS.maxDepth + 2; index += 1) {
      nested = { child: nested }
    }
    expect(validateModuleInstance(instance(nested))).toMatchObject({ ok: false })

    const large: Record<string, unknown> = {}
    for (let index = 0; index < 5; index += 1) large[`part${index}`] = 'x'.repeat(14_000)
    const result = validateModuleInstance(instance(large))
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.reason).toContain('serialized size')
  })

  test('rejects sparse arrays and circular references', () => {
    const sparse: unknown[] = []
    sparse.length = 2
    sparse[1] = 'value'
    expect(validateModuleInstance(instance({ sparse }))).toMatchObject({ ok: false })

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(validateModuleInstance(instance(circular))).toMatchObject({ ok: false })
  })

  test('accepts exact JSON collection limits and rejects the first excess item', () => {
    const maxConfigEntries = MODULE_INSTANCE_LIMITS.maxEntries - 5
    const atEntryLimit = Object.fromEntries(
      Array.from({ length: maxConfigEntries }, (_, index) => [`k${index}`, index])
    )
    expect(validateModuleInstance(instance(atEntryLimit))).toMatchObject({ ok: true })
    expect(validateModuleInstance(instance({ ...atEntryLimit, overflow: true }))).toMatchObject({
      ok: false
    })

    expect(
      validateModuleInstance(
        instance({ values: Array.from({ length: MODULE_INSTANCE_LIMITS.maxArrayItems }, () => 0) })
      )
    ).toMatchObject({ ok: true })
    expect(
      validateModuleInstance(
        instance({
          values: Array.from({ length: MODULE_INSTANCE_LIMITS.maxArrayItems + 1 }, () => 0)
        })
      )
    ).toMatchObject({ ok: false })
  })

  test('enforces exact key, string, identity, and config-version boundaries', () => {
    const maxKey = 'k'.repeat(MODULE_INSTANCE_LIMITS.maxKeyLength)
    const maxString = 'x'.repeat(MODULE_INSTANCE_LIMITS.maxStringLength)
    expect(validateModuleInstance(instance({ [maxKey]: maxString }))).toMatchObject({ ok: true })
    expect(validateModuleInstance(instance({ [`${maxKey}k`]: 'value' }))).toMatchObject({
      ok: false
    })
    expect(validateModuleInstance(instance({ value: `${maxString}x` }))).toMatchObject({
      ok: false
    })

    const maxIdentity = 'a'.repeat(MODULE_INSTANCE_LIMITS.maxIdentityLength)
    expect(validateModuleIdentity(maxIdentity)).toBeNull()
    expect(validateModuleIdentity(`${maxIdentity}a`)).toContain('maximum length')
    expect(validateModuleInstance({ ...instance(), pluginId: maxIdentity })).toMatchObject({
      ok: true
    })

    expect(
      validateModuleInstance({ ...instance(), configVersion: Number.MAX_SAFE_INTEGER })
    ).toMatchObject({ ok: true })
    for (const configVersion of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateModuleInstance({ ...instance(), configVersion })).toMatchObject({ ok: false })
    }
  })
})
