import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseFigFile } from '#core/io/formats/fig/read'

const ROOT = resolve(import.meta.dir, '../../../../..')
const READ_MODULE_URL = pathToFileURL(
  resolve(ROOT, 'packages/core/src/io/formats/fig/read.ts')
).href

describe('FIG parsing cancellation', () => {
  test('rejects before synchronous parsing when already aborted', async () => {
    const abort = new AbortController()
    abort.abort()

    await expect(parseFigFile(new ArrayBuffer(0), { signal: abort.signal })).rejects.toHaveProperty(
      'name',
      'AbortError'
    )
  })

  test('disposes an active first-page session exactly once when aborted', async () => {
    const script = `
      import { strict as assert } from 'node:assert'
      globalThis.window = {}
      const { parseFigFile } = await import(${JSON.stringify(READ_MODULE_URL)})
      let terminations = 0
      class PendingSessionWorker {
        onerror = null
        onmessageerror = null
        postMessage(message, transfer) {
          structuredClone(message, { transfer })
        }
        terminate() {
          terminations++
        }
      }
      globalThis.Worker = PendingSessionWorker
      const controller = new AbortController()
      const input = new ArrayBuffer(8)
      const pending = parseFigFile(input, {
        populate: 'first-page',
        signal: controller.signal,
        allowMainThreadFallback: false
      })
      controller.abort(new DOMException('session cancelled', 'AbortError'))
      await assert.rejects(pending, /session cancelled/)
      assert.equal(terminations, 1)
      assert.equal(input.byteLength, 0)
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
  })
})
