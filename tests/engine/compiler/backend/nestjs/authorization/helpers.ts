import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { nestJSResources } from '#compiler/backend/nestjs/model'
import { emitNestJSListQuery } from '#compiler/backend/nestjs/query'
import { emitNestJSRequestValidation } from '#compiler/backend/nestjs/request-validation'
import { emitAuthenticationArtifacts } from '#compiler/backend/nestjs/runtime/auth'
import { emitNestJSService } from '#compiler/backend/nestjs/service'

import {
  deriveBackendApplicationCapabilities,
  parseBackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { nestJSApplication } from '../helpers'

export const SUBJECT = '11111111-1111-4111-8111-111111111111'
export const OTHER_SUBJECT = '22222222-2222-4222-8222-222222222222'
export const RECORD = '33333333-3333-4333-8333-333333333333'

export function authorizationApplication(mode: 'owner' | 'catalog' | 'mixed' = 'mixed') {
  const app = structuredClone(nestJSApplication())
  if (!app.httpApi) throw new Error('Missing test API')
  const resource = app.httpApi.resources[0]
  resource.operations = ['list', 'read', 'create', 'update', 'delete']
  resource.createFields = ['title']
  resource.updateFields = ['title']
  app.auth.rowAccess[0].operations = ['select', 'insert', 'update', 'delete']
  if (mode !== 'owner') {
    app.auth.roles.push({ id: 'catalog-admin', name: 'catalog_admin' })
    app.auth.rowAccess.push({
      id: 'catalog-administration',
      entityId: resource.entityId,
      effect: 'allow',
      principal: { kind: 'role', roleId: 'catalog-admin' },
      operations: ['select', 'insert', 'update', 'delete']
    })
  }
  if (mode === 'catalog') {
    app.auth.rowAccess.shift()
    app.auth.rowAccess.push({
      id: 'public-catalog',
      entityId: resource.entityId,
      effect: 'allow',
      principal: { kind: 'anonymous' },
      operations: ['select']
    })
  }
  app.capabilities = deriveBackendApplicationCapabilities(app).map((capability) => ({
    capability,
    required: true
  }))
  const parsed = parseBackendApplicationSpecV1(app)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
  return parsed.value
}

export interface Principal {
  subject: string
  roles: readonly string[]
}
export interface RequestFixture {
  rawHeaders: string[]
  headers: { authorization?: string }
  principal?: Principal
}
interface RuntimeService {
  list(principal: Principal | null, query: { limit: number; after?: string }): Promise<unknown>
  read(principal: Principal | null, id: string): Promise<unknown>
  create(principal: Principal | null, body: object): Promise<unknown>
  update(principal: Principal | null, id: string, body: object): Promise<unknown>
  delete(principal: Principal | null, id: string): Promise<unknown>
}
interface DatabaseFixture {
  query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}
interface IdentityModule {
  PUBLIC_READ: symbol
  normalizeRoles(value: unknown): readonly string[]
  normalizeIdentity(value: unknown): string
}
interface AuthModule {
  AuthService: new (
    config: object,
    resolver: unknown
  ) => { verify(token: string): Promise<Principal> }
}
interface GuardModule {
  AuthGuard: new (
    service: unknown,
    reflector: unknown
  ) => { canActivate(context: object): Promise<boolean> }
}
interface JWTFixture {
  tokens: Map<string, unknown>
  calls: Array<{ options: unknown }>
}

const NEST_STUB = `
export const Injectable = () => () => {}
export const Inject = () => () => {}
export const SetMetadata = (key,value) => (_target,_name,descriptor) => { descriptor.value[key] = value }
export class UnauthorizedException extends Error { getStatus(){return 401} }
export class ForbiddenException extends Error { getStatus(){return 403} }
export class BadRequestException extends Error { getStatus(){return 400} }
export class NotFoundException extends Error { getStatus(){return 404} }
export class Reflector {}
`

/** Executes generated authorization/service bodies; only Nest DI, crypto and SQL transport are controlled. */
export async function authorizationRuntime(
  mode: 'owner' | 'catalog' | 'mixed' = 'mixed',
  app = authorizationApplication(mode)
) {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-authorization-'))
  const write = (path: string, source: string) =>
    writeFileSync(
      join(directory, path),
      source
        .replaceAll("from '@nestjs/common'", "from './nest-stub.js'")
        .replaceAll("from '@nestjs/core'", "from './nest-stub.js'")
        .replaceAll("from 'jose'", "from './jwt-stub.js'")
        .replaceAll("from '../", "from './")
    )
  const load = (path: string) => import(pathToFileURL(join(directory, path)).href)
  write('nest-stub.ts', NEST_STUB)
  write(
    'jwt-stub.ts',
    `export const tokens = new Map(); export const calls = [];
export async function jwtVerify(token,_resolver,options) { calls.push({options}); const payload=tokens.get(token); if(!payload || payload instanceof Error) throw new Error('Invalid JWT'); return {payload} }
`
  )
  write(
    'environment.ts',
    'export function requiredEnvironment(){throw new Error("Not used by injected test") }'
  )
  write('database.service.ts', 'export class DatabaseService {}')
  for (const artifact of emitAuthenticationArtifacts(app)) {
    const path = artifact.path.split('/').at(-1)
    if (!path) throw new Error('Missing generated artifact path')
    if (path !== 'auth.module.ts') write(path, String(artifact.content))
  }
  write('list-query.ts', String(emitNestJSListQuery().content))
  write('request-validation.ts', String(emitNestJSRequestValidation().content))
  write('resource.service.ts', String(emitNestJSService(nestJSResources(app)[0], 0).content))
  try {
    const identity = (await load('identity.ts')) as IdentityModule
    const auth = (await load('auth.service.ts')) as AuthModule
    const guards = (await load('auth.guard.ts')) as GuardModule
    const jwt = (await load('jwt-stub.ts')) as JWTFixture
    const service = (await load('resource.service.ts')) as {
      Resource0Service: new (database: DatabaseFixture) => RuntimeService
    }
    const configuration = {
      issuer: 'https://identity.example.test',
      audience: 'notes-api',
      algorithms: ['RS256']
    }
    const authentication = new auth.AuthService(configuration, async () => undefined)
    const reflector = {
      get: (_key: symbol, handler: { publicRead: boolean }) => handler.publicRead
    }
    const guard = new guards.AuthGuard(authentication, reflector)
    return {
      app,
      identity,
      authentication,
      jwt,
      configuration,
      service: (database: DatabaseFixture) => new service.Resource0Service(database),
      guard: (request: RequestFixture, publicRead: boolean) =>
        guard.canActivate({
          switchToHttp: () => ({ getRequest: () => request }),
          getHandler: () => ({ publicRead })
        }),
      dispose: () => rmSync(directory, { recursive: true, force: true })
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
