import { deriveBackendApplicationCapabilities } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import { createNestJSNotesApplication, addNestJSEntity } from '../nestjs-draft'
import { commerceCommands, COMMERCE_ORDER_FIELDS } from './commands'

export function createCommerceApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
): BackendApplicationSpecV1 {
  const app = createNestJSNotesApplication(applicationId)
  const products = app.dataModel.entities.at(0)
  if (!products) throw new Error('The NestJS base model is missing its first entity.')
  products.name = 'products'
  products.fields = products.fields.filter((field) => field.id !== 'content')
  const field = (
    id: string,
    type: DataFieldIR['type'],
    defaultValue?: number | boolean
  ): DataFieldIR => ({
    id,
    name: id,
    type,
    nullable: false,
    ...(defaultValue === undefined ? {} : { default: { kind: 'literal', value: defaultValue } })
  })
  products.fields.push(
    field('price', 'integer', 0),
    field('stock', 'integer', 0),
    field('active', 'boolean', true)
  )
  const orders = addNestJSEntity(app, 'orders')
  orders.fields = orders.fields.filter((field) => ['id', 'owner_id'].includes(field.id))
  orders.fields.push(
    field('sku_id', 'uuid'),
    field('product_title', 'string'),
    field('unit_price', 'integer'),
    field('quantity', 'integer'),
    field('total', 'integer'),
    { id: 'status', name: 'status', type: 'enum', enumId: 'order-status', nullable: false },
    {
      id: 'created_at',
      name: 'created_at',
      type: 'datetime',
      nullable: false,
      default: { kind: 'generated', generator: 'created-at' }
    }
  )
  orders.indexes = [
    { id: 'owner-created', fields: ['owner_id', 'created_at', 'id'], order: 'desc' }
  ]
  orders.foreignKeys = [
    {
      id: 'order-sku',
      fields: ['sku_id'],
      targetEntityId: products.id,
      targetFields: ['id'],
      onDelete: 'restrict'
    }
  ]
  app.dataModel.enums.push({
    id: 'order-status',
    name: 'order_status',
    values: ['pending', 'cancelled']
  })
  const orderOwner = app.auth.ownership.find((rule) => rule.entityId === orders.id)
  if (!orderOwner) throw new Error('The order model is missing its owner rule.')
  app.auth.roles.push({ id: 'catalog-manager', name: 'catalog_manager' })
  app.auth.rowAccess = [
    {
      id: 'public-products',
      entityId: products.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' }
    },
    {
      id: 'manage-products',
      entityId: products.id,
      effect: 'allow',
      operations: ['insert', 'update'],
      principal: { kind: 'role', roleId: 'catalog-manager' }
    },
    {
      id: 'own-orders',
      entityId: orders.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: orderOwner.id }
    }
  ]
  const api = app.httpApi
  if (!api?.browserClient) throw new Error('The NestJS base model is missing its browser client.')
  api.browserClient.authentication = structuredClone(authentication)
  api.resources = [
    {
      id: 'products',
      path: '/products',
      entityId: products.id,
      operations: ['list', 'read', 'create', 'update'],
      readFields: ['id', 'title', 'price', 'stock', 'active'],
      createFields: ['title', 'price', 'stock', 'active'],
      updateFields: ['title', 'price', 'active'],
      maxPageSize: 50,
      query: { filterFields: ['active'], searchFields: ['title'], sortFields: ['price'] }
    },
    {
      id: 'orders',
      path: '/orders',
      entityId: orders.id,
      operations: ['list', 'read'],
      readFields: [...COMMERCE_ORDER_FIELDS],
      maxPageSize: 50,
      query: { filterFields: [], searchFields: [], sortFields: ['created_at'] }
    }
  ]
  app.commands = { version: 1, commands: commerceCommands(products.id, orders.id) }
  app.capabilities = deriveBackendApplicationCapabilities(app).map((capability) => ({
    capability,
    required: true
  }))
  return app
}
