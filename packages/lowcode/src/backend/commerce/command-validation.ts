import type { BackendCommandDefinitionIR } from '../commands/types'
import type { BackendValidationContext } from '../validation-helpers'
import { commerceCommandDefinition } from './operations'
import { commerceError } from './shape'
import type { BackendCommerceIRV1 } from './types'

export function validateCommerceCommand(
  command: BackendCommandDefinitionIR,
  commerce: BackendCommerceIRV1 | undefined,
  context: BackendValidationContext
): void {
  const path = '$.commands.commands.' + command.id
  if (!commerce || !command.commerceOperation) {
    commerceError(
      context,
      path,
      'Commerce operations require an explicit validated commerce declaration.'
    )
    return
  }
  const expected = commerceCommandDefinition(commerce, command.commerceOperation)
  for (const key of ['parameters', 'access', 'return'] as const) {
    if (JSON.stringify(command[key]) !== JSON.stringify(expected[key]))
      commerceError(
        context,
        path + '.' + key,
        'Commerce commands must preserve the fixed operation signature, authority and result projection.'
      )
  }
  if (command.steps.length)
    commerceError(
      context,
      path + '.steps',
      'Commerce operations cannot include executable command steps.'
    )
}
