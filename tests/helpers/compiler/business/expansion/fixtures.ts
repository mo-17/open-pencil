import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import type {
  BusinessActionDefinition,
  BusinessInput,
  BusinessPageDefinition,
  BusinessParameterSource
} from '@/app/lowcode/backend/business/types'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'

import { expansionDate, expansionId } from './metadata'

function record(
  application: BackendApplicationSpecV1,
  resourceId: string,
  index: number
): BusinessTestRow {
  const resource = application.httpApi?.resources.find((value) => value.id === resourceId)
  const entity = application.dataModel.entities.find((value) => value.id === resource?.entityId)
  if (!resource || !entity) throw new Error('Missing fixture resource ' + resourceId)
  return Object.fromEntries(
    resource.readFields.map((name, fieldIndex) => {
      const field = entity.fields.find((value) => value.id === name)
      if (!field) throw new Error('Missing fixture field ' + name)
      let value: BusinessTestRow[string] = 'Record ' + name
      if (field.type === 'uuid') value = expansionId(name === 'id' ? index : 800 + fieldIndex)
      else if (field.type === 'datetime') value = expansionDate
      else if (field.type === 'integer' || field.type === 'decimal') value = 7
      else if (field.type === 'boolean') value = true
      else if (field.type === 'enum')
        value =
          application.dataModel.enums.find((entry) => entry.id === field.enumId)?.values[0] ?? ''
      return [name, value]
    })
  )
}

function inputValue(
  input: BusinessInput,
  command: NonNullable<BackendApplicationSpecV1['commands']>['commands'][number]
): BusinessTestRow[string] {
  const parameter = command.parameters.find((value) => value.name === input.key)
  if (input.kind === 'select') return input.choices?.at(-1)?.value ?? ''
  if (input.kind === 'number') return Math.min(input.max ?? 9999, Math.max(input.min ?? 0, 12))
  if (parameter?.type === 'datetime')
    return input.key.toLowerCase().includes('end') ? '2030-01-02T10:00:00.000Z' : expansionDate
  return ('Browser input ' + input.key).slice(0, input.maxLength ?? 100)
}

function sourceValue(
  source: BusinessParameterSource,
  row: BusinessTestRow,
  values: BusinessTestRow
) {
  if (source.kind === 'literal') return source.value
  return source.kind === 'selection' ? row[source.field] : values[source.key]
}

function matchActionCondition(action: BusinessActionDefinition, selected: BusinessTestRow): void {
  if (!action.when) return
  for (const condition of 'all' in action.when ? action.when.all : [action.when])
    selected[condition.field] = condition.values[0]
}

/** Script records are transport fixtures, not an authorization or database simulator. */
export function expansionActionFixture(
  application: BackendApplicationSpecV1,
  page: BusinessPageDefinition,
  action: BusinessActionDefinition
) {
  const command = application.commands?.commands.find((value) => value.id === action.commandId)
  if (!command) throw new Error('Missing command ' + action.commandId)
  const resources = Object.fromEntries(
    (application.httpApi?.resources ?? []).map((resource, index) => [
      resource.id,
      [record(application, resource.id, 100 + index)]
    ])
  )
  const selected = page.listing ? resources[page.listing.resourceId][0] : { id: expansionId(100) }
  const values: BusinessTestRow = {}
  for (const input of action.inputs) {
    if (input.kind === 'relation') continue
    values[input.key] = inputValue(input, command)
    if (input.fromSelection) selected[input.fromSelection] = values[input.key]
  }
  matchActionCondition(action, selected)
  for (const [index, input] of action.inputs.entries()) {
    if (input.kind !== 'relation' || !input.relation) continue
    const relation = input.relation
    const row = resources[relation.resourceId][0]
    const valueField = relation.valueField ?? 'id'
    // Use a distinct reference from the selected row's ID to catch source-field mixups.
    row[valueField] = expansionId(400 + index)
    values[input.key] = row[valueField]
    if (input.fromSelection) selected[input.fromSelection] = row[valueField]
    for (const [field, source] of Object.entries(relation.filters ?? {}))
      row[field] = sourceValue(source, selected, values)
  }
  const payload = Object.fromEntries(
    Object.entries(action.parameters).map(([name, source]) => [
      name,
      sourceValue(source, selected, values)
    ])
  )
  // The shared transport canonicalizes authored milliseconds to PostgreSQL microseconds.
  for (const parameter of command.parameters)
    if (parameter.type === 'datetime')
      payload[parameter.name] = String(payload[parameter.name]).replace('.000Z', '.000000Z')
  return { resources, selected, values, payload, command }
}
