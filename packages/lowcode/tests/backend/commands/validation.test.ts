import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import {
  commandApplication,
  insertStep,
  literal,
  parameter,
  readStep,
  required,
  updateStep
} from './fixture'

function command(application: ReturnType<typeof commandApplication>) {
  return required(application.commands).commands[0]
}

describe('bounded Backend server command authority', () => {
  test('accepts bounded strings, booleans and nullable or empty text literals', () => {
    for (const value of ['', null, '订单 🛒']) {
      const application = commandApplication()
      application.dataModel.entities[1].fields.push({
        id: 'memo',
        name: 'memo',
        type: 'string',
        nullable: true
      })
      command(application).parameters.push(
        { name: 'memo', type: 'string', required: true, maxLength: 512 },
        { name: 'gift', type: 'boolean', required: true }
      )
      insertStep(command(application).steps[4]).values.push({
        field: 'memo',
        value: literal(value)
      })
      expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    }
  })
  test('validates checkout and owner-checked cancellation without granting buyers inventory CRUD', () => {
    const application = commandApplication()
    application.auth.rowAccess = []
    const parsed = parseBackendApplicationSpecV1(application)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    expect(parsed.value.auth.rowAccess).toEqual([])
    expect(parsed.value.commands?.commands.map((entry) => entry.id)).toEqual(['cancel', 'checkout'])
  })
  test.each([
    [
      'unknown parameter',
      (app: ReturnType<typeof commandApplication>) => {
        readStep(command(app).steps[0]).key = parameter('unknown')
      }
    ],
    [
      'forward result',
      (app: ReturnType<typeof commandApplication>) => {
        readStep(command(app).steps[0]).key = { kind: 'result', name: 'order', field: 'id' }
      }
    ],
    [
      'hidden result field',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).values[0].value = {
          kind: 'result',
          name: 'product',
          field: 'owner_id'
        }
      }
    ],
    [
      'wrong assignment type',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).values[0].value = parameter('productId')
      }
    ],
    [
      'bad enum member',
      (app: ReturnType<typeof commandApplication>) => {
        const step = command(app).steps[1]
        if (step.kind === 'assert') step.right = literal('invented')
      }
    ],
    [
      'owner impersonation',
      (app: ReturnType<typeof commandApplication>) => {
        insertStep(command(app).steps[4]).values[0].value = parameter('productId')
      }
    ],
    [
      'missing required owner',
      (app: ReturnType<typeof commandApplication>) => {
        insertStep(command(app).steps[4]).values.shift()
      }
    ],
    [
      'owner update',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).values = [
          { field: 'owner_id', value: { kind: 'caller-sub' } }
        ]
      }
    ],
    [
      'primary key update',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).values = [{ field: 'id', value: parameter('productId') }]
      }
    ],
    [
      'generated field write',
      (app: ReturnType<typeof commandApplication>) => {
        insertStep(command(app).steps[4]).values.push({
          field: 'id',
          value: parameter('productId')
        })
      }
    ],
    [
      'unlocked insertion reference',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).steps.push({
          ...updateStep(command(app).steps[3]),
          id: 'unsafe',
          record: 'order',
          entityId: 'orders',
          resultName: 'unsafe',
          values: [{ field: 'quantity', value: literal(1) }]
        })
      }
    ],
    [
      'cross entity update',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).entityId = 'orders'
      }
    ],
    [
      'missing read primary key',
      (app: ReturnType<typeof commandApplication>) => {
        readStep(command(app).steps[0]).fields = ['stock', 'price', 'status']
      }
    ],
    [
      'unprojected response',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).return.fields.push('owner_id')
      }
    ],
    [
      'missing role',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).access = { kind: 'role', roleId: 'missing' }
      }
    ],
    [
      'no mutation',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).steps = command(app).steps.slice(0, 3)
      }
    ],
    [
      'reserved param',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).parameters[0].name = 'constructor'
      }
    ],
    [
      'resource route overlap',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).path = '/API/notes/checkout'
      }
    ],
    [
      'reserved SDK resource',
      (app: ReturnType<typeof commandApplication>) => {
        app.httpApi.resources[0].id = 'commands'
      }
    ],
    [
      'duplicate routes',
      (app: ReturnType<typeof commandApplication>) => {
        required(app.commands).commands[1].path = command(app).path.toUpperCase()
      }
    ],
    [
      'nullable arithmetic',
      (app: ReturnType<typeof commandApplication>) => {
        required(app.dataModel.entities[0].fields.find((field) => field.id === 'stock')).nullable =
          true
      }
    ],
    [
      'integer overflow literal',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).values[0].value = literal(2147483648)
      }
    ],
    [
      'null required value',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).values[0].value = literal(null)
      }
    ],
    [
      'duplicate assignment',
      (app: ReturnType<typeof commandApplication>) => {
        const values = updateStep(command(app).steps[3]).values
        values.push(structuredClone(values[0]))
      }
    ],
    [
      'empty read projection',
      (app: ReturnType<typeof commandApplication>) => {
        readStep(command(app).steps[0]).fields = []
      }
    ],
    [
      'duplicate result',
      (app: ReturnType<typeof commandApplication>) => {
        updateStep(command(app).steps[3]).resultName = 'product'
      }
    ],
    [
      'non-UUID key',
      (app: ReturnType<typeof commandApplication>) => {
        app.dataModel.entities[1].fields[0].type = 'integer'
      }
    ],
    [
      'duplicate owner',
      (app: ReturnType<typeof commandApplication>) => {
        app.auth.ownership.push({
          id: 'duplicate-owner',
          entityId: 'orders',
          identityFieldId: 'product_id'
        })
      }
    ],
    [
      'trailing slash route',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).path += '/'
      }
    ],
    [
      'oversized step list',
      (app: ReturnType<typeof commandApplication>) => {
        command(app).steps = Array.from({ length: 17 }, () =>
          structuredClone(command(app).steps[0])
        )
      }
    ],
    [
      'oversized command list',
      (app: ReturnType<typeof commandApplication>) => {
        required(app.commands).commands = Array.from({ length: 17 }, () =>
          structuredClone(command(app))
        )
      }
    ]
  ] as const)('rejects %s', (_name, mutate) => {
    const application = commandApplication()
    mutate(application)
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
  test.each([
    { name: 'count', type: 'integer', required: true, min: 0, max: 2147483648 },
    { name: 'count', type: 'integer', required: true, min: 10, max: 1 },
    { name: 'count', type: 'integer', required: true, min: 1 },
    { name: 'count', type: 'uuid', required: false },
    { name: 'count', type: 'uuid', required: true, maxLength: 10 },
    { name: 'text', type: 'string', required: true, maxLength: 513 },
    { name: '__proto__', type: 'string', required: true, maxLength: 20 }
  ])('rejects invalid parameter bounds or shape %#', (value) => {
    const application = commandApplication()
    Reflect.set(command(application), 'parameters', [value])
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
  test('rejects recursive arithmetic, unknown executable fields, empty sections and missing HTTP auth', () => {
    for (const change of [
      (app: ReturnType<typeof commandApplication>) => {
        const value = updateStep(command(app).steps[3]).values[0].value
        Reflect.set(value, 'left', structuredClone(value))
      },
      (app: ReturnType<typeof commandApplication>) => {
        Reflect.set(command(app), 'sql', 'UPDATE notes SET stock=0')
      },
      (app: ReturnType<typeof commandApplication>) => {
        required(app.commands).commands = []
      },
      (app: ReturnType<typeof commandApplication>) => {
        Reflect.deleteProperty(app, 'httpApi')
      }
    ]) {
      const application = commandApplication()
      change(application)
      expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    }
  })
  test('never invokes command accessors while validating authored data', () => {
    const application = commandApplication()
    let invoked = false
    Object.defineProperty(command(application), 'name', {
      enumerable: true,
      get() {
        invoked = true
        return 'unsafe'
      }
    })
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    expect(invoked).toBe(false)
  })
})
