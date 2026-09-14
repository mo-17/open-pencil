import { expect, test } from 'bun:test'

import { buildBackendCommandRuntime } from '#compiler/adapters/backend-client/commands'
import { unsupportedBackendHttpAPIDiagnostics } from '#compiler/backend/http-api-support'
import { nestJSCommandDefinitionDigest } from '#compiler/backend/nestjs/commands/plan'
import { validateLocalMigrationBoundary } from '#compiler/backend/nestjs/local-migration/boundary'
import { managedSchema } from '#compiler/managed-preview/schema'

import { modelFiles } from '../model-capabilities/helpers'
import { commerceApplication } from './helpers'

test.each(['single-merchant', 'multi-merchant'] as const)(
  'emits complete %s commerce runtime with flat SDK results and private ledgers',
  (mode) => {
    const application = commerceApplication(mode)
    const files = modelFiles(application)
    const file = (name: string) => {
      const content = files.get('backend/nestjs/' + name)
      if (typeof content !== 'string') throw new Error('Missing generated commerce file.')
      return content
    }
    expect(file('src/commerce-execution.ts')).toContain("case 'inventory.restock'")
    expect(file('src/commerce-data.ts')).toContain(
      'ON CONFLICT (application_id,entry_key) DO NOTHING'
    )
    expect(file('src/commerce-authorization.ts')).toContain(
      "process.env.NODE_ENV !== 'development'"
    )
    expect(file('src/commerce-authorization.ts')).toContain(
      "process.env.OPENPENCIL_COMMERCE_PAYMENT_MODE !== 'simulator'"
    )
    const source = file('src/command.service.ts')
    expect(source.indexOf('await authorizeCommerce(')).toBeLessThan(
      source.indexOf('const inserted =')
    )
    expect(source.indexOf('return storedResponse(')).toBeLessThan(
      source.indexOf('await executeCommerce(')
    )
    const api = JSON.parse(file('openapi.json'))
    expect(
      api.paths['/commands/cart-checkout'].post.requestBody.content['application/json'].schema
        .properties.address.maxLength
    ).toBe(1000)
    const result =
      api.paths['/commands/cart-checkout'].post.responses['200'].content['application/json'].schema
    expect(result.properties.total.type).toBe('integer')
    expect(result.properties.owner_id).toBeUndefined()
    expect(api.paths['/commands/payment-simulate'].post.security).toEqual([{ bearer: [] }])
    const tables = managedSchema(application)
    expect(tables).toHaveLength(13)
    for (const name of ['openpencil_commerce_events', 'openpencil_commerce_entries']) {
      expect(file('migrations/001-initial.sql')).toContain('CREATE TABLE public.' + name)
      expect(tables.find((table) => table.name === name)?.catalog?.constraints[0].kind).toBe('p')
      expect(api.paths['/' + name]).toBeUndefined()
    }
    expect(file('COMMERCE.md')).toContain('No real payment gateway')
    expect(file('src/payment-gateway.ts')).toContain('verifyWebhook(rawBody: Uint8Array')
    expect(file('src/command.controller.ts')).not.toContain('webhook')
    const refresh = buildBackendCommandRuntime(application)
    for (const resource of application.httpApi?.resources ?? [])
      expect(refresh).toContain(JSON.stringify(resource.id))
  }
)

test('commerce semantics bind idempotency digests, provider selection and managed migration boundaries', () => {
  const application = commerceApplication()
  const command = application.commands?.commands[0]
  if (!command || !application.commerce) throw new Error('Missing commerce fixture.')
  const digest = nestJSCommandDefinitionDigest(application, command)
  application.commerce.commissionBasisPoints = 500
  expect(nestJSCommandDefinitionDigest(application, command)).not.toBe(digest)
  const without = structuredClone(application)
  delete without.commerce
  expect(validateLocalMigrationBoundary(without, application).map((item) => item.code)).toContain(
    'backend-local-migration-commerce-ledger-change-blocked'
  )
  expect(
    unsupportedBackendHttpAPIDiagnostics({ commerce: application.commerce }).map(
      (item) => item.code
    )
  ).toContain('backend-commerce-provider-unimplemented')
})
