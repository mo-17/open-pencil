import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dir, '../../../../..')
const READ_MODULE_URL = pathToFileURL(
  resolve(ROOT, 'packages/core/src/io/formats/fig/read.ts')
).href

test('FIG workers obey a bounded dynamic global concurrency gate', async () => {
  const script = `
    import { strict as assert } from 'node:assert'

    globalThis.window = {}
    const NativeWorker = globalThis.Worker
    const {
      figParseWorkerConcurrencyForDeviceMemory,
      figParseWorkerQueueState,
      parseFigFile,
      setFigParseWorkerConcurrency
    } = await import(${JSON.stringify(READ_MODULE_URL)})

    assert.equal(figParseWorkerConcurrencyForDeviceMemory(undefined), 1)
    assert.equal(figParseWorkerConcurrencyForDeviceMemory(null), 1)
    assert.equal(figParseWorkerConcurrencyForDeviceMemory(8), 1)
    assert.equal(figParseWorkerConcurrencyForDeviceMemory(16), 2)
    assert.equal(figParseWorkerConcurrencyForDeviceMemory(Number.POSITIVE_INFINITY), 1)

    const workers = []
    class ControlledWorker {
      onmessage = null
      onmessageerror = null
      onerror = null
      terminated = false

      constructor() {
        workers.push(this)
      }

      postMessage(message, transfer) {
        structuredClone(message, { transfer })
      }

      fail() {
        this.onerror?.({ message: 'controlled worker failure' })
      }

      terminate() {
        this.terminated = true
      }
    }

    globalThis.Worker = ControlledWorker
    setFigParseWorkerConcurrency(1)
    const first = parseFigFile(new ArrayBuffer(8)).catch((error) => error)
    const second = parseFigFile(new ArrayBuffer(8)).catch((error) => error)

    assert.equal(workers.length, 1)
    assert.deepEqual(figParseWorkerQueueState(), { concurrency: 1, active: 1, pending: 1 })

    setFigParseWorkerConcurrency(2)
    assert.equal(workers.length, 2)
    assert.deepEqual(figParseWorkerQueueState(), { concurrency: 2, active: 2, pending: 0 })

    setFigParseWorkerConcurrency(1)
    const third = parseFigFile(new ArrayBuffer(8)).catch((error) => error)
    assert.equal(workers.length, 2)
    assert.equal(workers[0].terminated, false)
    assert.equal(workers[1].terminated, false)
    assert.deepEqual(figParseWorkerQueueState(), { concurrency: 1, active: 2, pending: 1 })

    workers[0].fail()
    assert.match((await first).message, /input buffer was transferred/)
    assert.equal(workers.length, 2)
    assert.equal(workers[0].terminated, true)
    assert.equal(workers[1].terminated, false)
    assert.deepEqual(figParseWorkerQueueState(), { concurrency: 1, active: 1, pending: 1 })

    workers[1].fail()
    assert.match((await second).message, /input buffer was transferred/)
    assert.equal(workers.length, 3)
    assert.equal(workers[2].terminated, false)
    assert.deepEqual(figParseWorkerQueueState(), { concurrency: 1, active: 1, pending: 0 })

    workers[2].fail()
    assert.match((await third).message, /input buffer was transferred/)
    assert.equal(workers[2].terminated, true)
    assert.deepEqual(figParseWorkerQueueState(), { concurrency: 1, active: 0, pending: 0 })

    class ThrowingWorker {
      constructor() {
        throw new Error('controlled constructor failure')
      }
    }
    globalThis.Worker = ThrowingWorker
    assert((await parseFigFile(new ArrayBuffer(8)).catch((error) => error)) instanceof Error)
    assert.deepEqual(figParseWorkerQueueState(), { concurrency: 1, active: 0, pending: 0 })

    setFigParseWorkerConcurrency(99)
    assert.equal(figParseWorkerQueueState().concurrency, 2)
    assert.throws(() => setFigParseWorkerConcurrency(0), RangeError)
    setFigParseWorkerConcurrency(1)
    globalThis.Worker = NativeWorker
  `

  const process = Bun.spawn([globalThis.process.execPath, '-e', script], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])

  expect(exitCode, [stdout, stderr].filter(Boolean).join('\n')).toBe(0)
}, 10_000)
