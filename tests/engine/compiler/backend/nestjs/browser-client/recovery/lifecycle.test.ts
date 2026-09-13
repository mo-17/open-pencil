import { describe, expect, test } from 'bun:test'

import { commandApplication } from '../command/helpers'
import { tick } from '../runtime/helpers'
import {
  commandInput,
  journalRows,
  recoveryEnvironment,
  recoveryFixture,
  recoveryInput
} from './helpers'

describe('generated account-bound command recovery', () => {
  test('commits only request data before dispatch and explicitly retries it after reload and login', async () => {
    const environment = recoveryEnvironment()
    const first = await recoveryFixture(environment)
    let key: unknown
    try {
      const running = first.runtime.backendCommand(commandInput)
      key = first.values.get('attempt')
      const duplicate = first.runtime.backendCommand(commandInput)
      const request = await first.waitForRequest(0)
      const rows = await journalRows(environment.indexedDB)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        version: 1,
        key,
        payload: JSON.stringify(commandInput.payload)
      })
      expect(Object.keys(rows[0] as object).sort()).toEqual([
        'createdAt',
        'definition',
        'key',
        'payload',
        'slot',
        'version'
      ])
      expect(JSON.stringify(rows)).not.toContain('synthetic-session-token')
      request.respond({ id: 'private-result', title: 'server-result' })
      expect(await running).toEqual(await duplicate)
      expect(JSON.stringify(await journalRows(environment.indexedDB))).not.toContain(
        'private-result'
      )
    } finally {
      first.dispose()
    }
    const reload = await recoveryFixture(environment)
    try {
      reload.auth.transition(null)
      await expect(
        reload.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
      ).rejects.toMatchObject({ status: 401 })
      reload.auth.transition('user-a')
      expect(reload.pending).toHaveLength(0)
      const inspected = await reload.runtime.backendCommandRecovery({
        ...recoveryInput,
        operation: 'inspect'
      })
      expect(inspected).toMatchObject({
        current: true,
        data: { status: 'recorded', key, payload: commandInput.payload }
      })
      expect(reload.values.get('attempt')).toBe('')
      await expect(reload.runtime.backendCommand(commandInput)).rejects.toMatchObject({
        status: 409
      })
      expect(reload.pending).toHaveLength(0)
      const retry = reload.runtime.backendCommandRecovery({
        ...recoveryInput,
        operation: 'retry',
        attemptKey: String(key)
      })
      const request = await reload.waitForRequest(0)
      expect(new Headers(request.call.init.headers).get('Idempotency-Key')).toBe(key)
      expect(JSON.parse(String(request.call.init.body))).toEqual(commandInput.payload)
      request.respond({ id: 'same-result', title: 'Original response' })
      await retry
      expect(reload.values.get('attempt')).toBe(key)
    } finally {
      reload.dispose()
    }
  })

  test('keeps unknown outcomes and never retries automatically on timeout or session transition', async () => {
    const environment = recoveryEnvironment()
    const fixture = await recoveryFixture(environment, commandApplication(), 25)
    try {
      const running = fixture.runtime.backendCommand(commandInput)
      const rejection = running.catch((error: unknown) => error)
      const request = await fixture.waitForRequest(0)
      const key = fixture.values.get('attempt')
      expect(await rejection).toMatchObject({ status: 503 })
      expect(request.call.init.signal?.aborted).toBe(true)
      fixture.auth.transition(null)
      expect(fixture.values.get('attempt')).toBe('')
      fixture.auth.transition('user-a')
      await tick()
      expect(fixture.pending).toHaveLength(1)
      expect(
        await fixture.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
      ).toMatchObject({ data: { status: 'recorded', key } })
    } finally {
      fixture.dispose()
    }
  })

  test('partitions accounts and auth/app/API origins, while definition changes remain visible and blocked', async () => {
    const environment = recoveryEnvironment()
    const original = await recoveryFixture(environment)
    let key: unknown
    try {
      const running = original.runtime.backendCommand(commandInput)
      const request = await original.waitForRequest(0)
      key = original.values.get('attempt')
      request.respond({ id: 'saved', title: 'Saved' })
      await running
      original.auth.transition('user-b')
      expect(
        await original.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
      ).toMatchObject({ data: { status: 'empty' } })
    } finally {
      original.dispose()
    }
    for (const field of [
      'issuer',
      'clientId',
      'resource',
      'apiBasePath',
      'applicationId',
      'origin'
    ] as const) {
      const application = structuredClone(commandApplication())
      const client = application.httpApi?.browserClient
      if (!client) throw new Error('Browser test client is required')
      const nextEnvironment = { ...environment }
      if (field === 'applicationId') application.applicationId += '-other'
      else if (field === 'origin') nextEnvironment.origin = 'https://other.test'
      else if (field === 'apiBasePath') client.apiBasePath += '-other'
      else client.authentication[field] = (client.authentication[field] ?? '') + '-other'
      const isolated = await recoveryFixture(nextEnvironment, application)
      try {
        expect(
          await isolated.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
        ).toMatchObject({ data: { status: 'empty' } })
      } finally {
        isolated.dispose()
      }
    }
    const changed = structuredClone(commandApplication())
    const definition = changed.commands?.commands[0]
    if (!definition) throw new Error('Command test definition is required')
    definition.name = 'Changed definition'
    const incompatible = await recoveryFixture(environment, changed)
    try {
      expect(
        await incompatible.runtime.backendCommandRecovery({
          ...recoveryInput,
          operation: 'inspect'
        })
      ).toMatchObject({ data: { status: 'incompatible', key } })
      await expect(
        incompatible.runtime.backendCommandRecovery({
          ...recoveryInput,
          operation: 'retry',
          attemptKey: String(key)
        })
      ).rejects.toMatchObject({ status: 409 })
      expect(incompatible.pending).toHaveLength(0)
      expect(
        await incompatible.runtime.backendCommandRecovery({
          ...recoveryInput,
          operation: 'acknowledge',
          attemptKey: String(key)
        })
      ).toMatchObject({ data: { status: 'empty' } })
    } finally {
      incompatible.dispose()
    }
  })
})
