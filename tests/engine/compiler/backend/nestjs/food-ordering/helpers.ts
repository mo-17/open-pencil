import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { emitNestJSCommands } from '#compiler/backend/nestjs/commands'
import { nestJSCommandPlan } from '#compiler/backend/nestjs/commands/plan'

import { createFoodOrderingApplication } from '@/app/lowcode/backend/business/model/food-ordering/application'

export type FoodRow = Record<string, string | number | boolean | null>
export type FoodQuery = (
  sql: string,
  values?: unknown[]
) => Promise<{ rows: FoodRow[]; rowCount: number }>
type FoodPlan = ReturnType<typeof nestJSCommandPlan>
interface FoodClient {
  query: FoodQuery
}
interface FoodDatabase {
  transaction<T>(run: (client: FoodClient) => Promise<T>): Promise<T>
}
interface FoodRuntime {
  CommandService: new (database: FoodDatabase) => {
    execute(
      plan: FoodPlan,
      principal: { subject: string; roles: string[] } | null,
      key: string,
      body: unknown
    ): Promise<FoodRow>
  }
}
interface FoodOperations {
  checkoutFoodCart(
    client: FoodClient,
    cart: FoodRow,
    input: FoodRow,
    subject: string,
    fulfillment: 'dine_in' | 'pickup'
  ): Promise<FoodRow>
  transitionFoodOrder(
    client: FoodClient,
    order: FoodRow,
    plan: FoodPlan,
    input: FoodRow,
    subject: string
  ): Promise<FoodRow>
  foodAmount(value: unknown): number
}

export const foodApplication = () =>
  createFoodOrderingApplication('food-runtime-test', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'food-test-client',
    scopes: ['openid'],
    callbackPath: '/_openpencil/auth/callback'
  })

/** Keep generated validation/SQL/dispatch intact; only Nest DI and the query transport are injected. */
export async function foodRuntime() {
  const application = foodApplication()
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-food-runtime-'))
  await writeFile(
    join(directory, 'nest.ts'),
    [
      'BadRequestException',
      'ConflictException',
      'ForbiddenException',
      'NotFoundException',
      'UnauthorizedException',
      'ServiceUnavailableException'
    ]
      .map((name) => 'export class ' + name + ' extends Error {}')
      .join('\n') + '\nexport const Injectable = () => (target) => target\n'
  )
  await writeFile(join(directory, 'database.service.ts'), 'export class DatabaseService {}\n')
  for (const artifact of emitNestJSCommands(application)) {
    const name = artifact.path.split('/').at(-1)
    if (!name?.endsWith('.ts') || typeof artifact.content !== 'string') continue
    await writeFile(
      join(directory, name),
      artifact.content.replaceAll("'@nestjs/common'", "'./nest.ts'").replaceAll(/\.js'/gu, ".ts'")
    )
  }
  const load = (name: string) => import(pathToFileURL(join(directory, name + '.ts')).href)
  const service = (await load('command.service')) as FoodRuntime
  const operations = {
    ...(await load('food-data')),
    ...(await load('food-checkout')),
    ...(await load('food-orders'))
  } as FoodOperations
  return {
    application,
    service,
    operations,
    plan: (operation: string): FoodPlan => {
      const definition = application.commands?.commands.find(
        (command) => command.foodOrderingOperation === operation
      )
      if (!definition) throw new Error('Missing food command fixture.')
      return nestJSCommandPlan(application, definition)
    },
    dispose: () => rm(directory, { recursive: true, force: true })
  }
}
