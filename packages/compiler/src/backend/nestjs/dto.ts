import type { DataFieldIR, DataModelIR } from '@open-pencil/lowcode/backend'

import { nestJSArtifact } from './artifact'
import type { NestJSResource } from './model'
import {
  NESTJS_DATE_PATTERN,
  NESTJS_DATETIME_PATTERN,
  NESTJS_UTC_DATETIME_MIN,
  NESTJS_UTC_DATETIME_MAX_EXCLUSIVE,
  nestJSEnum
} from './schema-fields'

/** Fixed host-owned validator; only the numeric UTC bounds are substituted. */
export const NESTJS_UTC_RANGE_VALIDATOR_SOURCE = `function IsUTCDateTimeRange(): PropertyDecorator {
  return ValidateBy({ name: 'isUTCDateTimeRange', validator: {
    validate(value: unknown): boolean {
      const instant = typeof value === 'string' ? Date.parse(value) : NaN
      return instant >= ${NESTJS_UTC_DATETIME_MIN} && instant < ${NESTJS_UTC_DATETIME_MAX_EXCLUSIVE}
    },
    defaultMessage: () => 'Timestamp must remain in UTC years 0001 through 9999.'
  } })
}
`

export function nestJSFieldType(field: DataFieldIR, model: DataModelIR): string {
  if (field.type === 'integer' || field.type === 'number') return 'number'
  if (field.type === 'boolean') return 'boolean'
  if (field.type === 'enum')
    return nestJSEnum(field, model)
      .values.map((value) => JSON.stringify(value))
      .join(' | ')
  return 'string'
}

function validators(field: DataFieldIR, model: DataModelIR): string[] {
  switch (field.type) {
    case 'uuid':
      return ['IsUUID()']
    case 'integer':
      return ['IsInt()', 'Min(-2147483648)', 'Max(2147483647)']
    case 'number':
      return ['IsNumber({ allowNaN: false, allowInfinity: false })']
    case 'boolean':
      return ['IsBoolean()']
    case 'enum':
      return ['IsIn(' + JSON.stringify(nestJSEnum(field, model).values) + ')']
    case 'date':
    case 'datetime':
      return [
        'IsDateString({ strict: true, strictSeparator: true })',
        'Matches(new RegExp(' +
          JSON.stringify(field.type === 'date' ? NESTJS_DATE_PATTERN : NESTJS_DATETIME_PATTERN) +
          '))',
        ...(field.type === 'datetime' ? ['IsUTCDateTimeRange()'] : [])
      ]
    default:
      return ['IsString()', 'MaxLength(16384)']
  }
}

function dtoClass(model: NestJSResource, index: number, operation: 'create' | 'update'): string {
  const ids = operation === 'create' ? model.resource.createFields : model.resource.updateFields
  const name = 'Resource' + index + (operation === 'create' ? 'CreateDTO' : 'UpdateDTO')
  const properties = (ids ?? [])
    .map((id) => {
      const field = model.entity.fields.find((entry) => entry.id === id)
      if (!field) throw new Error('Missing validated DTO field.')
      const optional = operation === 'update' || field.nullable || field.default !== undefined
      const decorators = validators(field, model.dataModel)
      if (optional)
        decorators.unshift(
          field.nullable
            ? 'ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null)'
            : 'ValidateIf((_object: object, value: unknown) => value !== undefined)'
        )
      else decorators.unshift('IsDefined()')
      return (
        decorators.map((entry) => '  @' + entry).join('\n') +
        '\n  ' +
        JSON.stringify(id) +
        (optional ? '?' : '!') +
        ': ' +
        nestJSFieldType(field, model.dataModel) +
        (field.nullable ? ' | null' : '') +
        '\n'
      )
    })
    .join('\n')
  return 'export class ' + name + ' {\n' + properties + '}\n'
}

export function emitNestJSDTO(model: NestJSResource, index: number) {
  const classes: string[] = []
  if (model.resource.operations.includes('create')) classes.push(dtoClass(model, index, 'create'))
  if (model.resource.operations.includes('update')) classes.push(dtoClass(model, index, 'update'))
  if (classes.length === 0) return []
  const hasDatetime = [
    ...(model.resource.createFields ?? []),
    ...(model.resource.updateFields ?? [])
  ].some((id) => model.entity.fields.some((field) => field.id === id && field.type === 'datetime'))
  const source =
    "import { IsDefined, ValidateIf, IsString, MaxLength, IsUUID, IsInt, Min, Max, IsNumber, IsBoolean, IsIn, IsDateString, Matches, ValidateBy } from 'class-validator'\n\n" +
    (hasDatetime ? NESTJS_UTC_RANGE_VALIDATOR_SOURCE + '\n' : '') +
    classes.join('\n')
  return [nestJSArtifact('src/resources/' + model.resource.id + '.dto.ts', source)]
}
