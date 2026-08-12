import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_PARAMETER_SCHEMA_LIMITS,
  parsePluginObjectParameterSchema,
  parsePluginObjectParameterValue,
  parsePluginParameterSchema
} from '@open-pencil/core/plugins'

function nestedArraySchema(depth: number): Record<string, unknown> {
  if (depth === 0) return { type: 'boolean' }
  return { type: 'array', items: nestedArraySchema(depth - 1) }
}

describe('plugin parameter schema', () => {
  test('normalizes a strict bounded object schema', () => {
    const parsed = parsePluginObjectParameterSchema({
      type: 'object',
      title: 'Export options',
      properties: {
        format: { type: 'string', enum: ['css', 'json'] },
        collections: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 128 },
          maxItems: 64
        },
        resolveAliases: { type: 'boolean' }
      },
      required: ['format'],
      additionalProperties: false
    })

    expect(parsed.additionalProperties).toBe(false)
    expect(parsed.required).toEqual(['format'])
    expect(parsed.properties.collections).toMatchObject({ type: 'array', maxItems: 64 })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.properties)).toBe(true)
  })

  test('rejects executable or open-ended JSON Schema features', () => {
    for (const unsupported of [
      { type: 'string', $ref: '#/$defs/name' },
      { type: 'string', oneOf: [{ type: 'string' }] },
      { type: 'string', pattern: '.*' },
      { type: 'object', properties: {}, additionalProperties: true }
    ]) {
      expect(() => parsePluginParameterSchema(unsupported)).toThrow()
    }
  })

  test('rejects schema accessors and toJSON without executing them', () => {
    let toJSONCalled = false
    const withToJSON = {
      type: 'string',
      toJSON() {
        toJSONCalled = true
        return { type: 'string' }
      }
    }
    expect(() => parsePluginParameterSchema(withToJSON)).toThrow('only JSON values')
    expect(toJSONCalled).toBe(false)

    let getterCalled = false
    const withGetter: Record<string, unknown> = {}
    Object.defineProperty(withGetter, 'type', {
      enumerable: true,
      get() {
        getterCalled = true
        return 'string'
      }
    })
    expect(() => parsePluginParameterSchema(withGetter)).toThrow('JSON data properties')
    expect(getterCalled).toBe(false)
  })

  test('validates required names, property safety, automation targets, and scalar bounds', () => {
    expect(() =>
      parsePluginObjectParameterSchema({
        type: 'object',
        properties: { format: { type: 'string' } },
        required: ['missing']
      })
    ).toThrow('only reference declared properties')

    expect(() =>
      parsePluginObjectParameterSchema({
        type: 'object',
        properties: JSON.parse('{"__proto__":{"type":"string"}}')
      })
    ).toThrow('invalid property name')

    expect(() =>
      parsePluginObjectParameterSchema(
        {
          type: 'object',
          properties: { document_id: { type: 'string' } }
        },
        'parameters',
        { reserveAutomationTargets: true }
      )
    ).toThrow('reserved automation target')

    expect(() => parsePluginParameterSchema({ type: 'number', multipleOf: 0 })).toThrow(
      'greater than zero'
    )
    expect(() =>
      parsePluginParameterSchema({ type: 'string', minLength: 3, maxLength: 2 })
    ).toThrow('may not exceed')
    expect(() => parsePluginParameterSchema({ type: 'integer', enum: [1, 1.5] })).toThrow(
      'must match schema type'
    )
  })

  test('enforces byte, depth, node, and property limits independently', () => {
    expect(() =>
      parsePluginParameterSchema({
        type: 'string',
        description: 'x'.repeat(PLUGIN_PARAMETER_SCHEMA_LIMITS.maxBytes)
      })
    ).toThrow('byte limit')

    expect(() => parsePluginParameterSchema(nestedArraySchema(13))).toThrow('depth limit')

    const tooManyProperties = Object.fromEntries(
      Array.from({ length: PLUGIN_PARAMETER_SCHEMA_LIMITS.maxProperties + 1 }, (_, index) => [
        `field${index}`,
        { type: 'boolean' }
      ])
    )
    expect(() =>
      parsePluginObjectParameterSchema({ type: 'object', properties: tooManyProperties })
    ).toThrow('at most 128 properties')

    const nodeHeavyProperties = Object.fromEntries(
      Array.from({ length: PLUGIN_PARAMETER_SCHEMA_LIMITS.maxProperties }, (_, index) => [
        `group${index}`,
        {
          type: 'object',
          properties: {
            a: { type: 'boolean' },
            b: { type: 'boolean' },
            c: { type: 'boolean' }
          }
        }
      ])
    )
    expect(() =>
      parsePluginObjectParameterSchema({ type: 'object', properties: nodeHeavyProperties })
    ).toThrow('node limit')
  })

  test('validates and defensively clones bounded plain JSON values against the schema', () => {
    const schema = parsePluginObjectParameterSchema({
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'css'] },
        precision: { type: 'integer', minimum: 0, maximum: 8 },
        tags: { type: 'array', items: { type: 'string', maxLength: 8 }, maxItems: 3 }
      },
      required: ['format'],
      additionalProperties: false
    })
    const source = { format: 'json', precision: 2, tags: ['ui'] }
    const parsed = parsePluginObjectParameterValue(source, schema, 256)

    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.tags)).toBe(true)
    expect(() => parsePluginObjectParameterValue({ format: 'xml' }, schema, 256)).toThrow(
      'allowed enum'
    )
    expect(
      parsePluginObjectParameterValue(
        { value: '😀' },
        parsePluginObjectParameterSchema({
          type: 'object',
          properties: { value: { type: 'string', maxLength: 1 } },
          required: ['value'],
          additionalProperties: false
        }),
        32
      )
    ).toEqual({ value: '😀' })
    expect(() => parsePluginObjectParameterValue({ precision: 2 }, schema, 256)).toThrow(
      'format is required'
    )
    expect(() =>
      parsePluginObjectParameterValue({ format: 'json', extra: true }, schema, 256)
    ).toThrow('not supported')
  })

  test('rejects accessors, unsafe keys, sparse arrays, cycles, and oversized values', () => {
    const schema = parsePluginObjectParameterSchema({
      type: 'object',
      properties: {
        value: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    })
    let getterCalled = false
    const accessor: Record<string, unknown> = {}
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get() {
        getterCalled = true
        return 'secret'
      }
    })
    expect(() => parsePluginObjectParameterValue(accessor, schema, 256)).toThrow(
      'JSON data properties'
    )
    expect(getterCalled).toBe(false)
    expect(() =>
      parsePluginObjectParameterValue(JSON.parse('{"__proto__":{"polluted":true}}'), schema, 256)
    ).toThrow('unsafe key')

    const sparse: string[] = []
    sparse.length = 2
    sparse[0] = 'one'
    expect(() => parsePluginObjectParameterValue({ items: sparse }, schema, 256)).toThrow(
      'array holes'
    )
    const cyclic: Record<string, unknown> = {}
    cyclic.value = cyclic
    expect(() => parsePluginObjectParameterValue(cyclic, schema, 256)).toThrow()
    expect(() => parsePluginObjectParameterValue({ value: 'x'.repeat(128) }, schema, 32)).toThrow(
      'contract limit'
    )
  })
})
