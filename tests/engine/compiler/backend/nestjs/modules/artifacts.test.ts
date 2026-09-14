import { expect, test } from 'bun:test'

import { unsupportedBackendHttpAPIDiagnostics } from '#compiler/backend/http-api-support'
import { emitNestJSCommands } from '#compiler/backend/nestjs/commands'
import { emitNestJSModules } from '#compiler/backend/nestjs/modules'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { commandApplication } from '../commands/helpers'
import { modelFiles } from '../model-capabilities/helpers'

function application(): BackendApplicationSpecV1 {
  const app = commandApplication()
  const original = app.dataModel.entities[0]
  const archived = { ...structuredClone(original), id: 'archived-notes', name: 'archived_notes' }
  app.dataModel.entities.push(archived)
  app.auth.ownership.push({ ...app.auth.ownership[0], id: 'archive-owner', entityId: archived.id })
  const resources = app.httpApi?.resources ?? []
  const noteResources = resources.map((resource) => resource.id)
  resources.push({
    ...structuredClone(resources[0]),
    id: 'archive-api',
    path: '/archive',
    entityId: archived.id,
    operations: ['list', 'read']
  })
  delete resources[1].createFields
  delete resources[1].updateFields
  app.auth.rowAccess.push({
    id: 'archive-access',
    entityId: archived.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'owner', ownershipId: 'archive-owner' }
  })
  app.modules = {
    version: 1,
    modules: [
      {
        id: 'notes',
        name: 'Notes',
        entityIds: [original.id],
        resourceIds: noteResources,
        commandIds: ['rename-note'],
        dependsOn: ['archive']
      },
      {
        id: 'archive',
        name: 'Archive',
        entityIds: [archived.id],
        resourceIds: ['archive-api'],
        commandIds: [],
        dependsOn: []
      }
    ]
  }
  return app
}

test('emits real business modules and constrained command entry points with a shared kernel', () => {
  const app = application()
  const files = modelFiles(app)
  const file = (path: string) => {
    const result = files.get('backend/nestjs/' + path)
    if (typeof result !== 'string') throw new Error('Missing file ' + path)
    return result
  }
  expect(file('src/app.module.ts')).toContain(
    'imports: [DatabaseModule, AuthModule, BusinessModule0, BusinessModule1]'
  )
  expect(file('src/app.module.ts')).not.toContain('CommandModule')
  expect(file('src/modules/notes/module.ts')).toContain(
    'imports: [Resource1Module, BusinessModule0, CommandKernelModule]'
  )
  expect(file('src/modules/notes/module.ts')).toContain('exports: [BusinessModule1Service]')
  expect(file('src/modules/notes/commands.controller.ts')).toContain(
    '@Post("commands/rename-note")'
  )
  expect(file('src/modules/notes/commands.service.ts')).toContain(
    'Object.hasOwn(OWNED_PLANS, commandId)'
  )
  expect(file('src/command-kernel.module.ts')).not.toContain('controllers:')
  expect(files.has('backend/nestjs/src/command.controller.ts')).toBe(false)
  expect(files.has('backend/nestjs/src/command.module.ts')).toBe(false)
  expect(files.has('backend/nestjs/src/command-plans.ts')).toBe(false)
  expect(files.has('backend/nestjs/src/modules/archive/commands.controller.ts')).toBe(false)
  expect(
    JSON.parse(file('module-manifest.json')).modules.map((module: { id: string }) => module.id)
  ).toEqual(['archive', 'notes'])
  expect(file('MODULES.md')).toContain('do not grant roles, row access or tenant membership')
  expect(file('MODULES.md')).toContain('never switch to a fresh key')
  const plain = structuredClone(app)
  delete plain.modules
  const legacy = modelFiles(plain)
  for (const name of [
    'command.service.ts',
    'command-execution.ts',
    'command-input.ts',
    'identity.ts'
  ])
    expect(file('src/' + name)).toEqual(legacy.get('backend/nestjs/src/' + name))
  expect(file('migrations/001-initial.sql')).toEqual(
    legacy.get('backend/nestjs/migrations/001-initial.sql')
  )
  expect(emitNestJSModules(plain)).toEqual([])
  expect(
    emitNestJSCommands(plain).some((artifact) => artifact.path.endsWith('/command.controller.ts'))
  ).toBe(true)
})

test('orders modules deterministically and never derives TypeScript identifiers from module names', () => {
  const app = application()
  const reversed = structuredClone(app)
  reversed.modules?.modules.reverse()
  expect(modelFiles(reversed)).toEqual(modelFiles(app))
  const renamed = application()
  const modules = renamed.modules?.modules
  if (!modules) throw new Error('Missing modules')
  modules[0].id = 'constructor'
  modules[0].name = 'Friendly display name with spaces'
  const sources = modelFiles(renamed)
  expect(sources.get('backend/nestjs/src/modules/constructor/module.ts')).toContain(
    'export class BusinessModule1'
  )
  expect(sources.get('backend/nestjs/src/app.module.ts')).not.toContain('class constructor')
})

test('providers without modular generation reject the module contract explicitly', () => {
  expect(unsupportedBackendHttpAPIDiagnostics(application()).map((entry) => entry.code)).toContain(
    'backend-modules-provider-unimplemented'
  )
})
