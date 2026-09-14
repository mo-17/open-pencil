import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { emitNestJSCommands } from '#compiler/backend/nestjs/commands'
import { nestJSCommandPlan } from '#compiler/backend/nestjs/commands/plan'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'

type Row = Record<string, string | number | boolean | null>
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount: number }>
type Plan = ReturnType<typeof nestJSCommandPlan>
interface ServiceModule {
  CommandService: new (database: {
    transaction<T>(run: (client: { query: Query }) => Promise<T>): Promise<T>
  }) => {
    execute(
      plan: Plan,
      principal: { subject: string; roles: string[] } | null,
      key: string,
      body: unknown
    ): Promise<Row>
  }
}

/** Substitute only Nest's DI shell; authorization, arithmetic, SQL and replay logic stay generated. */
export async function commerceRuntime(application: BackendApplicationSpecV1) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-commerce-runtime-'))
  await writeFile(
    join(directory, 'nest.ts'),
    `export class BadRequestException extends Error {}
export class ConflictException extends Error {}
export class ForbiddenException extends Error {}
export class NotFoundException extends Error {}
export class UnauthorizedException extends Error {}
export class ServiceUnavailableException extends Error {}
export const Injectable = () => (target) => target
`
  )
  await writeFile(join(directory, 'database.service.ts'), 'export class DatabaseService {}\n')
  for (const artifact of emitNestJSCommands(application)) {
    const filename = artifact.path.split('/').at(-1)
    if (!filename?.endsWith('.ts') || typeof artifact.content !== 'string') continue
    await writeFile(
      join(directory, filename),
      artifact.content.replaceAll("'@nestjs/common'", "'./nest.ts'").replaceAll(/\.js'/gu, ".ts'")
    )
  }
  const service = (await import(
    pathToFileURL(join(directory, 'command.service.ts')).href
  )) as ServiceModule
  const data = (await import(pathToFileURL(join(directory, 'commerce-data.ts')).href)) as {
    amount(value: unknown): number
  }
  const refund = (await import(pathToFileURL(join(directory, 'commerce-refund.ts')).href)) as {
    refundGroupStatus(group: Row, orders: readonly Row[]): string
  }
  return {
    refund,
    service,
    data,
    plan: (id: string) => {
      const command = application.commands?.commands.find((entry) => entry.id === id)
      if (!command) throw new Error('Missing commerce command.')
      return nestJSCommandPlan(application, command)
    },
    dispose: () => rm(directory, { recursive: true, force: true })
  }
}

export function commerceApplication(mode: 'single-merchant' | 'multi-merchant' = 'multi-merchant') {
  return createCommerceOperationsApplication(
    'commerce-runtime-test',
    {
      kind: 'oidc-pkce',
      issuer: 'http://127.0.0.1:4010',
      clientId: 'test-public-client',
      scopes: ['openid'],
      callbackPath: '/_openpencil/auth/callback'
    },
    mode,
    250
  )
}
