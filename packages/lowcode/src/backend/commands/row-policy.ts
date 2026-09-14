import {
  id,
  identifier,
  parseArrayItems,
  sorted,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from '../validation-helpers'
import type { CommandReferences } from './references'
import { commandError } from './shape-values'
import type { BackendCommandDefinitionIR, BackendCommandStepIR } from './types'
import type { CommandValueContext } from './value-types'

export function validateCommandRowPolicy(
  command: BackendCommandDefinitionIR,
  references: CommandReferences,
  path: string,
  context: BackendValidationContext
): void {
  const access = command.access
  if (access.kind !== 'row-policy') return
  const entity = references.model.entities.find((entry) => entry.id === access.entityId)
  const key = entity?.primaryKey?.fields
  if (
    entity?.management !== 'managed' ||
    key?.length !== 1 ||
    !entity.fields.some(
      (field) => field.id === key[0] && field.type === 'uuid' && !field.nullable
    ) ||
    !command.parameters.some(
      (parameter) => parameter.name === access.parameter && parameter.type === 'uuid'
    )
  )
    commandError(
      context,
      path,
      'Row-policy authority requires a managed UUID primary-key entity and a required UUID selector parameter.'
    )
  for (const id of access.policyIds) {
    const policy = references.auth.rowAccess.find((entry) => entry.id === id)
    if (
      !policy ||
      policy.entityId !== access.entityId ||
      policy.effect !== 'allow' ||
      !policy.operations.includes('select')
    )
      commandError(
        context,
        path,
        'Row-policy commands must select existing same-entity allow/select policies; command invocation still requires a verified subject.'
      )
  }
}

/** Owner inheritance is a foreign-key-bound snapshot of an already authorized and locked parent. */
export function commandInheritedOwner(
  step: Extract<BackendCommandStepIR, { kind: 'data.mutate' }>,
  ownerFieldId: string,
  references: CommandReferences,
  ctx: CommandValueContext
): boolean {
  const source = step.values.find((entry) => entry.field === ownerFieldId)?.value
  if (source?.kind !== 'result') return false
  const parent = ctx.results.get(source.name)
  if (
    !parent?.locked ||
    !parent.fields.includes(source.field) ||
    !references.auth.ownership.some(
      (owner) => owner.entityId === parent.entity.id && owner.identityFieldId === source.field
    )
  )
    return false
  const read = ctx.command.steps.find(
    (entry) => entry.kind === 'data.read' && entry.resultName === source.name
  )
  if (read?.kind !== 'data.read') return false
  if (!inheritedOwnerAuthorized(read, ctx.command.access, references)) return false
  const entity = references.model.entities.find((entry) => entry.id === step.entityId)
  const key = parent.entity.primaryKey?.fields
  return (
    key?.length === 1 &&
    Boolean(
      entity?.foreignKeys?.some(
        (foreignKey) =>
          foreignKey.targetEntityId === parent.entity.id &&
          foreignKey.fields.length === 2 &&
          foreignKey.fields.some(
            (id, index) => id === ownerFieldId && foreignKey.targetFields[index] === source.field
          ) &&
          foreignKey.fields.every((id, index) => {
            const value = step.values.find((entry) => entry.field === id)?.value
            return (
              value?.kind === 'result' &&
              value.name === source.name &&
              value.field === foreignKey.targetFields[index] &&
              [source.field, key[0]].includes(value.field)
            )
          })
      )
    )
  )
}

export function parseCommandRowPolicyAccess(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): Extract<BackendCommandDefinitionIR['access'], { kind: 'row-policy' }> | undefined {
  const entityId = id(source.entityId, path + '.entityId', context)
  const parameter = identifier(source.parameter, path + '.parameter', context)
  const policyIds = parseArrayItems(source.policyIds, path + '.policyIds', context, 8, id)
  const roleId =
    source.roleId === undefined ? undefined : id(source.roleId, path + '.roleId', context)
  if (policyIds) {
    if (!policyIds.length)
      commandError(context, path + '.policyIds', 'Select at least one existing row policy.')
    uniqueBy(policyIds, path + '.policyIds', context, 'command access policy')
  }
  return entityId && parameter && policyIds && (source.roleId === undefined || roleId)
    ? {
        kind: 'row-policy',
        entityId,
        parameter,
        policyIds: sorted(policyIds, (entry) => entry),
        ...(roleId ? { roleId } : {})
      }
    : undefined
}

function inheritedOwnerAuthorized(
  read: Extract<BackendCommandStepIR, { kind: 'data.read' }>,
  access: BackendCommandDefinitionIR['access'],
  references: CommandReferences
): boolean {
  const privatePolicies =
    access.kind === 'row-policy' &&
    access.policyIds.every((id) => {
      const policy = references.auth.rowAccess.find((entry) => entry.id === id)
      return policy && !['anonymous', 'authenticated'].includes(policy.principal.kind)
    })
  const authorized =
    read.scope === 'owner' ||
    read.scope === 'tenant' ||
    access.kind === 'role' ||
    (access.kind === 'row-policy' &&
      (access.roleId !== undefined ||
        (privatePolicies &&
          access.entityId === read.entityId &&
          read.key.kind === 'parameter' &&
          read.key.name === access.parameter)))
  return authorized
}
