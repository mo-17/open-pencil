// A per-invocation native adapter keeps lifecycle tests independent of the module registry.
import assert from 'node:assert/strict'

import * as v from 'valibot'

import type { CreatePreviewNativeCommand } from '@/app/lowcode/preview-pane/host/native-command'

export async function verifyImmediateDisconnect(): Promise<void> {
  const connection = {
    previewPort: 5188,
    apiPort: 3019,
    apiBasePath: '/api',
    applicationId: 'notes',
    applicationDigest: 'A'.repeat(43)
  }
  function channel<Events>() {
    const target = new EventTarget()
    return {
      on<Key extends keyof Events>(name: Key, listener: (data: Events[Key]) => void) {
        target.addEventListener(String(name), (event) => {
          if (event instanceof CustomEvent) listener(event.detail as Events[Key])
        })
      },
      emit<Key extends keyof Events>(name: Key, data: Events[Key]) {
        target.dispatchEvent(new CustomEvent(String(name), { detail: data }))
      }
    }
  }
  const stdout = channel<{ data: string }>()
  const stderr = channel<{ data: string }>()
  const events = channel<{ close: { code: number | null }; error: string }>()
  let killCalls = 0
  const { promise: written, resolve: markWritten } = Promise.withResolvers<undefined>()
  const child = {
    write: async (message: string) => {
      if (
        v.parse(v.pipe(v.string(), v.parseJson(), v.looseObject({ type: v.string() })), message)
          .type === 'update'
      )
        markWritten(undefined)
      // Deliberately never acknowledge this update.
    },
    kill: async () => {
      killCalls += 1
      events.emit('close', { code: null })
    }
  }
  const createCommand: CreatePreviewNativeCommand = (_name, args) => {
    assert.equal(args.at(-2), '--local-backend')
    assert.deepEqual(JSON.parse(args.at(-1) ?? ''), connection)
    return {
      stdout,
      stderr,
      on: events.on,
      spawn: async () => {
        stdout.emit(
          'data',
          JSON.stringify({ type: 'ready', url: 'http://127.0.0.1:5188/', port: 5188 }) + '\n'
        )
        return child
      }
    }
  }
  const { startTauriPreviewSidecar } = await import('@/app/lowcode/preview-pane/host/tauri-sidecar')
  const sidecar = await startTauriPreviewSidecar('react', connection, createCommand, process.cwd())
  const update = sidecar.update(new Map([['index.html', '<main>test</main>']]))
  const rejected = update.then(
    () => false,
    () => true
  )
  await written
  const disposed = sidecar.dispose()
  assert.equal(
    killCalls,
    1,
    'Disconnect must kill before waiting for a hung update acknowledgement'
  )
  await disposed
  assert.equal(await rejected, true)
  assert.equal(sidecar.isAlive(), false)
  assert.equal(killCalls, 1)
}

if (import.meta.main) {
  await verifyImmediateDisconnect()
  process.stdout.write('immediate-disconnect-passed\n')
}
