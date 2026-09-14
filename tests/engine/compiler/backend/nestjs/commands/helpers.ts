import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { emitNestJSCommands } from '#compiler/backend/nestjs/commands'
import { nestJSCommandPlan } from '#compiler/backend/nestjs/commands/plan'
import { emitAuthenticationArtifacts } from '#compiler/backend/nestjs/runtime/auth'

import type {
  BackendApplicationSpecV1,
  BackendCommandLeafIR,
  BackendCommandParameterIR,
  BackendCommandValueSourceIR
} from '@open-pencil/lowcode/backend'

import { browserApplication } from '../browser-client/helpers'

export const COMMAND_SUBJECT = '10000000-0000-4000-8000-000000000001'
export const COMMAND_ITEM = '20000000-0000-4000-8000-000000000002'

export function commandApplication(): BackendApplicationSpecV1 {
  const application = browserApplication()
  application.commands = {
    version: 1,
    commands: [
      {
        id: 'rename-note',
        name: 'Rename a note',
        path: '/commands/rename-note',
        access: { kind: 'authenticated' },
        idempotency: { kind: 'required', header: 'Idempotency-Key' },
        parameters: [
          { name: 'noteId', type: 'uuid', required: true },
          { name: 'title', type: 'string', required: true, maxLength: 128 }
        ],
        steps: [
          {
            id: 'load',
            kind: 'data.read',
            entityId: 'notes',
            resultName: 'note',
            fields: ['id', 'title'],
            key: { kind: 'parameter', name: 'noteId' },
            scope: 'owner',
            lock: 'update'
          },
          {
            id: 'rename',
            kind: 'data.mutate',
            operation: 'update',
            entityId: 'notes',
            record: 'note',
            values: [{ field: 'title', value: { kind: 'parameter', name: 'title' } }],
            resultName: 'renamed',
            fields: ['id', 'title']
          }
        ],
        return: { resultName: 'renamed', fields: ['id', 'title'] }
      }
    ]
  }
  return application
}

export interface RuntimeCommandQuery {
  text: string
  values: unknown[]
}
export interface RuntimeCommandDatabase {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rowCount: number; rows: Record<string, unknown>[] }>
}
type RuntimeCommandRow = Record<string, string | number | boolean | null>
type RuntimeCommandPlan = ReturnType<typeof nestJSCommandPlan>

interface CommandInputRuntime {
  commandInput(parameters: readonly BackendCommandParameterIR[], body: unknown): RuntimeCommandRow
  commandRequestKey(request: { rawHeaders: string[]; headers: Record<string, unknown> }): string
  commandValue(
    value: BackendCommandValueSourceIR,
    input: RuntimeCommandRow,
    results: Map<string, RuntimeCommandRow>,
    subject: string
  ): unknown
}
interface CommandExecutionRuntime {
  executeCommand(
    client: RuntimeCommandDatabase,
    plan: RuntimeCommandPlan,
    input: RuntimeCommandRow,
    subject: string
  ): Promise<RuntimeCommandRow>
}
interface CommandServiceRuntime {
  CommandService: new (database: {
    transaction<T>(operation: (client: RuntimeCommandDatabase) => Promise<T>): Promise<T>
  }) => {
    execute(
      plan: RuntimeCommandPlan,
      principal: { subject: string; roles: string[] } | null,
      key: string,
      body: unknown
    ): Promise<RuntimeCommandRow>
  }
}

/** Only Nest decorators/exceptions and the DI shell are substituted, not generated command logic. */
export async function commandRuntime(application = commandApplication()) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-command-runtime-'))
  const stub = `export class BadRequestException extends Error {}
export class ConflictException extends Error {}
export class ForbiddenException extends Error {}
export class NotFoundException extends Error {}
export class UnauthorizedException extends Error {}
export class ServiceUnavailableException extends Error {}
export const Injectable = () => (target) => target
export const SetMetadata = () => () => undefined
`
  await writeFile(join(directory, 'nest.ts'), stub)
  await writeFile(join(directory, 'database.service.ts'), 'export class DatabaseService {}\n')
  for (const artifact of [
    ...emitNestJSCommands(application),
    ...emitAuthenticationArtifacts(application)
  ]) {
    const filename = artifact.path.split('/').at(-1)
    if (
      !filename ||
      ![
        'command-types.ts',
        'command-input.ts',
        'command-execution.ts',
        'command.service.ts',
        'identity.ts'
      ].includes(filename)
    )
      continue
    const source = String(artifact.content)
      .replaceAll("'@nestjs/common'", "'./nest.ts'")
      .replaceAll(/\.js'/gu, ".ts'")
    await writeFile(join(directory, filename), source)
  }
  const command = application.commands?.commands[0]
  if (!command) throw new Error('Missing command fixture.')
  return {
    plan: nestJSCommandPlan(application, command),
    input: (await import(
      pathToFileURL(join(directory, 'command-input.ts')).href
    )) as CommandInputRuntime,
    execution: (await import(
      pathToFileURL(join(directory, 'command-execution.ts')).href
    )) as CommandExecutionRuntime,
    service: (await import(
      pathToFileURL(join(directory, 'command.service.ts')).href
    )) as CommandServiceRuntime,
    dispose: () => rm(directory, { recursive: true, force: true })
  }
}

export function literal(value: number): BackendCommandLeafIR {
  return { kind: 'literal', value }
}
