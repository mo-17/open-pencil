import type { BackendCommandIRV1 } from '../commands/types'
import type {
  BackendHttpAPIIRV1,
  BackendHttpAPIResourceIRV1,
  BackendWorkflowIR,
  BackendWorkflowStepIR
} from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import { commerceError } from './shape'
import type { BackendCommerceIRV1 } from './types'

function workflowWrites(
  steps: BackendWorkflowStepIR[],
  entities: Set<string>,
  path: string,
  context: BackendValidationContext
): void {
  for (const step of steps) {
    if (step.kind === 'data.mutate' && entities.has(step.entityId))
      commerceError(
        context,
        path + '.' + step.id,
        'Workflows cannot mutate commerce entities outside the fixed commerce operations.'
      )
    if (step.kind === 'branch') {
      workflowWrites(step.consequent, entities, path + '.' + step.id + '.consequent', context)
      workflowWrites(step.alternate, entities, path + '.' + step.id + '.alternate', context)
    }
  }
}

function resourceWrites(
  commerce: BackendCommerceIRV1,
  resource: BackendHttpAPIResourceIRV1,
  context: BackendValidationContext
): void {
  const path = '$.httpApi.resources.' + resource.id
  const writes = resource.operations.filter((operation) => !['list', 'read'].includes(operation))
  if (resource.entityId === commerce.entities.products) {
    if (
      writes.includes('delete') ||
      resource.createFields?.some(
        (field) => !['store_id', 'title', 'price', 'stock', 'active'].includes(field)
      ) ||
      resource.updateFields?.some((field) => !['title', 'price', 'active'].includes(field))
    )
      commerceError(
        context,
        path,
        'Product CRUD permits bounded catalog authoring; stock changes require inventory.restock.'
      )
  } else if (resource.entityId === commerce.entities.stores) {
    if (
      writes.some((operation) => operation !== 'create') ||
      resource.createFields?.some((field) => field !== 'title')
    )
      commerceError(
        context,
        path,
        'Stores permit title-only creation with immutable owner and single-store defaults.'
      )
  } else if (writes.length)
    commerceError(
      context,
      path,
      'Commerce state tables expose reads only; mutations require fixed commerce operations.'
    )
}

/** No ordinary CRUD, command or nested workflow may bypass commerce state and inventory rules. */
export function validateCommerceWriteBoundaries(
  commerce: BackendCommerceIRV1,
  api: BackendHttpAPIIRV1 | undefined,
  commands: BackendCommandIRV1 | undefined,
  workflows: BackendWorkflowIR,
  context: BackendValidationContext
): void {
  const entities = new Set(Object.values(commerce.entities))
  for (const resource of api?.resources ?? []) {
    if (entities.has(resource.entityId)) resourceWrites(commerce, resource, context)
  }
  for (const command of commands?.commands ?? []) {
    if (
      !command.commerceOperation &&
      command.steps.some((step) => step.kind === 'data.mutate' && entities.has(step.entityId))
    )
      commerceError(
        context,
        '$.commands.commands.' + command.id,
        'Ordinary commands cannot mutate commerce entities.'
      )
  }
  for (const workflow of workflows.workflows)
    workflowWrites(workflow.steps, entities, '$.workflows.workflows.' + workflow.id, context)
}
