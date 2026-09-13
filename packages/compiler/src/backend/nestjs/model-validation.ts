import type {
  BackendApplicationSpecV1,
  BackendDiagnostic,
  DataEntityIR,
  DataFieldIR,
  DataModelIR
} from '@open-pencil/lowcode/backend'

import { nestJSDiagnostic } from './model'
import { nestJSConstraintDiagnostics, nestJSNameDiagnostics } from './model-constraints'
import { nestJSEnum, nestJSValidTemporalLiteral } from './schema-fields'

const IDENTIFIER = /^[a-z][a-z0-9_]{0,47}$/u
const FIELD_TYPES = new Set([
  'string',
  'uuid',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum'
])
const RESERVED_FIELDS = new Set(['constructor', 'prototype'])

function validStringLiteral(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 16384 &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code === 0 || (code >= 0xd800 && code <= 0xdfff)
    })
  )
}

function validFieldDefault(
  field: DataFieldIR,
  primaryKey: string | undefined,
  model: DataModelIR
): boolean {
  const value = field.default
  if (!value) return true
  if (value.kind === 'generated') {
    return (
      (field.id === primaryKey && field.type === 'uuid' && value.generator === 'uuid') ||
      (field.type === 'datetime' && value.generator === 'created-at')
    )
  }
  const literal = value.value
  if (literal === null) return field.nullable
  if (field.type === 'string') return validStringLiteral(literal)
  if (field.type === 'date' || field.type === 'datetime')
    return nestJSValidTemporalLiteral(field, literal)
  if (field.type === 'enum')
    return typeof literal === 'string' && nestJSEnum(field, model).values.includes(literal)
  if (field.type === 'boolean') return typeof literal === 'boolean'
  if (field.type === 'number') return typeof literal === 'number' && Number.isFinite(literal)
  if (field.type === 'integer') {
    return (
      typeof literal === 'number' &&
      Number.isInteger(literal) &&
      literal >= -2147483648 &&
      literal <= 2147483647
    )
  }
  return false
}

function fieldDiagnostics(
  field: DataFieldIR,
  primaryKey: string | undefined,
  path: string,
  model: DataModelIR
): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  if (!IDENTIFIER.test(field.id) || !IDENTIFIER.test(field.name) || RESERVED_FIELDS.has(field.id)) {
    diagnostics.push(
      nestJSDiagnostic(
        path,
        'NestJS v1 field IDs and column names must be bounded lowercase ASCII identifiers without reserved object keys.'
      )
    )
  }
  if (
    !FIELD_TYPES.has(field.type) ||
    (field.type !== 'enum' && field.enumId !== undefined) ||
    !validFieldDefault(field, primaryKey, model)
  ) {
    diagnostics.push(
      nestJSDiagnostic(
        path,
        'NestJS supports string, UUID, int32, finite number, boolean, enum, date and microsecond-precision RFC3339 datetime fields with compatible literal defaults, generated UUID keys or created-at timestamps. updated-at is not yet supported.'
      )
    )
  }
  return diagnostics
}

function entityDiagnostics(
  entity: DataEntityIR,
  index: number,
  model: DataModelIR
): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  const path = '$.application.dataModel.entities[' + index + ']'
  const reject = (message: string) => diagnostics.push(nestJSDiagnostic(path, message))
  if (entity.management !== 'managed' || !IDENTIFIER.test(entity.name)) {
    reject(
      'NestJS v1 requires managed tables with lowercase ASCII SQL names of at most 48 characters.'
    )
  }
  const key = primaryKeyField(entity)
  if (
    key?.type !== 'uuid' ||
    key.nullable ||
    key.default?.kind !== 'generated' ||
    key.default.generator !== 'uuid'
  ) {
    reject('NestJS v1 requires one non-null UUID primary key with a generated UUID default.')
  }
  diagnostics.push(
    ...entity.fields.flatMap((field) => fieldDiagnostics(field, key?.id, path, model))
  )
  return diagnostics
}

function primaryKeyField(entity: DataEntityIR): DataFieldIR | undefined {
  const fields = entity.primaryKey?.fields
  if (fields?.length !== 1) return undefined
  return entity.fields.find((field) => field.id === fields[0])
}

function enumDiagnostics(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  for (const dataEnum of application.dataModel.enums) {
    if (
      !IDENTIFIER.test(dataEnum.name) ||
      dataEnum.values.some((value) => new TextEncoder().encode(value).byteLength > 63)
    ) {
      diagnostics.push(
        nestJSDiagnostic(
          '$.application.dataModel.enums',
          'NestJS enum type names require bounded lowercase ASCII SQL identifiers and labels may not exceed 63 UTF-8 bytes.'
        )
      )
    }
  }
  return diagnostics
}

export function validateNestJSModel(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  const diagnostics = [
    ...application.dataModel.entities.flatMap((entity, index) =>
      entityDiagnostics(entity, index, application.dataModel)
    ),
    ...nestJSNameDiagnostics(application),
    ...nestJSConstraintDiagnostics(application),
    ...enumDiagnostics(application)
  ]
  if (application.dataModel.entities.length === 0 || application.dataModel.entities.length > 32) {
    diagnostics.push(
      nestJSDiagnostic(
        '$.application.dataModel.entities',
        'NestJS v1 requires between 1 and 32 entities.'
      )
    )
  }
  const resources = application.httpApi?.resources ?? []
  if (
    resources.some(
      (resource) =>
        !/^[a-z][a-z0-9_-]{0,47}$/u.test(resource.id) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(resource.id)
    )
  ) {
    diagnostics.push(
      nestJSDiagnostic(
        '$.application.httpApi.resources',
        'NestJS resource IDs must be lowercase ASCII slugs of at most 48 characters for portable source filenames.'
      )
    )
  }
  for (const entity of application.dataModel.entities) {
    if (!resources.some((entry) => entry.entityId === entity.id)) {
      diagnostics.push(
        nestJSDiagnostic(
          '$.application.dataModel.entities',
          'Every NestJS v1 entity must have an explicit HTTP resource.'
        )
      )
    }
    const owners = application.auth.ownership.filter((entry) => entry.entityId === entity.id)
    const owner =
      owners.length === 1
        ? entity.fields.find((entry) => entry.id === owners[0].identityFieldId)
        : undefined
    if (
      owner?.type !== 'uuid' ||
      owner.nullable ||
      owner.default ||
      entity.primaryKey?.fields.includes(owner.id)
    ) {
      diagnostics.push(
        nestJSDiagnostic(
          '$.application.auth.ownership',
          'Each NestJS entity requires exactly one non-null UUID owner column, without a default and separate from its primary key.'
        )
      )
    }
    for (const resource of resources.filter((entry) => entry.entityId === entity.id)) {
      if (!resource.operations.includes('create')) continue
      const missing = entity.fields.some(
        (field) =>
          !field.nullable &&
          !field.default &&
          field.id !== owner?.id &&
          !resource.createFields?.includes(field.id)
      )
      if (missing)
        diagnostics.push(
          nestJSDiagnostic(
            '$.application.httpApi.resources',
            'Create projections must supply every non-null field without a server-owned value or default.'
          )
        )
    }
  }
  return diagnostics
}
