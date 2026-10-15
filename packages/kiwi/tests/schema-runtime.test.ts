import { describe, expect, test } from 'bun:test'

import {
  ByteBuffer,
  compileSchema,
  decodeBinarySchema,
  encodeBinarySchema,
  expectEnumValue,
  expectFieldNumber,
  KIWI_RUNTIME_LIMITS,
  parseSchema,
  type Field,
  type Schema,
  validateSchema
} from '../src/schema-runtime'
import type { RuntimeMessage, RuntimeCodec } from '../src/schema-runtime/interpreter'

function decode(codec: RuntimeCodec, method: string, value: ByteBuffer | Uint8Array): unknown {
  const decoder = codec[method]
  if (typeof decoder !== 'function') throw new Error(`Missing codec method ${method}`)
  return Reflect.apply(decoder, codec, [value])
}

test('rejects malformed byte fields without corrupting buffer length', () => {
  const buffer = new ByteBuffer()
  expect(() => Reflect.apply(buffer.writeByteArray, buffer, [{ 0: 42 }])).toThrow(
    'Expected byte array'
  )
  expect(buffer.length).toBe(0)
  buffer.writeByteArray(new Uint8Array([42]))
  expect(buffer.toUint8Array()).toEqual(new Uint8Array([1, 42]))
})

const schemaText = `
package Example;

enum Kind {
  CARD = 1;
  BADGE = 2;
}

message Item {
  uint id = 1;
  string name = 2;
  Kind kind = 3;
  string[] tags = 4;
}
`

describe('Kiwi schema runtime', () => {
  test('parses and validates inline schemas', () => {
    const schema = parseSchema(schemaText)
    validateSchema(schema)

    expectFieldNumber(schema, 'Item', 'name', 2)
    expectFieldNumber(schema, 'Item', 'tags', 4)
    expectEnumValue(schema, 'Kind', 'BADGE', 2)
  })

  test('compiles schemas and round-trips messages', () => {
    const schema = parseSchema(schemaText)
    const codec = compileSchema(schema)
    const encodeItem = codec.encodeItem as (value: RuntimeMessage) => Uint8Array
    const decodeItem = codec.decodeItem as (value: Uint8Array) => RuntimeMessage

    const encoded = encodeItem({ id: 42, name: 'OpenPencil', kind: 'CARD', tags: ['kiwi'] })
    expect(encoded.length).toBeGreaterThan(0)
    expect(decodeItem(encoded)).toEqual({
      id: 42,
      name: 'OpenPencil',
      kind: 'CARD',
      tags: ['kiwi']
    })
  })

  test('applies array budgets only to codecs compiled with limits', () => {
    const schema = parseSchema(`
        message Batch {
          uint[] values = 1;
        }
      `)
    const legacyCodec = compileSchema(schema)
    const limitedCodec = compileSchema(schema, { limits: { maxArrayItems: 1 } })
    const encoded = new ByteBuffer()
    encoded.writeVarUint(1)
    encoded.writeVarUint(2)
    encoded.writeVarUint(7)
    encoded.writeVarUint(8)
    encoded.writeVarUint(0)

    expect(decode(legacyCodec, 'decodeBatch', encoded.toUint8Array())).toEqual({ values: [7, 8] })
    expect(() => decode(limitedCodec, 'decodeBatch', encoded.toUint8Array())).toThrow(
      'Kiwi array item limit exceeded (1 per message)'
    )
  })

  test('freezes codec limits and applies them through a ByteBuffer override', () => {
    const schema = parseSchema(`
        message Batch {
          uint[] values = 1;
        }
      `)
    const limits = { maxArrayItems: 1 }
    const codec = compileSchema(schema, { limits })
    const encoded = new ByteBuffer()
    encoded.writeVarUint(1)
    encoded.writeVarUint(2)
    encoded.writeVarUint(7)
    encoded.writeVarUint(8)
    encoded.writeVarUint(0)

    limits.maxArrayItems = 10
    expect(() => decode(codec, 'decodeBatch', encoded.toUint8Array())).toThrow(
      'Kiwi array item limit exceeded (1 per message)'
    )

    const validBaseBuffer = new ByteBuffer()
    validBaseBuffer.writeVarUint(1)
    validBaseBuffer.writeVarUint(1)
    validBaseBuffer.writeVarUint(7)
    validBaseBuffer.writeVarUint(0)
    expect(decode(codec, 'decodeBatch', validBaseBuffer)).toEqual({ values: [7] })
    expect(validBaseBuffer.offset).toBe(validBaseBuffer.length)

    const baseBuffer = new ByteBuffer(encoded.toUint8Array())
    expect(() => decode(codec, 'decodeBatch', baseBuffer)).toThrow(
      'Kiwi array item limit exceeded (1 per message)'
    )
    expect(baseBuffer.offset).toBeGreaterThan(0)

    class CustomByteBuffer extends ByteBuffer {
      static constructions = 0

      constructor(...args: ConstructorParameters<typeof ByteBuffer>) {
        super(...args)
        CustomByteBuffer.constructions++
      }
    }
    codec.ByteBuffer = CustomByteBuffer
    expect(() => decode(codec, 'decodeBatch', encoded.toUint8Array())).toThrow(
      'Kiwi array item limit exceeded (1 per message)'
    )
    expect(CustomByteBuffer.constructions).toBe(1)
  })

  test('applies decode depth only to codecs compiled with limits and unwinds after failure', () => {
    const schema = parseSchema(`
        message Link {
          Link next = 1;
        }
      `)
    const legacyCodec = compileSchema(schema)
    const limitedCodec = compileSchema(schema, { limits: { maxDecodeDepth: 2 } })
    const encoded = new Uint8Array([1, 1, 0, 0, 0])

    expect(decode(legacyCodec, 'decodeLink', encoded)).toEqual({ next: { next: {} } })
    expect(() => decode(limitedCodec, 'decodeLink', encoded)).toThrow(
      'Kiwi decode nesting limit exceeded (2)'
    )
    expect(decode(limitedCodec, 'decodeLink', new Uint8Array([0]))).toEqual({})
  })

  test('keeps binary schema budgets optional for legacy input', () => {
    const definitions: Schema = {
      package: null,
      definitions: Array.from(
        { length: KIWI_RUNTIME_LIMITS.maxSchemaDefinitions + 1 },
        (_, index) => ({
          name: `Enum${index}`,
          line: 0,
          column: 0,
          kind: 'ENUM',
          fields: []
        })
      )
    }
    const binary = encodeBinarySchema(definitions)

    expect(decodeBinarySchema(binary).definitions).toHaveLength(
      KIWI_RUNTIME_LIMITS.maxSchemaDefinitions + 1
    )
    expect(() => decodeBinarySchema(binary, KIWI_RUNTIME_LIMITS)).toThrow(
      `Kiwi schema definition limit exceeded (${KIWI_RUNTIME_LIMITS.maxSchemaDefinitions})`
    )

    expect(() => compileSchema(definitions)).not.toThrow()
    expect(() => compileSchema(definitions, { limits: KIWI_RUNTIME_LIMITS })).toThrow(
      `Kiwi schema definition limit exceeded (${KIWI_RUNTIME_LIMITS.maxSchemaDefinitions})`
    )
  })

  test('applies per-definition and total schema budgets before compiling the codec', () => {
    const field: Field = {
      name: 'value',
      line: 0,
      column: 0,
      type: null,
      isArray: false,
      isDeprecated: false,
      value: 1
    }
    const schema: Schema = {
      package: null,
      definitions: [0, 1].map((definitionIndex) => ({
        name: `Enum${definitionIndex}`,
        line: 0,
        column: 0,
        kind: 'ENUM',
        fields: Array.from({ length: 2 }, (_, index) => ({
          ...field,
          name: `value${index}`,
          value: index
        }))
      }))
    }

    expect(() => compileSchema(schema)).not.toThrow()
    expect(() => compileSchema(schema, { limits: { maxFieldsPerDefinition: 1 } })).toThrow(
      'Kiwi schema field limit exceeded for "Enum0" (1)'
    )
    expect(() => compileSchema(schema, { limits: { maxSchemaFields: 3 } })).toThrow(
      'Kiwi schema total field limit exceeded (3)'
    )
  })

  test('strict dynamic schema validation rejects duplicate and prototype-hazard names', () => {
    const field = schemaField('value', 1)
    const duplicateDefinitions: Schema = {
      package: null,
      definitions: [schemaMessage('Duplicate', [field]), schemaMessage('Duplicate', [field])]
    }
    expect(() => compileSchema(duplicateDefinitions, { validateDynamicSchema: true })).toThrow(
      'The type "Duplicate" is defined twice'
    )

    const duplicateFields: Schema = {
      package: null,
      definitions: [schemaMessage('Message', [field, { ...field, value: 2 }])]
    }
    expect(() => compileSchema(duplicateFields, { validateDynamicSchema: true })).toThrow(
      'The field "value" is defined twice in "Message"'
    )

    for (const dangerousName of ['__proto__', 'constructor', 'prototype']) {
      const dangerous: Schema = {
        package: null,
        definitions: [schemaMessage('Message', [schemaField(dangerousName, 1)])]
      }
      expect(() => compileSchema(dangerous)).not.toThrow()
      expect(() => compileSchema(dangerous, { validateDynamicSchema: true })).toThrow(
        `The field name ${JSON.stringify(dangerousName)} is unsafe`
      )
    }

    const reserved: Schema = {
      package: null,
      definitions: [schemaMessage('ByteBuffer', [field])]
    }
    expect(() => compileSchema(reserved, { validateDynamicSchema: true })).toThrow(
      'The type name "ByteBuffer" is reserved'
    )
  })

  test('strict dynamic schema validation rejects zero and duplicate message field ids', () => {
    const zeroId: Schema = {
      package: null,
      definitions: [schemaMessage('Message', [schemaField('zero', 0)])]
    }
    expect(() => compileSchema(zeroId, { validateDynamicSchema: true })).toThrow(
      'The id for field "zero" must be positive'
    )

    const duplicateId: Schema = {
      package: null,
      definitions: [schemaMessage('Message', [schemaField('first', 1), schemaField('second', 1)])]
    }
    expect(() => compileSchema(duplicateId, { validateDynamicSchema: true })).toThrow(
      'The id for field "second" is used twice'
    )
  })

  test('compiles and round-trips without calling the Function constructor', () => {
    const OriginalFunction = globalThis.Function
    globalThis.Function = new Proxy(OriginalFunction, {
      construct() {
        throw new EvalError(
          "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script"
        )
      }
    })

    try {
      const codec = compileSchema(parseSchema(schemaText))
      const encodeItem = codec.encodeItem as (value: RuntimeMessage) => Uint8Array
      const decodeItem = codec.decodeItem as (value: Uint8Array) => RuntimeMessage
      const encoded = encodeItem({ id: 7, name: 'CSP-safe', kind: 'BADGE', tags: [] })
      expect(decodeItem(encoded)).toEqual({
        id: 7,
        name: 'CSP-safe',
        kind: 'BADGE',
        tags: []
      })
    } finally {
      globalThis.Function = OriginalFunction
    }
  })

  test('uses the codec ByteBuffer override', () => {
    class CustomByteBuffer extends ByteBuffer {}

    const codec = compileSchema(parseSchema(schemaText))
    codec.ByteBuffer = CustomByteBuffer

    const encoded = (codec.encodeItem as (value: RuntimeMessage) => Uint8Array)({
      id: 1,
      name: 'custom',
      kind: 'CARD',
      tags: []
    })
    const decoded = (codec.decodeItem as (value: Uint8Array) => RuntimeMessage)(encoded)

    expect(decoded.name).toBe('custom')
  })

  test('reports unknown field types at their source location', () => {
    const malformedSchema = {
      package: null,
      definitions: [
        {
          name: 'Item',
          line: 4,
          column: 1,
          kind: 'MESSAGE' as const,
          fields: [
            {
              name: 'value',
              line: 5,
              column: 3,
              type: 'MissingType',
              isArray: false,
              isDeprecated: false,
              value: 1
            }
          ]
        }
      ]
    }

    expect(() => compileSchema(malformedSchema)).toThrow(
      'Invalid type "MissingType" for field "value"'
    )
    try {
      compileSchema(malformedSchema)
    } catch (error) {
      expect(error).toMatchObject({ line: 5, column: 3 })
    }
  })

  test('rejects inherited names as field types', () => {
    const malformedSchema = {
      package: null,
      definitions: [
        {
          name: 'Item',
          line: 4,
          column: 1,
          kind: 'MESSAGE' as const,
          fields: [
            {
              name: 'value',
              line: 5,
              column: 3,
              type: 'constructor',
              isArray: false,
              isDeprecated: false,
              value: 1
            }
          ]
        }
      ]
    }

    expect(() => compileSchema(malformedSchema)).toThrow(
      'Invalid type "constructor" for field "value"'
    )
    try {
      compileSchema(malformedSchema)
    } catch (error) {
      expect(error).toMatchObject({ line: 5, column: 3 })
    }
  })
})

function schemaField(name: string, value: number): Field {
  return {
    name,
    line: 0,
    column: 0,
    type: 'uint',
    isArray: false,
    isDeprecated: false,
    value
  }
}

function schemaMessage(name: string, fields: Field[]): Schema['definitions'][number] {
  return { name, line: 0, column: 0, kind: 'MESSAGE', fields }
}
