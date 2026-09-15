import { expect, test } from 'bun:test'

import { buildBackendCommandRuntime } from '#compiler/adapters/backend-client/commands'
import { nestJSCommandDefinitionDigest } from '#compiler/backend/nestjs/commands/plan'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'

import { commerceApplication } from '../commerce/helpers'
import { modelFiles } from '../model-capabilities/helpers'
import { foodApplication } from './helpers'

function text(files: Map<string, string | Uint8Array>, path: string): string {
  const value = files.get('backend/nestjs/' + path)
  if (typeof value !== 'string') throw new Error('Missing food ordering artifact: ' + path)
  return value
}

test('food profile emits the closed kitchen runtime, flat response schemas and complete client invalidation', () => {
  const application = foodApplication()
  const files = modelFiles(application)
  for (const name of ['model', 'data', 'authorization', 'cart', 'checkout', 'orders', 'execution'])
    expect(files.has('backend/nestjs/src/food-' + name + '.ts')).toBe(true)
  const service = text(files, 'src/command.service.ts')
  expect(service.indexOf('await authorizeFoodOrdering(')).toBeLessThan(
    service.indexOf('const inserted =')
  )
  expect(service.indexOf('return storedResponse(')).toBeLessThan(
    service.indexOf('await executeFoodOrdering(')
  )
  const api = JSON.parse(text(files, 'openapi.json'))
  const checkout = api.paths['/commands/food-checkout-dine-in'].post
  const parameters = checkout.requestBody.content['application/json'].schema
  expect(parameters.additionalProperties).toBe(false)
  expect(parameters.properties.total).toBeUndefined()
  expect(parameters.properties.tableNumber.maxLength).toBe(32)
  const result = checkout.responses['200'].content['application/json'].schema
  expect(result.properties.total.type).toBe('integer')
  expect(result.properties.owner_id).toBeUndefined()
  expect(result.properties.fulfillment.enum).toEqual(['dine_in', 'pickup'])
  expect(text(files, 'FOOD-ORDERING.md')).toContain('does not accept payments')
  const client = buildBackendCommandRuntime(application)
  const invalidation = /const commandResources: Record<string, readonly string\[\]> = (.+)\n/u.exec(
    client
  )
  expect(invalidation).not.toBeNull()
  const resources = JSON.parse(invalidation?.[1] ?? '{}')
  const keys = Object.values(application.foodOrdering?.entities ?? {})
  const affected = application.httpApi?.resources
    .filter((resource) => keys.includes(resource.entityId))
    .map((resource) => resource.id)
  expect(resources['food.checkout.dine-in']).toEqual(affected)
})

test('food semantics participate in persisted attempt digests', () => {
  const application = foodApplication()
  const command = application.commands?.commands.find(
    (entry) => entry.foodOrderingOperation === 'cart.set'
  )
  if (!command || !application.foodOrdering) throw new Error('Food fixture is incomplete')
  const before = nestJSCommandDefinitionDigest(application, command)
  application.foodOrdering.managerRoleId = 'another-food-manager'
  expect(nestJSCommandDefinitionDigest(application, command)).not.toBe(before)
})

test('composed commerce and food modules emit one service with both authorization and dispatch branches', () => {
  const application = composeBusinessModules(commerceApplication(), ['food-ordering']).application
  const files = modelFiles(application)
  const service = text(files, 'src/command.service.ts')
  for (const operation of ['authorizeFoodOrdering', 'authorizeCommerce'])
    expect(service.indexOf('await ' + operation + '(')).toBeLessThan(
      service.indexOf('const inserted =')
    )
  expect(service).toContain('plan.foodOrderingOperation')
  expect(service).toContain('plan.commerceOperation')
  expect(service).toContain('await executeCommand(client, plan, input, principal.subject)')
  const types = text(files, 'src/command-types.ts')
  expect(types).toContain('readonly foodOrderingOperation?:')
  expect(types).toContain('readonly commerceOperation?:')
  expect(files.has('backend/nestjs/src/food-execution.ts')).toBe(true)
  expect(files.has('backend/nestjs/src/commerce-execution.ts')).toBe(true)
})
