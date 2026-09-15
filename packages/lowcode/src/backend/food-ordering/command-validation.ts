import type { BackendCommandDefinitionIR } from '../commands/types'
import type { BackendValidationContext } from '../validation-helpers'
import { foodOrderingCommandDefinition } from './operations'
import { foodOrderingError } from './shape'
import type { BackendFoodOrderingIRV1 } from './types'

export function validateFoodOrderingCommand(
  command: BackendCommandDefinitionIR,
  profile: BackendFoodOrderingIRV1 | undefined,
  context: BackendValidationContext
): void {
  const path = '$.commands.commands.' + command.id
  if (!profile || !command.foodOrderingOperation) {
    foodOrderingError(
      context,
      path,
      'Food operations require their explicit validated declaration.'
    )
    return
  }
  const expected = foodOrderingCommandDefinition(profile, command.foodOrderingOperation)
  for (const key of [
    'id',
    'path',
    'parameters',
    'access',
    'return',
    'idempotency',
    'steps'
  ] as const)
    if (JSON.stringify(command[key]) !== JSON.stringify(expected[key]))
      foodOrderingError(
        context,
        path + '.' + key,
        'Food operations must retain the fixed signature, authority, empty steps and result projection.'
      )
}
