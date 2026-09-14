import { expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { commandApplication, required } from '../commands/fixture'

function boundedApplication(): BackendApplicationSpecV1 {
  const application = commandApplication()
  const template = required(application.commands).commands[0]
  const entity = structuredClone(application.dataModel.entities[0])
  application.dataModel.entities = []
  application.auth.ownership = []
  application.commands = { version: 1, commands: [] }
  application.modules = { version: 1, modules: [] }
  for (let index = 0; index < 8; index++) {
    const id = index === 0 ? 'notes' : 'notes-' + index
    application.dataModel.entities.push({ ...structuredClone(entity), id, name: 'notes_' + index })
    application.auth.ownership.push({
      id: index === 0 ? 'note-owner' : 'owner-' + index,
      entityId: id,
      identityFieldId: 'owner_id'
    })
    const commands = Array.from({ length: 16 }, (_, sequence) => {
      const command = structuredClone(template)
      command.id = 'operation-' + index + '-' + sequence
      command.path = '/commands/' + command.id
      command.steps = [command.steps[0], command.steps[3]].map((step) => ({
        ...step,
        entityId: id
      }))
      command.return = { resultName: 'inventory', fields: ['id', 'stock'] }
      return command
    })
    application.commands.commands.push(...commands)
    application.modules.modules.push({
      id: 'module-' + index,
      name: 'Module ' + index,
      entityIds: [id],
      resourceIds:
        index === 0 ? (application.httpApi?.resources.map((resource) => resource.id) ?? []) : [],
      commandIds: commands.map((command) => command.id),
      dependsOn: []
    })
  }
  return application
}

test('accepts 128 bounded commands in a valid partition and rejects aggregate/module overflows', () => {
  const application = boundedApplication()
  const parsed = parseBackendApplicationSpecV1(application)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
  expect(parsed.value.commands?.commands).toHaveLength(128)
  const commands = required(application.commands).commands
  const extra = { ...structuredClone(commands[0]), id: 'extra', path: '/commands/extra' }
  commands.push(extra)
  expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  commands.pop()
  required(application.modules).modules[0].commandIds.push(commands[16].id)
  expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
})

test('rejects empty, oversized and malformed module manifests instead of using them to raise command limits', () => {
  for (const mutate of [
    (app: BackendApplicationSpecV1) => {
      required(app.modules).modules = []
    },
    (app: BackendApplicationSpecV1) => {
      const modules = required(app.modules).modules
      modules.push(...structuredClone(modules), structuredClone(modules[0]))
    },
    (app: BackendApplicationSpecV1) => {
      required(app.modules).modules[0].id = '../module'
    }
  ]) {
    const app = boundedApplication()
    mutate(app)
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok).toBe(false)
    expect(parsed.diagnostics.some((entry) => entry.path === '$.commands.commands')).toBe(true)
  }
})
