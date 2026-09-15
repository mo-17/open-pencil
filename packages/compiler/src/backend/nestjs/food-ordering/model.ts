import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR
} from '@open-pencil/lowcode/backend'

import { nestJSEntitySQL } from '../entity-sql'

/** Closed profile field IDs become quoted SQL names only after shared provider validation. */
export function nestJSFoodOrderingModel(application: BackendApplicationSpecV1) {
  const profile = application.foodOrdering
  if (!profile) throw new Error('Missing validated food ordering profile.')
  const tables = Object.fromEntries(
    Object.entries(profile.entities).map(([key, id]) => {
      const entity = application.dataModel.entities.find((entry) => entry.id === id)
      if (!entity) throw new Error('Missing validated food ordering entity.')
      return [key, nestJSEntitySQL(entity)]
    })
  )
  return { ...profile, tables }
}

export function foodOrderingResultEntityId(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
): string | undefined {
  if (!command.foodOrderingOperation || !application.foodOrdering) return undefined
  return application.foodOrdering.entities[
    command.foodOrderingOperation.startsWith('cart.') ? 'carts' : 'orders'
  ]
}

export function foodOrderingAffectedEntities(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
): string[] {
  return command.foodOrderingOperation && application.foodOrdering
    ? Object.values(application.foodOrdering.entities)
    : []
}
