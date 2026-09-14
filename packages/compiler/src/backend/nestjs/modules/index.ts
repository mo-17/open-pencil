import type { BackendArtifactSource } from '#compiler/backend/contracts'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSArtifact, nestJSJSONArtifact } from '../artifact'
import { emitBusinessModuleCommands } from './commands'
import { nestJSBusinessModules, type NestJSBusinessModule } from './model'

function moduleSource(
  module: NestJSBusinessModule,
  application: BackendApplicationSpecV1,
  allModules: NestJSBusinessModule[]
): string {
  const resources = (application.httpApi?.resources ?? []).flatMap((resource, index) =>
    module.definition.resourceIds.includes(resource.id) ? [{ resource, index }] : []
  )
  const dependencies = allModules.filter((entry) =>
    module.definition.dependsOn.includes(entry.definition.id)
  )
  const imports = [
    ...resources.map(
      ({ resource, index }) =>
        `import { Resource${index}Module } from '../../resources/${resource.id}.module.js'`
    ),
    ...dependencies.map(
      (dependency) =>
        `import { ${dependency.className} } from '../${dependency.definition.id}/module.js'`
    )
  ]
  const importedModules = [
    ...resources.map(({ index }) => `Resource${index}Module`),
    ...dependencies.map((dependency) => dependency.className)
  ]
  const commands = module.definition.commandIds.length > 0
  if (commands) {
    imports.push(
      "import { CommandKernelModule } from '../../command-kernel.module.js'",
      `import { ${module.className}Controller } from './commands.controller.js'`,
      `import { ${module.className}Service } from './commands.service.js'`
    )
    importedModules.push('CommandKernelModule')
  }
  return `import { Module } from '@nestjs/common'
${imports.join('\n')}

@Module({
  imports: [${importedModules.join(', ')}],
${
  commands
    ? `  controllers: [${module.className}Controller],
  providers: [${module.className}Service],
  exports: [${module.className}Service],\n`
    : ''
}})
export class ${module.className} {}
`
}
function guide(modules: NestJSBusinessModule[]): string {
  return `# Modular backend

This export runs one NestJS application, one PostgreSQL database and one verified JWT identity boundary. It does not create independently deployed microservices, network RPC or distributed transactions.

Each business module imports its owned HTTP resource modules and declares its own command controller/provider. Its command service only dispatches its declared command IDs. Dependencies expose module providers; they do not grant roles, row access or tenant membership. The shared CommandKernelModule performs the existing authorization, deterministic locks, transaction and idempotency checks, including current row authority before replay.

| Module | NestJS class | Source | Dependencies |
| --- | --- | --- | --- |
${modules.map((module) => `| ${module.definition.id} | ${module.className} | src/${module.directory}/module.ts | ${module.definition.dependsOn.join(', ') || 'None'} |`).join('\n')}

Review module-manifest.json together with database-schema.json, the row policies and each module's command-plans.ts. All migrations remain a single application migration history. Existing-data schema changes require the normal reviewed migration process. A dependency declaration never authorizes SQL or generates unrestricted cross-module endpoints. Commerce stays one indivisible module with its existing financial and inventory guards. Modules with workflows or storage are rejected until those features have explicit ownership contracts.

Adding model objects also updates existing command definition digests. Old idempotency keys remain stored and may return HTTP 409 after an upgrade. Review and complete pending operations before upgrading; never switch to a fresh key to retry an operation with an unknown result.

The API paths and frontend client remain unchanged. Configure and start the exported application using README.md. External identity-provider setup, production infrastructure and any real payment gateway are separate deployment work.
`
}

export function emitNestJSModules(application: BackendApplicationSpecV1): BackendArtifactSource[] {
  if (!application.modules) return []
  const modules = nestJSBusinessModules(application)
  return [
    nestJSJSONArtifact(
      'module-manifest.json',
      {
        format: 'openpencil.nestjs-modules.v1',
        version: 1,
        deployment: 'single-process',
        database: 'shared-postgresql',
        authorization: 'existing-application-policies',
        modules: modules.map((module) => ({
          ...module.definition,
          nestModule: module.className,
          source: 'src/' + module.directory + '/module.ts'
        }))
      },
      'server-runtime'
    ),
    nestJSArtifact('MODULES.md', guide(modules)),
    ...modules.flatMap((module) => [
      nestJSArtifact(
        'src/' + module.directory + '/module.ts',
        moduleSource(module, application, modules)
      ),
      ...emitBusinessModuleCommands(module, application)
    ])
  ]
}
