import type { BackendCommerceIRV1 } from '../commerce/types'
import type {
  AuthPolicyIR,
  BackendHttpAPIIRV1,
  DataEntityIR,
  DataFieldIR,
  DataModelIR
} from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import { commandInheritedOwner, validateCommandRowPolicy } from './row-policy'
import { commandError } from './shape-values'
import { validateCommandTenantAccess, validateCommandTenantStep } from './tenant'
import type { BackendCommandDefinitionIR, BackendCommandStepIR } from './types'
import {
  validateCommandAssignment,
  validateCommandComparison,
  type CommandResult,
  type CommandValueContext
} from './value-types'

export interface CommandReferences {
  model: DataModelIR
  auth: AuthPolicyIR
  api?: BackendHttpAPIIRV1
  commerce?: BackendCommerceIRV1
}

function entityInfo(
  entityId: string,
  path: string,
  references: CommandReferences,
  context: BackendValidationContext
) {
  const entity = references.model.entities.find((entry) => entry.id === entityId)
  const key = entity?.primaryKey?.fields
  const primary =
    key?.length === 1 ? entity?.fields.find((entry) => entry.id === key[0]) : undefined
  const owners = references.auth.ownership.filter((entry) => entry.entityId === entityId)
  const owner =
    owners.length === 1
      ? entity?.fields.find((entry) => entry.id === owners[0].identityFieldId)
      : undefined
  if (
    entity?.management !== 'managed' ||
    primary?.type !== 'uuid' ||
    primary.nullable ||
    owner?.type !== 'uuid' ||
    owner.nullable ||
    owner.id === primary.id ||
    owner.default
  ) {
    commandError(
      context,
      path,
      'Command entities require managed tables, one non-null UUID primary key, and exactly one separate non-null UUID owner without a default.'
    )
    return undefined
  }
  return { entity, primary, owner }
}

function projection(
  entity: DataEntityIR,
  fields: readonly string[],
  path: string,
  context: BackendValidationContext
): void {
  for (const id of fields) {
    const field = entity.fields.find((entry) => entry.id === id)
    if (!field || ['json', 'bytes'].includes(field.type))
      commandError(
        context,
        path,
        'Command projections require declared scalar fields of the referenced entity.'
      )
  }
}

function mutation(
  step: Extract<BackendCommandStepIR, { kind: 'data.mutate' }>,
  info: { entity: DataEntityIR; primary: DataFieldIR; owner: DataFieldIR },
  path: string,
  ctx: CommandValueContext,
  references: CommandReferences
): void {
  if (step.operation === 'update') {
    const previous = ctx.results.get(step.record)
    if (
      !previous ||
      !previous.locked ||
      previous.entity.id !== info.entity.id ||
      !previous.fields.includes(info.primary.id)
    )
      commandError(
        ctx.context,
        path + '.record',
        'Updates require a prior locked read or update of the same entity projecting its primary key.'
      )
  }
  for (const [index, entry] of step.values.entries()) {
    const valuePath = path + '.values[' + index + ']'
    const target = info.entity.fields.find((field) => field.id === entry.field)
    if (!target || ['json', 'bytes'].includes(target.type)) {
      commandError(ctx.context, valuePath, 'Command assignments require a declared scalar field.')
      continue
    }
    if (
      target.default?.kind === 'generated' ||
      (step.operation === 'update' && [info.primary.id, info.owner.id].includes(target.id))
    )
      commandError(
        ctx.context,
        valuePath,
        'Command writes cannot replace generated fields, or update primary keys and owners.'
      )
    if (
      step.operation === 'insert' &&
      target.id === info.owner.id &&
      entry.value.kind !== 'caller-sub' &&
      !commandInheritedOwner(step, info.owner.id, references, ctx)
    )
      commandError(
        ctx.context,
        valuePath,
        'Inserted owners require the verified caller or an authorized locked parent bound by the complete private foreign key.'
      )
    validateCommandAssignment(entry.value, target, valuePath + '.value', ctx)
  }
  if (step.operation === 'insert') {
    const supplied = new Set(step.values.map((entry) => entry.field))
    if (
      info.entity.fields.some(
        (field) => !field.nullable && !field.default && !supplied.has(field.id)
      )
    )
      commandError(
        ctx.context,
        path + '.values',
        'Command inserts must supply every non-null field without a default, including the caller owner.'
      )
  }
}

export function validateCommandReferences(
  command: BackendCommandDefinitionIR,
  references: CommandReferences,
  context: BackendValidationContext
): void {
  const path = '$.commands.commands.' + command.id
  if (
    command.access.kind !== 'authenticated' &&
    command.access.roleId !== undefined &&
    !references.auth.roles.some(
      (role) => command.access.kind !== 'authenticated' && role.id === command.access.roleId
    )
  )
    commandError(context, path + '.access', 'Command role grants must reference a declared role.')
  validateCommandTenantAccess(command, references, path + '.access', context)
  validateCommandRowPolicy(command, references, path + '.access', context)
  const results = new Map<string, CommandResult>()
  const ctx = { command, model: references.model, results, context }
  for (const [index, step] of command.steps.entries()) {
    const stepPath = path + '.steps[' + index + ']'
    if (step.kind === 'assert') {
      validateCommandComparison(step.left, step.operator, step.right, stepPath, ctx)
      continue
    }
    const info = entityInfo(step.entityId, stepPath + '.entityId', references, context)
    if (!info) continue
    validateCommandTenantStep(step, references, stepPath, ctx)
    projection(info.entity, step.fields, stepPath + '.fields', context)
    if (step.kind === 'data.read') {
      if (!step.fields.includes(info.primary.id))
        commandError(context, stepPath + '.fields', 'Locked reads must project the primary key.')
      validateCommandAssignment(step.key, info.primary, stepPath + '.key', ctx)
    } else mutation(step, info, stepPath, ctx, references)
    results.set(step.resultName, {
      entity: info.entity,
      fields: step.fields,
      locked: step.kind === 'data.read' || step.operation === 'update'
    })
  }
  const returns = results.get(command.return.resultName)
  if (!returns || command.return.fields.some((field) => !returns.fields.includes(field)))
    commandError(
      context,
      path + '.return',
      'Command responses must select projected fields of a prior result.'
    )
}
