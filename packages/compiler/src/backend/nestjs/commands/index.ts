import type { BackendArtifactSource } from '#compiler/backend/contracts'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSArtifact } from '../artifact'
import {
  emitNestJSCommerce,
  withCommerceCommandService,
  withCommerceCommandTypes
} from '../commerce'
import { COMMAND_KERNEL_MODULE_SOURCE } from '../modules/commands'
import {
  withRowPolicyCommandService,
  withRowPolicyCommandTypes
} from '../row-policy/command-source'
import {
  withTenantCommandExecution,
  withTenantCommandService,
  withTenantCommandTypes
} from '../tenant/command-source'
import { COMMAND_EXECUTION_SOURCE } from './execution-source'
import { COMMAND_INPUT_SOURCE } from './input-source'
import { nestJSCommandPlan } from './plan'
import { COMMAND_SERVICE_SOURCE } from './service-source'
import { COMMAND_TYPES_SOURCE } from './types-source'

function controllerSource(application: BackendApplicationSpecV1): string {
  const commands = application.commands?.commands ?? []
  return `import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common'
import { requestPrincipal, type AuthenticatedRequest } from './identity.js'
import { noQuery } from './request-validation.js'
import { commandRequestKey } from './command-input.js'
import { CommandService } from './command.service.js'
import { COMMAND_PLANS } from './command-plans.js'

@Controller()
export class CommandController {
  constructor(private readonly service: CommandService) {}

${commands
  .map(
    (command, index) => `  @Post(${JSON.stringify(command.path.slice(1))})
  @HttpCode(200)
  command${index}(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    noQuery(request.query)
    return this.service.execute(COMMAND_PLANS[${JSON.stringify(command.id)}], requestPrincipal(request), commandRequestKey(request), body)
  }`
  )
  .join('\n\n')}
}
`
}

export function emitNestJSCommands(application: BackendApplicationSpecV1): BackendArtifactSource[] {
  const commands = application.commands?.commands
  if (!commands?.length) return []
  const plans = Object.fromEntries(
    commands.map((command) => [command.id, nestJSCommandPlan(application, command)])
  )
  const tenants = application.auth.tenants.length > 0
  const rowPolicies = commands.some((command) => command.access.kind === 'row-policy')
  const module = `import { Module } from '@nestjs/common'
import { CommandController } from './command.controller.js'
import { CommandService } from './command.service.js'

@Module({ controllers: [CommandController], providers: [CommandService] })
export class CommandModule {}
`
  const baseTypes = tenants ? withTenantCommandTypes(COMMAND_TYPES_SOURCE) : COMMAND_TYPES_SOURCE
  const types = rowPolicies ? withRowPolicyCommandTypes(baseTypes) : baseTypes
  const baseService = tenants
    ? withTenantCommandService(COMMAND_SERVICE_SOURCE)
    : COMMAND_SERVICE_SOURCE
  const service = rowPolicies ? withRowPolicyCommandService(baseService) : baseService
  return [
    ...emitNestJSCommerce(application),
    nestJSArtifact(
      'src/command-types.ts',
      application.commerce ? withCommerceCommandTypes(types) : types
    ),
    ...(application.modules
      ? []
      : [
          nestJSArtifact(
            'src/command-plans.ts',
            `import type { CommandPlan } from './command-types.js'\n\nexport const COMMAND_PLANS = ${JSON.stringify(plans, null, 2)} as const satisfies Readonly<Record<string, CommandPlan>>\n`
          )
        ]),
    nestJSArtifact('src/command-input.ts', COMMAND_INPUT_SOURCE),
    nestJSArtifact(
      'src/command-execution.ts',
      tenants ? withTenantCommandExecution(COMMAND_EXECUTION_SOURCE) : COMMAND_EXECUTION_SOURCE
    ),
    nestJSArtifact(
      'src/command.service.ts',
      application.commerce ? withCommerceCommandService(service) : service
    ),
    ...(application.modules
      ? [nestJSArtifact('src/command-kernel.module.ts', COMMAND_KERNEL_MODULE_SOURCE)]
      : [
          nestJSArtifact('src/command.controller.ts', controllerSource(application)),
          nestJSArtifact('src/command.module.ts', module)
        ])
  ]
}
