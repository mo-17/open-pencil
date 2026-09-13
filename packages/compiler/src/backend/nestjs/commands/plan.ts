import { digestCanonicalBackendValue } from '#compiler/backend/canonical'

import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from '../artifact'
import { nestJSReadColumn } from '../schema-fields'
import { nestJSCommandAssertion } from './plan-values'

function fieldColumn(entity: DataEntityIR, id: string): string {
  const field = entity.fields.find((candidate) => candidate.id === id)
  if (!field) throw new Error('Missing validated command field.')
  return sqlIdentifier(field.name)
}

function commandStep(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR,
  step: BackendCommandStepIR
) {
  if (step.kind === 'assert') return nestJSCommandAssertion(application, command, step)
  const entity = application.dataModel.entities.find((candidate) => candidate.id === step.entityId)
  const owner = application.auth.ownership.find((candidate) => candidate.entityId === step.entityId)
  const keyField = entity?.primaryKey?.fields[0]
  if (!entity || !owner || !keyField) throw new Error('Missing validated command entity.')
  const table = sqlIdentifier('public') + '.' + sqlIdentifier(entity.name)
  const projection = step.fields
    .map((id) => {
      const field = entity.fields.find((candidate) => candidate.id === id)
      if (!field) throw new Error('Missing validated command projection.')
      return nestJSReadColumn(field) + ' AS ' + sqlIdentifier(id)
    })
    .join(', ')
  const common = { resultName: step.resultName, table, projection }
  if (step.kind === 'data.read') {
    return {
      ...common,
      kind: 'read' as const,
      keyColumn: fieldColumn(entity, keyField),
      ownerColumn: fieldColumn(entity, owner.identityFieldId),
      scope: step.scope,
      key: step.key
    }
  }
  const values = step.values.map((entry) => ({
    column: fieldColumn(entity, entry.field),
    source: entry.value
  }))
  if (step.operation === 'insert') return { ...common, kind: 'insert' as const, values }
  return {
    ...common,
    kind: 'update' as const,
    record: step.record,
    keyColumn: fieldColumn(entity, keyField),
    keyField,
    values
  }
}

/** Only normalized, provider-validated command data reaches this static SQL metadata compiler. */
export function nestJSCommandDefinitionDigest(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
): string {
  return digestCanonicalBackendValue(
    { command, dataModel: application.dataModel, ownership: application.auth.ownership },
    '$.commandDefinition'
  )
}

export function nestJSCommandPlan(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
) {
  return {
    applicationId: application.applicationId,
    id: command.id,
    digest: nestJSCommandDefinitionDigest(application, command),
    access: command.access,
    parameters: command.parameters,
    steps: command.steps.map((step) => commandStep(application, command, step)),
    return: command.return
  }
}
