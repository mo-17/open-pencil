// Run in an isolated Bun process so the native module mock cannot leak to other tests.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'

const connection = {
  previewPort: 5188,
  apiPort: 3019,
  apiBasePath: '/api',
  applicationId: 'notes',
  applicationDigest: 'A'.repeat(43)
}
function channel() {
  const target = new EventTarget()
  return {
    on: (name: string, listener: (data: unknown) => void) =>
      target.addEventListener(name, (event) => {
        if (event instanceof CustomEvent) listener(event.detail)
      }),
    emit: (name: string, data: unknown) =>
      target.dispatchEvent(new CustomEvent(name, { detail: data }))
  }
}
const stdout = channel()
const stderr = channel()
const events = channel()
let killCalls = 0
let markWritten!: () => void
const written = new Promise<void>((resolve) => {
  markWritten = resolve
})
const child = {
  write: async (message: string) => {
    if ((JSON.parse(message) as { type: string }).type === 'update') markWritten()
    // Deliberately never acknowledge this update.
  },
  kill: async () => {
    killCalls += 1
    events.emit('close', { code: null })
  }
}
mock.module('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: (_name: string, args: string[]) => {
      assert.equal(args.at(-2), '--local-backend')
      assert.deepEqual(JSON.parse(args.at(-1) ?? ''), connection)
      return {
        stdout,
        stderr,
        on: (name: string, listener: (...args: unknown[]) => void) => events.on(name, listener),
        spawn: async () => {
          stdout.emit(
            'data',
            JSON.stringify({ type: 'ready', url: 'http://127.0.0.1:5188/', port: 5188 }) + '\n'
          )
          return child
        }
      }
    }
  }
}))
Reflect.set(globalThis, '__OPENPENCIL_PROJECT_ROOT__', process.cwd())
const { startTauriPreviewSidecar } = await import('@/app/lowcode/preview-pane/host/tauri-sidecar')
const sidecar = await startTauriPreviewSidecar('react', connection)
const update = sidecar.update(new Map([['index.html', '<main>test</main>']]))
const rejected = update.then(
  () => false,
  () => true
)
await written
const disposed = sidecar.dispose()
assert.equal(killCalls, 1, 'Disconnect must kill before waiting for a hung update acknowledgement')
await disposed
assert.equal(await rejected, true)
assert.equal(sidecar.isAlive(), false)
assert.equal(killCalls, 1)
process.stdout.write('immediate-disconnect-passed\n')
