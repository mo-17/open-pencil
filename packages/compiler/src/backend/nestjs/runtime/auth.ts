import type { BackendArtifactSource } from '#compiler/backend/contracts'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { withRowPolicyIdentity } from '../row-policy/identity-source'
import { usesNestJSRowPolicies } from '../row-policy/model'
import { withTenantIdentity } from '../tenant/identity-source'
import { runtimeArtifact } from './artifact'

const IDENTITY_SOURCE = String.raw`import { ForbiddenException, SetMetadata, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'

export interface VerifiedPrincipal {
  readonly subject: string
  readonly roles: readonly string[]
}

export interface AuthenticatedRequest extends Request {
  principal?: VerifiedPrincipal
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PUBLIC_READ = Symbol('openpencil.public-read')
export const PublicRead = () => SetMetadata(PUBLIC_READ, true)

export function normalizeIdentity(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new UnauthorizedException('Authentication required.')
  }
  return value.toLowerCase()
}

export function normalizeRoles(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || value.length > 64 ||
      value.some((role) => typeof role !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(role)) ||
      new Set(value).size !== value.length) {
    throw new UnauthorizedException('Authentication required.')
  }
  return Object.freeze([...value] as string[])
}

export function requestPrincipal(request: AuthenticatedRequest): VerifiedPrincipal | null {
  return request.principal ?? null
}

export interface ResourceAccessRule {
  readonly owner: boolean
  readonly public: boolean
  readonly roles: readonly string[]
}

export function rowScope(principal: VerifiedPrincipal | null, policy: ResourceAccessRule,
    ownerColumn: string, values: unknown[]): string {
  if (policy.public) return 'TRUE'
  if (!principal) throw new UnauthorizedException('Authentication required.')
  if (policy.roles.some((role) => principal.roles.includes(role))) return 'TRUE'
  if (policy.owner) return ownerColumn + ' = $' + values.push(principal.subject)
  throw new ForbiddenException('Operation is not permitted.')
}

export function createSubject(principal: VerifiedPrincipal | null, policy: ResourceAccessRule): string {
  if (!principal) throw new UnauthorizedException('Authentication required.')
  if (!policy.owner && !policy.roles.some((role) => principal.roles.includes(role)))
    throw new ForbiddenException('Operation is not permitted.')
  return principal.subject
}
`

const SERVICE_SOURCE = String.raw`import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { AUTH_CONFIGURATION, JWKS_RESOLVER } from './auth.config.js'
import type { AuthenticationConfiguration } from './auth.config.js'
import { normalizeIdentity, normalizeRoles, type VerifiedPrincipal } from './identity.js'

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_CONFIGURATION) private readonly configuration: AuthenticationConfiguration,
    @Inject(JWKS_RESOLVER) private readonly resolveKey: JWTVerifyGetKey,
  ) {}

  async verify(token: string): Promise<VerifiedPrincipal> {
    try {
      if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error('Invalid authentication token.')
      }
      const { payload } = await jwtVerify(token, this.resolveKey, {
        issuer: this.configuration.issuer,
        audience: this.configuration.audience,
        algorithms: [...this.configuration.algorithms],
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 0,
      })
      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
        throw new Error('Invalid authentication expiry.')
      }
      return Object.freeze({
        subject: normalizeIdentity(payload.sub),
        roles: normalizeRoles(payload.openpencil_roles),
      })
    } catch {
      throw new UnauthorizedException('Authentication required.')
    }
  }
}
`

const GUARD_SOURCE = String.raw`import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthService } from './auth.service.js'
import { PUBLIC_READ, type AuthenticatedRequest } from './identity.js'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly authentication: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    delete request.principal
    const values: string[] = []
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
        const value = request.rawHeaders[index + 1]
        if (typeof value === 'string') values.push(value)
      }
    }
    const authorization = values[0]
    if (values.length === 0 && request.headers.authorization === undefined &&
        this.reflector.get<boolean>(PUBLIC_READ, context.getHandler()) === true) return true
    if (values.length !== 1 || !authorization || authorization.length > 8199 ||
        request.headers.authorization !== authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required.')
    }
    request.principal = await this.authentication.verify(authorization.slice(7))
    return true
  }
}
`

const MODULE_SOURCE = String.raw`import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthGuard } from './auth.guard.js'
import { AuthService } from './auth.service.js'
import { AUTH_CONFIGURATION, JWKS_RESOLVER, loadAuthenticationConfiguration } from './auth.config.js'
import type { AuthenticationConfiguration } from './auth.config.js'
import { createJWKSResolver } from './jwks.js'

@Global()
@Module({
  providers: [
    { provide: AUTH_CONFIGURATION, useFactory: loadAuthenticationConfiguration },
    {
      provide: JWKS_RESOLVER,
      inject: [AUTH_CONFIGURATION],
      useFactory: (configuration: AuthenticationConfiguration) => createJWKSResolver(configuration),
    },
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
`

function configurationSource(application: BackendApplicationSpecV1): string {
  const authentication = application.httpApi?.authentication
  if (!authentication) throw new TypeError('NestJS runtime requires an HTTP API declaration.')
  return `import { requiredEnvironment } from './environment.js'

export const AUTH_CONFIGURATION = Symbol('openpencil.authentication-configuration')
export const JWKS_RESOLVER = Symbol('openpencil.jwks-resolver')

export interface AuthenticationConfiguration {
  readonly issuer: string
  readonly audience: string
  readonly jwksURL: URL
  readonly algorithms: readonly ('RS256' | 'ES256')[]
}

export function loadAuthenticationConfiguration(): AuthenticationConfiguration {
  const issuer = requiredEnvironment(${JSON.stringify(authentication.issuerEnvironment)})
  const audience = requiredEnvironment(${JSON.stringify(authentication.audienceEnvironment)})
  let jwksURL: URL
  try {
    jwksURL = new URL(requiredEnvironment(${JSON.stringify(authentication.jwksUrlEnvironment)}))
  } catch {
    throw new Error('Backend runtime configuration is invalid.')
  }
  if (jwksURL.protocol !== 'https:' || !jwksURL.hostname || jwksURL.username ||
      jwksURL.password || jwksURL.hash || jwksURL.search) {
    throw new Error('Backend runtime configuration is invalid.')
  }
  return Object.freeze({
    issuer,
    audience,
    jwksURL,
    algorithms: Object.freeze(${JSON.stringify(authentication.algorithms)} as const),
  })
}
`
}

export function emitAuthenticationArtifacts(
  application: BackendApplicationSpecV1
): BackendArtifactSource[] {
  const identity = application.auth.tenants.length
    ? withTenantIdentity(IDENTITY_SOURCE)
    : IDENTITY_SOURCE
  return [
    runtimeArtifact(
      'identity.ts',
      usesNestJSRowPolicies(application) ? withRowPolicyIdentity(identity) : identity
    ),
    runtimeArtifact('auth.config.ts', configurationSource(application)),
    runtimeArtifact('auth.service.ts', SERVICE_SOURCE),
    runtimeArtifact('auth.guard.ts', GUARD_SOURCE),
    runtimeArtifact('auth.module.ts', MODULE_SOURCE)
  ]
}
