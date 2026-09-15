import type { BackendCommandDefinitionIR } from '../commands/types'
import type {
  AuthPolicyIR,
  BackendApplicationSpecV1,
  BackendHttpAPIIRV1,
  BackendWorkflowStepIR
} from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import { foodOrderingError } from './shape'
import { FOOD_ORDERING_OPERATIONS, type BackendFoodOrderingIRV1 } from './types'

export function validateFoodOrderingAuth(
  profile: BackendFoodOrderingIRV1,
  auth: AuthPolicyIR,
  api: BackendHttpAPIIRV1 | undefined,
  context: BackendValidationContext
): void {
  const entities = new Set(Object.values(profile.entities))
  for (const policy of auth.rowAccess) {
    if (!entities.has(policy.entityId) || policy.effect !== 'allow') continue
    const menu = policy.entityId === profile.entities.menuItems
    const cart = [profile.entities.carts, profile.entities.cartItems].includes(policy.entityId)
    const manager =
      policy.principal.kind === 'role' && policy.principal.roleId === profile.managerRoleId
    const owner = policy.principal.kind === 'owner'
    const publicMenu =
      menu &&
      ['anonymous', 'authenticated'].includes(policy.principal.kind) &&
      policy.conditions?.some((entry) => entry.fieldId === 'available' && entry.value === true)
    if (policy.operations.includes('select') && !(owner || (!cart && manager) || publicMenu))
      foodOrderingError(
        context,
        '$.auth.rowAccess.' + policy.id,
        'Carts are buyer-private; order records require ownership or the restaurant manager role, and public menu reads require availability.'
      )
    if (
      policy.operations.some(
        (operation) =>
          operation !== 'select' && !(menu && manager && ['insert', 'update'].includes(operation))
      )
    )
      foodOrderingError(
        context,
        '$.auth.rowAccess.' + policy.id,
        'Only the restaurant manager may author menu rows; fixed operations own carts, orders and history.'
      )
  }
  for (const resource of api?.resources ?? [])
    if (entities.has(resource.entityId) && resource.readFields.includes('owner_id'))
      foodOrderingError(
        context,
        '$.httpApi.resources.' + resource.id,
        'Food API projections do not expose internal owner identities.'
      )
}

function menuAuthoring(
  command: BackendCommandDefinitionIR,
  profile: BackendFoodOrderingIRV1
): boolean {
  if (command.access.kind !== 'role' || command.access.roleId !== profile.managerRoleId)
    return false
  const menuFields = new Set([
    'title',
    'category',
    'description',
    'image_url',
    'price',
    'available',
    'version'
  ])
  return command.steps.every((step) => {
    if (step.kind !== 'data.mutate' || step.entityId !== profile.entities.menuItems) return true
    return step.values.every(
      (entry) =>
        menuFields.has(entry.field) ||
        (step.operation === 'insert' &&
          entry.field === 'owner_id' &&
          entry.value.kind === 'caller-sub')
    )
  })
}

function workflowWrites(steps: BackendWorkflowStepIR[], entities: Set<string>): boolean {
  return steps.some((step) =>
    step.kind === 'data.mutate'
      ? entities.has(step.entityId)
      : step.kind === 'branch' &&
        (workflowWrites(step.consequent, entities) || workflowWrites(step.alternate, entities))
  )
}

function validateOrdinaryCommands(
  commands: BackendCommandDefinitionIR[],
  profile: BackendFoodOrderingIRV1,
  entities: Set<string>,
  context: BackendValidationContext
): void {
  for (const command of commands) {
    if (command.foodOrderingOperation) continue
    const writes = command.steps.filter(
      (step) => step.kind === 'data.mutate' && entities.has(step.entityId)
    )
    if (
      writes.some(
        (step) => step.kind === 'data.mutate' && step.entityId !== profile.entities.menuItems
      ) ||
      (writes.length && !menuAuthoring(command, profile))
    )
      foodOrderingError(
        context,
        '$.commands.commands.' + command.id,
        'Ordinary commands cannot change food state or bypass manager-only menu authoring.'
      )
  }
}

export function validateFoodOrderingWriteBoundaries(
  application: Pick<
    BackendApplicationSpecV1,
    'foodOrdering' | 'commerce' | 'commands' | 'httpApi' | 'workflows'
  >,
  context: BackendValidationContext
): void {
  const profile = application.foodOrdering
  if (!profile) return
  const entities = new Set(Object.values(profile.entities))
  if (Object.values(application.commerce?.entities ?? {}).some((id) => entities.has(id)))
    foodOrderingError(
      context,
      '$.foodOrdering.entities',
      'Food ordering and commerce must own distinct entities.'
    )
  for (const resource of application.httpApi?.resources ?? [])
    if (
      entities.has(resource.entityId) &&
      resource.operations.some((operation) => !['list', 'read'].includes(operation))
    )
      foodOrderingError(
        context,
        '$.httpApi.resources.' + resource.id,
        'Food resources are read-only; use explicit commands to change records.'
      )
  const commands = application.commands?.commands ?? []
  for (const operation of FOOD_ORDERING_OPERATIONS)
    if (!commands.some((command) => command.foodOrderingOperation === operation))
      foodOrderingError(
        context,
        '$.commands',
        'Food ordering requires every fixed operation exactly once.'
      )
  validateOrdinaryCommands(commands, profile, entities, context)
  for (const workflow of application.workflows.workflows)
    if (workflowWrites(workflow.steps, entities))
      foodOrderingError(
        context,
        '$.workflows.workflows.' + workflow.id,
        'Workflows cannot bypass the closed food command boundaries.'
      )
}
