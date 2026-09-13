import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR,
  BackendCommandValueSourceIR,
  BackendDiagnostic,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import { nestJSDiagnostic } from '../model'
import { nestJSValidTemporalLiteral } from '../schema-fields'
import { nestJSRelationNames } from '../schema-names'
import { NESTJS_COMMAND_LEDGER_TABLE } from './ledger'
import { nestJSCommandResultField } from './plan-values'

function temporalLiteralDiagnostics(
  source: BackendCommandValueSourceIR,
  field: DataFieldIR | undefined,
  path: string
): BackendDiagnostic[] {
  if (
    source.kind !== 'literal' ||
    source.value === null ||
    !field ||
    !['date', 'datetime'].includes(field.type) ||
    nestJSValidTemporalLiteral(field, source.value)
  )
    return []
  return [
    nestJSDiagnostic(
      path,
      'NestJS command temporal literals require a valid calendar date or RFC3339 timestamp with at most six fractional digits and both authored and normalized UTC years within 0001 through 9999.'
    )
  ]
}

function commandTemporalDiagnostics(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
): BackendDiagnostic[] {
  return command.steps.flatMap((step, index) => {
    const path = '$.application.commands.commands.' + command.id + '.steps[' + index + ']'
    if (step.kind === 'assert')
      return [
        ...temporalLiteralDiagnostics(
          step.left,
          nestJSCommandResultField(application, command, step.right),
          path + '.left'
        ),
        ...temporalLiteralDiagnostics(
          step.right,
          nestJSCommandResultField(application, command, step.left),
          path + '.right'
        )
      ]
    if (step.kind !== 'data.mutate') return []
    const entity = application.dataModel.entities.find((entry) => entry.id === step.entityId)
    return step.values.flatMap((assignment, valueIndex) =>
      temporalLiteralDiagnostics(
        assignment.value,
        entity?.fields.find((field) => field.id === assignment.field),
        path + '.values[' + valueIndex + '].value'
      )
    )
  })
}

/** Additional PostgreSQL/emitter limits; never substitutes for shared strict command validation. */
export function validateNestJSCommands(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  const commands = application.commands?.commands
  if (!commands?.length) return []
  const diagnostics: BackendDiagnostic[] = []
  const reserved = new Set([NESTJS_COMMAND_LEDGER_TABLE, NESTJS_COMMAND_LEDGER_TABLE + '_pkey'])
  const names = [
    ...application.dataModel.entities.flatMap(nestJSRelationNames),
    ...application.dataModel.enums.map((entry) => entry.name)
  ]
  if (names.some((name) => reserved.has(name)))
    diagnostics.push(
      nestJSDiagnostic(
        '$.application.dataModel',
        'The generated command ledger SQL names are reserved.'
      )
    )
  if (commands.some((command) => /^\/_openpencil(?:\/|$)/iu.test(command.path)))
    diagnostics.push(
      nestJSDiagnostic(
        '$.application.commands',
        'Command paths cannot use the reserved /_openpencil preview namespace.'
      )
    )
  diagnostics.push(
    ...commands.flatMap((command) => commandTemporalDiagnostics(application, command))
  )
  return diagnostics
}
