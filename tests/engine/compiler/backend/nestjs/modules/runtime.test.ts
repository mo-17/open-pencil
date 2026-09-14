import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { emitNestJSModules } from '#compiler/backend/nestjs/modules'

import { commandApplication, commandRuntime, COMMAND_SUBJECT } from '../commands/helpers'

test('module dispatch rejects foreign/prototype command IDs before touching the shared kernel and preserves authentication', async () => {
  const app = commandApplication()
  app.modules = {
    version: 1,
    modules: [
      {
        id: 'notes',
        name: 'Notes',
        entityIds: ['notes'],
        resourceIds: (app.httpApi?.resources ?? []).map((resource) => resource.id),
        commandIds: ['rename-note'],
        dependsOn: []
      }
    ]
  }
  const loaded = await commandRuntime(app)
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-module-dispatch-'))
  try {
    await writeFile(
      join(directory, 'nest.ts'),
      'export class ForbiddenException extends Error {}\nexport const Injectable = () => (target) => target\n'
    )
    await writeFile(join(directory, 'kernel.ts'), 'export class CommandService {}\n')
    for (const artifact of emitNestJSModules(app)) {
      const name = artifact.path.split('/').at(-1)
      if (name !== 'command-plans.ts' && name !== 'commands.service.ts') continue
      await writeFile(
        join(directory, name),
        String(artifact.content)
          .replace("'@nestjs/common'", "'./nest.ts'")
          .replace("'../../command.service.js'", "'./kernel.ts'")
          .replaceAll(/\.js'/gu, ".ts'")
      )
    }
    interface Dispatcher {
      execute(
        id: string,
        principal: { subject: string; roles: string[] } | null,
        key: string,
        body: unknown
      ): Promise<unknown>
    }
    const runtime = (await import(pathToFileURL(join(directory, 'commands.service.ts')).href)) as {
      BusinessModule0Service: new (kernel: unknown) => Dispatcher
    }
    let databaseCalls = 0
    const kernel = new loaded.service.CommandService({
      transaction: async () => {
        databaseCalls++
        throw new Error('Unexpected database access')
      }
    })
    const service = new runtime.BusinessModule0Service(kernel)
    for (const id of ['foreign-command', '__proto__', 'constructor', 'toString'])
      expect(() =>
        service.execute(id, { subject: COMMAND_SUBJECT, roles: [] }, 'request-key-00000001', {})
      ).toThrow('Access denied')
    await expect(service.execute('rename-note', null, 'request-key-00000001', {})).rejects.toThrow(
      'Authentication required'
    )
    expect(databaseCalls).toBe(0)
  } finally {
    await loaded.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
