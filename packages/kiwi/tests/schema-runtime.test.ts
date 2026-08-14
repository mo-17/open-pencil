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
    interface ItemCodec {
      encodeItem(value: unknown): Uint8Array
      decodeItem(value: Uint8Array): unknown
    }

    const codec = compileSchema(schema) as ItemCodec

    const encoded = codec.encodeItem({ id: 42, name: 'OpenPencil', kind: 'CARD', tags: ['kiwi'] })
    expect(encoded.length).toBeGreaterThan(0)
    expect(codec.decodeItem(encoded)).toEqual({
      id: 42,
      name: 'OpenPencil',
      kind: 'CARD',
      tags: ['kiwi']
    })
  })

  test('applies array budgets only to codecs compiled with limits', () => {
    interface BatchCodec {
      decodeBatch(value: Uint8Array): unknown
    }
    const schema = parseSchema(`
        message Batch {
          uint[] values = 1;
        }
      `)
    const legacyCodec = compileSchema(schema) as BatchCodec
    const limitedCodec = compileSchema(schema, { limits: { maxArrayItems: 1 } }) as BatchCodec
    const encoded = new ByteBuffer()
    encoded.writeVarUint(1)
    encoded.writeVarUint(2)
    encoded.writeVarUint(7)
    encoded.writeVarUint(8)
    encoded.writeVarUint(0)

    expect(legacyCodec.decodeBatch(encoded.toUint8Array())).toEqual({ values: [7, 8] })
    expect(() => limitedCodec.decodeBatch(encoded.toUint8Array())).toThrow(
      'Kiwi array item limit exceeded (1 per message)'
    )
  })

  test('applies decode depth only to codecs compiled with limits and unwinds after failure', () => {
    interface LinkCodec {
      decodeLink(value: Uint8Array): unknown
    }
    const schema = parseSchema(`
        message Link {
          Link next = 1;
        }
      `)
    const legacyCodec = compileSchema(schema) as LinkCodec
    const limitedCodec = compileSchema(schema, { limits: { maxDecodeDepth: 2 } }) as LinkCodec
    const encoded = new Uint8Array([1, 1, 0, 0, 0])

    expect(legacyCodec.decodeLink(encoded)).toEqual({ next: { next: {} } })
    expect(() => limitedCodec.decodeLink(encoded)).toThrow('Kiwi decode nesting limit exceeded (2)')
    expect(limitedCodec.decodeLink(new Uint8Array([0]))).toEqual({})
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

  test('applies per-definition and total schema budgets before generating decoder source', () => {
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
