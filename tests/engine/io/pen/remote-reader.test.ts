import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'

import { repoPath } from '#tests/helpers/paths'

const registry = new IORegistry(BUILTIN_IO_FORMATS)
const FIXTURE_PATH = repoPath('tests/fixtures/pencil_button.pen')
const ROOT = resolve(import.meta.dir, '../../../..')
const PEN_READ_MODULE_URL = pathToFileURL(
  resolve(ROOT, 'packages/core/src/io/formats/pen/read.ts')
).href

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function penSource(children: unknown[]): Uint8Array {
  return bytes(JSON.stringify({ version: '2.14', children }))
}

describe('untrusted .pen IO reader', () => {
  test('decodes a real fixture in a dedicated Worker and preserves the caller bytes', async () => {
    const input = new Uint8Array(await Bun.file(FIXTURE_PATH).arrayBuffer())
    const originalLength = input.byteLength
    const controller = new AbortController()

    const result = await registry.readDocumentAs(
      'pen',
      { name: 'remote-library.pen', mimeType: 'application/json', data: input },
      { signal: controller.signal }
    )

    expect(input.byteLength).toBe(originalLength)
    expect(result.sourceFormat).toBe('pen')
    expect([...result.graph.getAllNodes()].some((node) => node.type === 'COMPONENT')).toBe(true)
  })

  test('uses fatal UTF-8 for untrusted bytes while preserving legacy local decoding', async () => {
    const prefix = bytes('{"version":"2.14","children":[{"id":"label","type":"text","content":"')
    const suffix = bytes('"}]}')
    const invalid = new Uint8Array(prefix.byteLength + 2 + suffix.byteLength)
    invalid.set(prefix)
    invalid.set([0xc3, 0x28], prefix.byteLength)
    invalid.set(suffix, prefix.byteLength + 2)

    const local = await registry.readDocument({
      name: 'local.pen',
      mimeType: 'application/json',
      data: invalid
    })
    expect(local.graph.getNode('label')?.text).toContain('\ufffd')

    await expect(
      registry.readDocumentAs(
        'pen',
        { name: 'remote.pen', mimeType: 'application/json', data: invalid },
        { signal: new AbortController().signal }
      )
    ).rejects.toThrow('valid UTF-8')
  })

  test('enforces byte and structural quotas before returning a graph', async () => {
    const input = penSource([
      { id: 'first', type: 'frame' },
      { id: 'second', type: 'frame' }
    ])

    await expect(
      registry.readDocumentAs(
        'pen',
        { name: 'remote.pen', mimeType: 'application/json', data: input },
        { penLimits: { maxBytes: input.byteLength - 1 } }
      )
    ).rejects.toThrow('source bytes')
    await expect(
      registry.readDocumentAs(
        'pen',
        { name: 'remote.pen', mimeType: 'application/json', data: input },
        { penLimits: { maxNodes: 1 } }
      )
    ).rejects.toThrow('authored nodes')
  })

  test('pre-abort, active abort, and timeout terminate or avoid the dedicated Worker', async () => {
    const script = `
      import { strict as assert } from 'node:assert'

      const NativeWorker = globalThis.Worker
      const NativeWindow = globalThis.window
      globalThis.window = {}
      let constructions = 0
      let terminations = 0
      let posts = 0
      class PendingWorker {
        onmessage = null
        onmessageerror = null
        onerror = null
        constructor() {
          constructions++
        }
        postMessage(message, transfer) {
          posts++
          structuredClone(message, { transfer })
        }
        terminate() {
          terminations++
        }
      }
      globalThis.Worker = PendingWorker
      const { readPenDocument } = await import(${JSON.stringify(PEN_READ_MODULE_URL)})
      const input = new TextEncoder().encode(JSON.stringify({
        version: '2.14',
        children: [{ id: 'component', type: 'frame', reusable: true }]
      }))

      const preAborted = new AbortController()
      preAborted.abort(new DOMException('pre-aborted pen parse', 'AbortError'))
      await assert.rejects(
        readPenDocument(input, { signal: preAborted.signal }),
        /pre-aborted pen parse/
      )
      assert.equal(constructions, 0)

      const controller = new AbortController()
      const active = readPenDocument(input, { signal: controller.signal })
      await Promise.resolve()
      controller.abort(new DOMException('active pen parse cancelled', 'AbortError'))
      await assert.rejects(active, /active pen parse cancelled/)
      assert.equal(constructions, 1)
      assert.equal(posts, 1)
      assert.equal(terminations, 1)

      await assert.rejects(
        readPenDocument(input, { signal: AbortSignal.timeout(5) }),
        (error) => error instanceof Error && error.name === 'TimeoutError'
      )
      assert.equal(constructions, 2)
      assert.equal(posts, 2)
      assert.equal(terminations, 2)

      globalThis.Worker = undefined
      await assert.rejects(
        readPenDocument(input, {
          limits: { maxNodes: 10 },
          allowMainThreadFallback: true
        }),
        /dedicated Worker is required/
      )
      globalThis.Worker = NativeWorker
      globalThis.window = NativeWindow
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

  test('explicit non-browser fallback skips an ambient Worker and remains bounded', async () => {
    const script = `
      import { strict as assert } from 'node:assert'

      let constructions = 0
      class UnexpectedWorker {
        constructor() {
          constructions++
          throw new Error('ambient Worker must not be used')
        }
      }
      globalThis.Worker = UnexpectedWorker
      const { readPenDocument } = await import(${JSON.stringify(PEN_READ_MODULE_URL)})
      const input = new TextEncoder().encode(JSON.stringify({
        version: '2.14',
        children: [{ id: 'component', type: 'frame', reusable: true }]
      }))

      const graph = await readPenDocument(input, {
        limits: { maxNodes: 10 },
        allowMainThreadFallback: true
      })
      assert.ok(graph.getNode('component'))
      assert.equal(constructions, 0)
      await assert.rejects(
        readPenDocument(input, {
          limits: { maxNodes: 0 },
          allowMainThreadFallback: true
        }),
        /positive safe integer/
      )
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
