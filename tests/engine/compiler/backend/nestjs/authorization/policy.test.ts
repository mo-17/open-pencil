import { describe, expect, test } from 'bun:test'

import {
  nestJSAuthorization,
  validateNestJSAuthorization
} from '#compiler/backend/nestjs/authorization'
import { emitNestJSController } from '#compiler/backend/nestjs/controller'
import { nestJSResources } from '#compiler/backend/nestjs/model'

import { authorizationApplication } from './helpers'

describe('NestJS explicit access policy compilation', () => {
  test('permits role catalog management and separately declared public read only', () => {
    const app = authorizationApplication('catalog')
    expect(validateNestJSAuthorization(app)).toEqual([])
    const authorization = nestJSAuthorization(app, app.auth.ownership[0])
    expect(authorization.select).toEqual({ public: true, owner: false, roles: ['catalog-admin'] })
    expect(authorization.update).toEqual({ public: false, owner: false, roles: ['catalog-admin'] })
    const controller = String(emitNestJSController(nestJSResources(app)[0], 0)[0].content)
    expect(controller.match(/@PublicRead\(\)/g)).toHaveLength(2)
    expect(controller).not.toContain('@PublicRead()\n  @Post')
    expect(controller).not.toContain('@PublicRead()\n  @Patch')
    expect(controller).not.toContain('@PublicRead()\n  @Delete')
  })

  test('combines owner and role policy grants without an implicit public grant', () => {
    const app = authorizationApplication('mixed')
    expect(validateNestJSAuthorization(app)).toEqual([])
    expect(nestJSAuthorization(app, app.auth.ownership[0]).select).toEqual({
      public: false,
      owner: true,
      roles: ['catalog-admin']
    })
  })

  test('rejects anonymous writes, deny policy and a missing operation policy', () => {
    const app = authorizationApplication('catalog')
    const publicPolicy = app.auth.rowAccess.find((policy) => policy.principal.kind === 'anonymous')
    if (!publicPolicy) throw new Error('Missing public read test policy')
    publicPolicy.operations.push('insert')
    expect(validateNestJSAuthorization(app)).not.toEqual([])
    publicPolicy.operations = ['select']
    publicPolicy.effect = 'deny'
    expect(validateNestJSAuthorization(app)).not.toEqual([])
    app.auth.rowAccess = []
    expect(validateNestJSAuthorization(app)).not.toEqual([])
  })
})
