import type { BackendArtifactSource } from '#compiler/backend/contracts'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSArtifact } from '../artifact'
import { nestJSCommandPlan } from '../commands/plan'
import type { NestJSBusinessModule } from './model'

export const COMMAND_KERNEL_MODULE_SOURCE = `import { Module } from '@nestjs/common'
import { CommandService } from './command.service.js'

// Shared transaction executor. Only module-owned controllers expose HTTP commands.
@Module({ providers: [CommandService], exports: [CommandService] })
export class CommandKernelModule {}
`

function serviceSource(module: NestJSBusinessModule): string {
  return `import { ForbiddenException, Injectable } from '@nestjs/common'
import { CommandService } from '../../command.service.js'
import type { CommandPlan, CommandRow } from '../../command-types.js'
import type { VerifiedPrincipal } from '../../identity.js'
import { COMMAND_PLANS } from './command-plans.js'

const OWNED_PLANS: Readonly<Record<string, CommandPlan>> = COMMAND_PLANS

@Injectable()
export class ${module.className}Service {
  constructor(private readonly kernel: CommandService) {}

  execute(commandId: string, principal: VerifiedPrincipal | null, key: string, body: unknown): Promise<CommandRow> {
    if (!Object.hasOwn(OWNED_PLANS, commandId)) throw new ForbiddenException('Access denied.')
    // Module membership limits dispatch. The kernel still verifies current row/role authority.
    return this.kernel.execute(OWNED_PLANS[commandId], principal, key, body)
  }
}
`
}
function controllerSource(
  module: NestJSBusinessModule,
  application: BackendApplicationSpecV1
): string {
  const commands =
    application.commands?.commands.filter((command) =>
      module.definition.commandIds.includes(command.id)
    ) ?? []
  return `import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import { requestPrincipal, type AuthenticatedRequest } from '../../identity.js'
import { noQuery } from '../../request-validation.js'
import { commandRequestKey } from '../../command-input.js'
import { ${module.className}Service } from './commands.service.js'

@Controller()
export class ${module.className}Controller {
  constructor(private readonly service: ${module.className}Service) {}

${commands
  .map(
    (command, index) => `  @Post(${JSON.stringify(command.path.slice(1))})
  @HttpCode(200)
  command${index}(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    noQuery(request.query)
    return this.service.execute(${JSON.stringify(command.id)}, requestPrincipal(request), commandRequestKey(request), body)
  }`
  )
  .join('\n\n')}
}
`
}

export function emitBusinessModuleCommands(
  module: NestJSBusinessModule,
  application: BackendApplicationSpecV1
): BackendArtifactSource[] {
  if (!module.definition.commandIds.length) return []
  const plans = Object.fromEntries(
    (application.commands?.commands ?? [])
      .filter((command) => module.definition.commandIds.includes(command.id))
      .map((command) => [command.id, nestJSCommandPlan(application, command)])
  )
  const root = 'src/' + module.directory + '/'
  return [
    nestJSArtifact(
      root + 'command-plans.ts',
      `import type { CommandPlan } from '../../command-types.js'\n\nexport const COMMAND_PLANS = ${JSON.stringify(plans, null, 2)} as const satisfies Readonly<Record<string, CommandPlan>>\n`
    ),
    nestJSArtifact(root + 'commands.service.ts', serviceSource(module)),
    nestJSArtifact(root + 'commands.controller.ts', controllerSource(module, application))
  ]
}
