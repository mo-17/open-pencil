import { normalizeKiwiRuntimeLimits, type KiwiRuntimeLimits } from './limits'
import type { Definition, Field, Schema } from './schema'
import { error, quote } from './util'

const DANGEROUS_OBJECT_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const RESERVED_DEFINITION_NAMES = new Set(['ByteBuffer', 'package'])

export function findDefinition(schema: Schema, name: string): Definition | null {
  return schema.definitions.find((definition) => definition.name === name) ?? null
}

export function findField(schema: Schema, definitionName: string, fieldName: string): Field | null {
  return (
    findDefinition(schema, definitionName)?.fields.find((field) => field.name === fieldName) ?? null
  )
}

export function expectFieldNumber(
  schema: Schema,
  definitionName: string,
  fieldName: string,
  expectedValue: number
): void {
  const field = findField(schema, definitionName, fieldName)
  if (!field) {
    throw new Error(`Missing field ${definitionName}.${fieldName}`)
  }
  if (field.value !== expectedValue) {
    throw new Error(
      `Expected ${definitionName}.${fieldName} to use field ${expectedValue}, got ${field.value}`
    )
  }
}

export function expectEnumValue(
  schema: Schema,
  enumName: string,
  memberName: string,
  expectedValue: number
): void {
  const definition = findDefinition(schema, enumName)
  if (!definition) {
    throw new Error(`Missing enum ${enumName}`)
  }
  if (definition.kind !== 'ENUM') {
    throw new Error(`${enumName} is a ${definition.kind}, not an enum`)
  }
  const field = definition.fields.find((candidate) => candidate.name === memberName)
  if (!field) {
    throw new Error(`Missing enum member ${enumName}.${memberName}`)
  }
  if (field.value !== expectedValue) {
    throw new Error(
      `Expected ${enumName}.${memberName} to use value ${expectedValue}, got ${field.value}`
    )
  }
}

export function validateSchema(schema: Schema): void {
  for (const definition of schema.definitions) {
    validateUniqueFieldNames(definition)
    if (definition.kind === 'ENUM') validateUniqueEnumValues(definition)
  }
}

/** Validate a schema received from an untrusted binary source before generating JavaScript. */
export function validateDynamicSchema(schema: Schema, limits?: KiwiRuntimeLimits): void {
  assertSchemaBudgets(schema, limits)

  if (schema.package !== null) assertSafeDynamicName(schema.package, 'package')

  const definitionsByName = new Set<string>()
  for (const definition of schema.definitions) {
    assertSafeDynamicName(definition.name, 'type')
    if (RESERVED_DEFINITION_NAMES.has(definition.name)) {
      error(
        `The type name ${quote(definition.name)} is reserved`,
        definition.line,
        definition.column
      )
    }
    if (definitionsByName.has(definition.name)) {
      error(
        `The type ${quote(definition.name)} is defined twice`,
        definition.line,
        definition.column
      )
    }
    definitionsByName.add(definition.name)

    const messageFieldIds = new Set<number>()
    for (const field of definition.fields) {
      assertSafeDynamicName(field.name, 'field', field.line, field.column)
      if (definition.kind !== 'MESSAGE') continue
      if (field.value <= 0) {
        error(`The id for field ${quote(field.name)} must be positive`, field.line, field.column)
      }
      if (messageFieldIds.has(field.value)) {
        error(`The id for field ${quote(field.name)} is used twice`, field.line, field.column)
      }
      messageFieldIds.add(field.value)
    }
  }

  validateSchema(schema)
}

export function assertSchemaBudgets(schema: Schema, limits?: KiwiRuntimeLimits): void {
  const normalizedLimits = normalizeKiwiRuntimeLimits(limits)
  const maxSchemaDefinitions = normalizedLimits?.maxSchemaDefinitions
  if (maxSchemaDefinitions !== undefined && schema.definitions.length > maxSchemaDefinitions) {
    throw new Error(`Kiwi schema definition limit exceeded (${maxSchemaDefinitions})`)
  }

  let totalFieldCount = 0
  for (const definition of schema.definitions) {
    const maxFieldsPerDefinition = normalizedLimits?.maxFieldsPerDefinition
    if (maxFieldsPerDefinition !== undefined && definition.fields.length > maxFieldsPerDefinition) {
      throw new Error(
        `Kiwi schema field limit exceeded for ${JSON.stringify(definition.name)} (${maxFieldsPerDefinition})`
      )
    }
    totalFieldCount += definition.fields.length
    const maxSchemaFields = normalizedLimits?.maxSchemaFields
    if (maxSchemaFields !== undefined && totalFieldCount > maxSchemaFields) {
      throw new Error(`Kiwi schema total field limit exceeded (${maxSchemaFields})`)
    }
  }
}

function assertSafeDynamicName(
  name: string,
  kind: 'package' | 'type' | 'field',
  line = 0,
  column = 0
): void {
  if (DANGEROUS_OBJECT_NAMES.has(name)) {
    error(`The ${kind} name ${quote(name)} is unsafe`, line, column)
  }
}

function validateUniqueFieldNames(definition: Definition): void {
  const fieldsByName = new Set<string>()
  for (const field of definition.fields) {
    if (fieldsByName.has(field.name)) {
      error(
        `The field ${quote(field.name)} is defined twice in ${quote(definition.name)}`,
        field.line,
        field.column
      )
    }
    fieldsByName.add(field.name)
  }
}

function validateUniqueEnumValues(definition: Definition): void {
  const fieldsByValue = new Set<number>()
  for (const field of definition.fields) {
    if (fieldsByValue.has(field.value)) {
      error(
        `The enum value ${field.value} is used twice in ${quote(definition.name)}`,
        field.line,
        field.column
      )
    }
    fieldsByValue.add(field.value)
  }
}
