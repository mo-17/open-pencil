import { describe, expect, test } from 'bun:test'

import { nestJSCommandPlan } from '#compiler/backend/nestjs/commands/plan'

import { withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createCommerceApplication } from '@/app/lowcode/backend/commerce/application'
import { COMMERCE_ORDER_FIELDS } from '@/app/lowcode/backend/commerce/commands'
import { createCommercePages } from '@/app/lowcode/backend/commerce/template'
import { validateBackendApplicationDraft } from '@/app/lowcode/backend/document'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  compileAppBackendProviderDocument,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'

import {
  COMMAND_ITEM,
  COMMAND_SUBJECT,
  commandRuntime,
  type RuntimeCommandDatabase,
  type RuntimeCommandQuery
} from '#tests/engine/compiler/backend/nestjs/commands/helpers'
import { QUERY_SPEC, queryRuntime } from '#tests/engine/compiler/backend/nestjs/query/helpers'

function application() {
  return createCommerceApplication('order-history', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'shop-public-client',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
}

async function fixture() {
  const entry = createBundledPluginCatalog().find(
    (value) => value.manifest.plugin.id === 'open-pencil.nestjs-backend'
  )
  if (!entry) throw new Error('Missing bundled NestJS provider')
  const store = createAppPluginStore({
    catalog: [entry],
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active NestJS provider')
  return { store, descriptor, application: application(), editor: createEditor() }
}

describe('commerce order history model', () => {
  test('declares immutable server snapshots and generated creation time without new checkout inputs', async () => {
    const { application: app, descriptor } = await fixture()
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
    expect(validateBackendApplicationDraft(app, descriptor).diagnostics).toEqual([])
    const orders = app.dataModel.entities.find((entity) => entity.name === 'orders')
    const resource = app.httpApi?.resources.find((entry) => entry.id === 'orders')
    const checkout = app.commands?.commands.find((entry) => entry.id === 'checkout')
    if (!orders || !resource || !checkout) throw new Error('Missing order model')
    expect(orders.fields.find((field) => field.id === 'product_title')).toEqual({
      id: 'product_title',
      name: 'product_title',
      type: 'string',
      nullable: false
    })
    expect(orders.fields.find((field) => field.id === 'created_at')).toEqual({
      id: 'created_at',
      name: 'created_at',
      type: 'datetime',
      nullable: false,
      default: { kind: 'generated', generator: 'created-at' }
    })
    expect(resource.operations).toEqual(['list', 'read'])
    expect(resource.readFields).toEqual(COMMERCE_ORDER_FIELDS)
    expect(resource.query).toEqual({
      filterFields: [],
      searchFields: [],
      sortFields: ['created_at']
    })
    expect(orders.indexes).toEqual([
      { id: 'owner-created', fields: ['owner_id', 'created_at', 'id'], order: 'desc' }
    ])
    expect(checkout.parameters).toEqual([
      { name: 'skuId', type: 'uuid', required: true },
      { name: 'quantity', type: 'integer', required: true, min: 1, max: 99 }
    ])
    const insert = checkout.steps.find(
      (step) => step.kind === 'data.mutate' && step.operation === 'insert'
    )
    if (insert?.kind !== 'data.mutate') throw new Error('Missing order insert')
    expect(insert.values).toContainEqual({
      field: 'product_title',
      value: { kind: 'result', name: 'product', field: 'title' }
    })
    expect(insert.values.some((entry) => entry.field === 'created_at')).toBe(false)
  })

  test('generated execution preserves the purchased title and time after catalog rename and cancellation', async () => {
    const app = application()
    const checkout = app.commands?.commands.find((entry) => entry.id === 'checkout')
    const cancel = app.commands?.commands.find((entry) => entry.id === 'cancel-order')
    if (!checkout || !cancel) throw new Error('Missing commerce commands')
    const loaded = await commandRuntime()
    const title = "Tea '春茶' — original"
    const product = { id: COMMAND_ITEM, title, price: 990, stock: 5, active: true }
    const orderId = '30000000-0000-4000-8000-000000000003'
    const createdAt = '2026-09-13T01:02:03.123456Z'
    let stored: Record<string, unknown> = {}
    const queries: RuntimeCommandQuery[] = []
    // PostgreSQL's row storage/default are substituted; generated SQL, value evaluation and
    // command result projections execute unchanged. No user database is contacted.
    const database: RuntimeCommandDatabase = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        if (text.startsWith('SELECT') && text.includes('FROM "public"."products"'))
          return { rowCount: 1, rows: [{ ...product }] }
        if (text.startsWith('UPDATE "public"."products"')) {
          product.stock = Number(values[0])
          return { rowCount: 1, rows: [{ id: product.id, stock: product.stock }] }
        }
        if (text.startsWith('INSERT INTO "public"."orders"')) {
          const columns = text
            .slice(text.indexOf('(') + 1, text.indexOf(') VALUES'))
            .split(', ')
            .map((column) => column.replaceAll('"', ''))
          stored = { id: orderId, created_at: createdAt }
          columns.forEach((column, index) => {
            stored[column] = values[index]
          })
          return { rowCount: 1, rows: [{ ...stored }] }
        }
        if (text.startsWith('SELECT') && text.includes('FROM "public"."orders"')) {
          expect(values).toEqual([orderId, COMMAND_SUBJECT])
          return { rowCount: 1, rows: [{ ...stored }] }
        }
        if (text.startsWith('UPDATE "public"."orders"')) {
          stored.status = values[0]
          return { rowCount: 1, rows: [{ ...stored }] }
        }
        throw new Error('Unexpected generated query')
      }
    }
    try {
      const plan = nestJSCommandPlan(app, checkout)
      expect(() =>
        loaded.input.commandInput(plan.parameters, {
          skuId: COMMAND_ITEM,
          quantity: 2,
          product_title: 'Untrusted title'
        })
      ).toThrow()
      const placed = await loaded.execution.executeCommand(
        database,
        plan,
        { skuId: COMMAND_ITEM, quantity: 2 },
        COMMAND_SUBJECT
      )
      expect(placed).toEqual({
        id: orderId,
        sku_id: COMMAND_ITEM,
        product_title: title,
        unit_price: 990,
        quantity: 2,
        total: 1980,
        status: 'pending',
        created_at: createdAt
      })
      expect(product.stock).toBe(3)
      expect(queries[0].text).toContain('"title" AS "title"')
      expect(queries[0].text).toEndWith('FOR UPDATE')
      const insert = queries.find((query) => query.text.startsWith('INSERT'))
      expect(insert?.text).not.toContain(title)
      expect(insert?.text.split(' RETURNING ')[0]).not.toContain('"created_at"')
      expect(insert?.text).toContain("AT TIME ZONE 'UTC'")
      product.title = 'Renamed catalog title'
      product.price = 1290
      const cancelled = await loaded.execution.executeCommand(
        database,
        nestJSCommandPlan(app, cancel),
        { orderId },
        COMMAND_SUBJECT
      )
      expect(cancelled).toEqual({ ...placed, status: 'cancelled' })
      expect(stored.product_title).toBe(title)
      expect(stored.created_at).toBe(createdAt)
      expect(product.stock).toBe(5)
    } finally {
      await loaded.dispose()
    }
  })

  test('generated time sorting preserves owner scope and deterministic tie breaks for equal timestamps', async () => {
    const loaded = await queryRuntime()
    try {
      const spec = {
        filterFields: [],
        searchFields: [],
        sortFields: [{ ...QUERY_SPEC.sortFields[1], id: 'created_at' }]
      }
      const input = { limit: '1', sort: 'created_at', direction: 'desc' }
      const query = loaded.runtime.listQuery(input, 50, spec)
      const createdAt = '2026-09-13T01:02:03.123456Z'
      const page = loaded.runtime.listPage(
        [{ id: COMMAND_ITEM, __openpencil_cursor: COMMAND_ITEM, __openpencil_sort: createdAt }, {}],
        query
      )
      const next = loaded.runtime.listQuery({ ...input, after: page.nextCursor }, 50, spec)
      const values: unknown[] = [COMMAND_SUBJECT]
      const sql = loaded.runtime.listStatement(
        {
          projection: '"product_title" AS "product_title"',
          table: '"public"."orders"',
          key: '"id"',
          where: '"owner_id" = $1'
        },
        next,
        values
      )
      expect(sql).toContain('WHERE ("owner_id" = $1)')
      expect(sql).toContain('("created_at", "id") < ($2, $3)')
      expect(sql).toContain('ORDER BY "created_at" DESC, "id" DESC')
      expect(values).toEqual([COMMAND_SUBJECT, createdAt, COMMAND_ITEM, 2])
      expect(page.data).toEqual([{ id: COMMAND_ITEM }])
    } finally {
      await loaded.dispose()
    }
  })

  test.each(['react', 'vue'] as const)(
    '%s exports the snapshot and server timestamp through the provider',
    async (target) => {
      const { application: app, descriptor, editor, store } = await fixture()
      const created = createCommercePages(editor, descriptor, app)
      const output = compileAppBackendProviderDocument(store, {
        graph: editor.graph,
        pageIds: created.pageIds,
        options: withDefaults({
          target,
          router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
          devMode: false
        })
      })
      expect(output.warnings).toEqual([])
      const sql = [...output.files].find(([path]) =>
        path.endsWith('migrations/001-initial.sql')
      )?.[1]
      expect(sql).toContain('"product_title" text NOT NULL')
      expect(sql).toContain(
        '"created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP'
      )
      expect(sql).toContain('("owner_id" DESC, "created_at" DESC, "id" DESC)')
      const client = output.files.get('backend/nestjs/client.ts')
      const rowTypes = client?.split('\n').filter((line) => line.startsWith('export type '))
      expect(rowTypes?.some((line) => line.includes('"product_title": string'))).toBe(true)
      expect(rowTypes?.some((line) => line.includes('"created_at": string'))).toBe(true)
    }
  )
})
