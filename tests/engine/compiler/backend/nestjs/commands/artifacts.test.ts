import { expect, test } from 'bun:test'

import { unsupportedBackendHttpAPIDiagnostics } from '#compiler/backend/http-api-support'
import { planNestJSLocalPreviewMigration } from '#compiler/backend/nestjs/local-migration'
import { managedSchema } from '#compiler/managed-preview/schema'

import { modelFiles, normalizeModelApplication } from '../model-capabilities/helpers'
import { commandApplication } from './helpers'

test('emits a complete deterministic command, protected internal ledger and typed OpenAPI', () => {
  const application = commandApplication()
  const files = modelFiles(application)
  const second = modelFiles(application)
  expect(files).toEqual(second)
  const file = (name: string) => {
    const found = files.get('backend/nestjs/' + name)
    if (!found) throw new Error('Missing generated file ' + name)
    return found
  }
  expect(file('src/command.controller.ts')).toContain('@HttpCode(200)')
  expect(file('src/app.module.ts')).toContain('CommandModule')
  expect(file('migrations/001-initial.sql')).toContain(
    'CREATE TABLE public.openpencil_command_requests'
  )
  const schema = managedSchema(application)
  const ledger = schema.find((table) => table.name === 'openpencil_command_requests')
  expect(ledger?.catalog?.constraints[0].columns).toEqual([
    'application_id',
    'command_id',
    'subject',
    'request_key'
  ])
  const openapi = JSON.parse(file('openapi.json'))
  expect(
    openapi.paths['/commands/rename-note'].post.requestBody.content['application/json'].schema
      .required
  ).toEqual(['noteId', 'title'])
  expect(openapi.paths['/commands/rename-note'].post.parameters[0].name).toBe('Idempotency-Key')
  expect(openapi.paths['/openpencil_command_requests']).toBeUndefined()
  expect(
    JSON.parse(file('database-schema.json')).entities.some(
      (entity: { name: string }) => entity.name === ledger?.name
    )
  ).toBe(false)
})

test('other providers cannot silently omit commands even if they implement old atomic transactions', () => {
  expect(
    unsupportedBackendHttpAPIDiagnostics(commandApplication()).map((entry) => entry.code)
  ).toContain('backend-command-provider-unimplemented')
})

test('adding or removing a ledger is blocked while command-only edits retain schema and old attempts', async () => {
  const application = commandApplication()
  const without = structuredClone(application)
  delete without.commands
  const from = normalizeModelApplication(without)
  const to = normalizeModelApplication(application)
  if (!from.ok || !to.ok) throw new Error('Invalid command migration fixture')
  const result = await planNestJSLocalPreviewMigration({
    fromApplication: from.value,
    toApplication: to.value
  })
  expect(result.ok).toBe(false)
  if (!result.ok)
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'backend-local-migration-command-ledger-change-blocked'
    )
  const next = structuredClone(to.value)
  const command = next.commands?.commands[0]
  if (!command) throw new Error('Missing command')
  command.name = 'Rename note safely'
  const runtime = await planNestJSLocalPreviewMigration({
    fromApplication: to.value,
    toApplication: next
  })
  expect(runtime.ok).toBe(true)
  if (runtime.ok) expect(runtime.plan.sql).toBe('')
})
