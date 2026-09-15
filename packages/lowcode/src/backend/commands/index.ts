import { validateCommerceCommand } from '../commerce/command-validation'
import { validateFoodOrderingCommand } from '../food-ordering/command-validation'
import {
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from '../validation-helpers'
import { validateCommandReferences, type CommandReferences } from './references'
import { commandDefinition } from './shape'
import { commandError } from './shape-values'
import { BACKEND_COMMAND_IR_VERSION, type BackendCommandIRV1 } from './types'

function routeOverlap(command: string, resource: string): boolean {
  const route = command.toLowerCase()
  const base = resource.toLowerCase()
  return (
    route === base || (route.startsWith(base + '/') && !route.slice(base.length + 1).includes('/'))
  )
}

/** Command authority is intentionally independent of existing V2 transaction row-policy semantics. */
export function parseBackendCommandIRV1(
  value: unknown,
  path: string,
  references: CommandReferences,
  context: BackendValidationContext,
  maximumCommands = 16
): BackendCommandIRV1 | undefined {
  const source = record(value, path, context, ['version', 'commands'])
  if (!source) return undefined
  if (source.version !== BACKEND_COMMAND_IR_VERSION)
    commandError(context, path + '.version', 'Unsupported Backend command contract version.')
  if (!references.api)
    commandError(context, path, 'Commands require an explicit HTTP API authentication declaration.')
  if (references.api?.resources.some((resource) => resource.id === 'commands'))
    commandError(
      context,
      path,
      'HTTP resource id commands is reserved when server commands are declared.'
    )
  const commands = parseArrayItems(
    source.commands,
    path + '.commands',
    context,
    maximumCommands,
    commandDefinition
  )
  if (!commands) return undefined
  if (!commands.length)
    commandError(
      context,
      path + '.commands',
      'Omit the commands section when no commands are declared.'
    )
  uniqueBy(
    commands.map((command) => command.id),
    path + '.commands',
    context,
    'command id'
  )
  uniqueBy(
    commands.map((command) => command.path.toLowerCase()),
    path + '.commands',
    context,
    'command route'
  )
  uniqueBy(
    commands.flatMap((command) => (command.commerceOperation ? [command.commerceOperation] : [])),
    path + '.commands',
    context,
    'commerce operation'
  )
  uniqueBy(
    commands.flatMap((command) =>
      command.foodOrderingOperation ? [command.foodOrderingOperation] : []
    ),
    path + '.commands',
    context,
    'food ordering operation'
  )
  for (const command of commands) {
    if (references.api?.resources.some((resource) => routeOverlap(command.path, resource.path)))
      commandError(
        context,
        path + '.commands.' + command.id + '.path',
        'Command routes cannot collide with resource collection or item routes.'
      )
    if (command.foodOrderingOperation)
      validateFoodOrderingCommand(command, references.foodOrdering, context)
    else if (command.commerceOperation)
      validateCommerceCommand(command, references.commerce, context)
    else validateCommandReferences(command, references, context)
  }
  return {
    version: BACKEND_COMMAND_IR_VERSION,
    commands: sorted(commands, (command) => command.id)
  }
}
