import { mock } from 'bun:test'
import assert from 'node:assert/strict'

const sessionId = 'c8f08a42-c2b8-4b7c-89dd-43bd648acf2f'
const lifecycle: string[] = []
let stdout = (_chunk: string): void => undefined
let stderr = (_chunk: string): void => undefined
let closed = (): void => undefined
let errored = (): void => undefined
const state = {
  sessionId,
  phase: 'empty',
  initialized: false,
  applicationId: null,
  applicationDigest: null,
  connection: null,
  plan: null
}
Object.assign(globalThis, { __OPENPENCIL_PROJECT_ROOT__: '/reviewed/project' })
mock.module('@tauri-apps/plugin-shell', () => ({
  Command: {
    create(program: string, args: string[], options: { cwd: string }) {
      assert.equal(program, 'lowcode-preview')
      assert.deepEqual(args, [
        'packages/compiler/src/managed-preview/cli.ts',
        '--session',
        sessionId
      ])
      assert.equal(options.cwd, '/reviewed/project')
      return {
        stdout: {
          on(_event: string, callback: typeof stdout) {
            stdout = callback
          }
        },
        stderr: {
          on(_event: string, callback: typeof stderr) {
            stderr = callback
          }
        },
        on(event: string, callback: () => void) {
          if (event === 'close') closed = callback
          else errored = callback
        },
        async spawn() {
          queueMicrotask(() =>
            stdout(JSON.stringify({ version: 1, type: 'ready', sessionId }) + '\n')
          )
          return {
            async write(line: string) {
              const command = JSON.parse(line)
              lifecycle.push(command.command)
              if (command.command === 'close') {
                lifecycle.push('api-cleaned')
                closed()
              } else if (command.command === 'status') {
                const event =
                  JSON.stringify({ version: 1, type: 'result', id: command.id, state }) + '\n'
                stdout(event.slice(0, 20))
                stdout(event.slice(20))
              }
            },
            async kill() {
              lifecycle.push('kill')
            }
          }
        }
      }
    }
  }
}))

const { startManagedPreviewProcess } =
  await import('@/app/lowcode/preview-pane/managed-backend/process')
const events: unknown[] = []
const terminals: string[] = []
const child = await startManagedPreviewProcess(sessionId, {
  onEvent: (event) => events.push(event),
  onTerminal: (message) => terminals.push(message)
})
assert.deepEqual(await child.request({ version: 1, id: 'status_1', command: 'status' }), state)
const pending = child.request({ version: 1, id: 'setup_1', command: 'start' })
void pending.catch(() => undefined)
child.cancelPending()
await assert.rejects(pending, /cancelled/u)
stdout(JSON.stringify({ version: 1, type: 'result', id: 'setup_1', state }) + '\n')
assert.equal(events.length, 1, 'cancelled responses must not publish')
stderr('a-secret-that-must-not-appear')
stdout('{invalid protocol}\n')
await child.close()
await child.close()
assert.deepEqual(lifecycle.slice(-3), ['close', 'api-cleaned', 'kill'])
assert.equal(lifecycle.filter((event) => event === 'close').length, 1)
assert.equal(terminals.length, 1)
assert.ok(!terminals[0].includes('a-secret'))
errored()
assert.equal(terminals.length, 1)
process.stdout.write('managed-process-lifetime-passed\n')
