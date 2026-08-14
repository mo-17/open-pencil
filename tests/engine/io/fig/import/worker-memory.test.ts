import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { exportFigFile, initCodec, SceneGraph } from '@open-pencil/core'

const ROOT = resolve(import.meta.dir, '../../../../..')
const READ_MODULE_URL = pathToFileURL(
  resolve(ROOT, 'packages/core/src/io/formats/fig/read.ts')
).href

test('worker parsing transfers one input buffer and reloads only when fallback is needed', async () => {
  await initCodec()
  const fixture = await exportFigFile(new SceneGraph())
  const script = `
      import { strict as assert } from 'node:assert'
      import { Buffer } from 'node:buffer'

      globalThis.window = {}
      const NativeWorker = globalThis.Worker
      const { parseFigFile, readFigSource } = await import(${JSON.stringify(READ_MODULE_URL)})
      const fixtureBlob = new Blob([
        Buffer.from(${JSON.stringify(Buffer.from(fixture).toString('base64'))}, 'base64')
      ])

      // A raw ArrayBuffer is transferred directly without retaining a copy.
      const input = await fixtureBlob.arrayBuffer()
      let sliced = false
      Object.defineProperty(input, 'slice', {
        value() {
          sliced = true
          throw new Error('The worker path must not copy the input buffer')
        }
      })
      const workerGraph = await parseFigFile(input, { populate: 'first-page' })
      assert.equal(workerGraph.getPages().length, 1)
      assert.equal(sliced, false)
      assert.equal(input.byteLength, 0)

      // An exact Uint8Array view also transfers its backing buffer zero-copy.
      const exactBuffer = await fixtureBlob.arrayBuffer()
      const exactBytes = new Uint8Array(exactBuffer)
      let exactReads = 0
      const exactGraph = await readFigSource(
        {
          async read() {
            exactReads++
            return exactBytes
          }
        },
        { populate: 'first-page' }
      )
      assert.equal(exactGraph.getPages().length, 1)
      assert.equal(exactReads, 1)
      assert.equal(exactBuffer.byteLength, 0)

      // A subview must copy only its effective range, leaving the padded backing buffer intact.
      const fixtureBytes = new Uint8Array(await fixtureBlob.arrayBuffer())
      const padded = new Uint8Array(fixtureBytes.byteLength + 16)
      padded.fill(0x7f)
      padded.set(fixtureBytes, 8)
      const subview = padded.subarray(8, 8 + fixtureBytes.byteLength)
      const paddedBuffer = padded.buffer
      const subviewGraph = await readFigSource({ read: async () => subview }, { populate: 'first-page' })
      assert.equal(subviewGraph.getPages().length, 1)
      assert.notEqual(paddedBuffer.byteLength, 0)
      assert.equal(subview.byteLength, fixtureBytes.byteLength)

      // Node/Bun Buffer.slice() is also a view, so Buffer subviews need the same exact-range copy.
      const paddedNodeBuffer = Buffer.alloc(fixtureBytes.byteLength + 16, 0x7f)
      Buffer.from(fixtureBytes).copy(paddedNodeBuffer, 8)
      const bufferSubview = paddedNodeBuffer.subarray(8, 8 + fixtureBytes.byteLength)
      const bufferSubviewGraph = await readFigSource(
        { read: async () => bufferSubview },
        { populate: 'first-page' }
      )
      assert.equal(bufferSubviewGraph.getPages().length, 1)
      assert.equal(paddedNodeBuffer.byteLength, fixtureBytes.byteLength + 16)

      // SharedArrayBuffer cannot be transferred, so copy only the requested view.
      if (typeof SharedArrayBuffer !== 'undefined') {
        const shared = new SharedArrayBuffer(fixtureBytes.byteLength + 8)
        const sharedBytes = new Uint8Array(shared)
        sharedBytes.fill(0x7f)
        const sharedSubview = new Uint8Array(shared, 4, fixtureBytes.byteLength)
        sharedSubview.set(fixtureBytes)
        const sharedGraph = await readFigSource(
          { read: async () => sharedSubview },
          { populate: 'first-page' }
        )
        assert.equal(sharedGraph.getPages().length, 1)
        assert.equal(shared.byteLength, fixtureBytes.byteLength + 8)
      }

      // Deterministic parser failures come back with a phase and must not reread/retry.
      let parserErrorReads = 0
      let parserFailure
      try {
        await readFigSource({
          async read() {
            parserErrorReads++
            return new Uint8Array([1, 2, 3, 4])
          }
        })
      } catch (error) {
        parserFailure = error
      }
      assert(parserFailure instanceof Error)
      assert.equal(parserErrorReads, 1)
      assert.equal(parserFailure.name, 'DeterministicFigWorkerError')
      assert.equal(parserFailure.phase, 'parse')

      let afterTransferFailure = 'synthetic worker failure'
      class FailingAfterTransferWorker {
        onmessage = null
        onerror = null
        postMessage(message, transfer) {
          structuredClone(message, { transfer })
          queueMicrotask(() => this.onerror?.({ message: afterTransferFailure }))
        }
        terminate() {}
      }

      globalThis.Worker = FailingAfterTransferWorker
      let reads = 0
      const fallbackGraph = await readFigSource(
        {
          async read() {
            reads++
            return fixtureBlob.arrayBuffer()
          }
        },
        { populate: 'first-page' }
      )
      assert.equal(fallbackGraph.getPages().length, 1)
      assert.equal(reads, 2)

      let messageErrorTerminations = 0
      class MessageErrorWorker {
        onmessage = null
        onmessageerror = null
        onerror = null
        postMessage(message, transfer) {
          structuredClone(message, { transfer })
          queueMicrotask(() => this.onmessageerror?.({ data: undefined }))
        }
        terminate() {
          messageErrorTerminations++
        }
      }

      globalThis.Worker = MessageErrorWorker
      let messageErrorReads = 0
      const messageErrorFallbackGraph = await readFigSource(
        {
          async read() {
            messageErrorReads++
            return fixtureBlob.arrayBuffer()
          }
        },
        { populate: 'first-page' }
      )
      assert.equal(messageErrorFallbackGraph.getPages().length, 1)
      assert.equal(messageErrorReads, 2)
      assert.equal(messageErrorTerminations, 1)

      globalThis.Worker = FailingAfterTransferWorker
      const rawBuffer = await fixtureBlob.arrayBuffer()
      await assert.rejects(
        parseFigFile(rawBuffer, { populate: 'first-page' }),
        /input buffer was transferred/
      )

      class FailingBeforeTransferWorker {
        onmessage = null
        onerror = null
        postMessage() {
          throw new Error('synthetic pre-transfer failure')
        }
        terminate() {}
      }

      globalThis.Worker = FailingBeforeTransferWorker
      let preTransferReads = 0
      let reusableBuffer
      const preTransferFallbackGraph = await readFigSource(
        {
          async read() {
            preTransferReads++
            reusableBuffer = await fixtureBlob.arrayBuffer()
            return reusableBuffer
          }
        },
        { populate: 'first-page' }
      )
      assert.equal(preTransferFallbackGraph.getPages().length, 1)
      assert.equal(preTransferReads, 1)
      assert.notEqual(reusableBuffer.byteLength, 0)

      globalThis.Worker = FailingAfterTransferWorker
      afterTransferFailure = 'synthetic worker failure'
      let reloadReads = 0
      let reloadFailure
      try {
        await readFigSource(
          {
            async read() {
              reloadReads++
              if (reloadReads === 1) return fixtureBlob.arrayBuffer()
              throw new Error('synthetic reload failure')
            }
          },
          { populate: 'first-page' }
        )
      } catch (error) {
        reloadFailure = error
      }
      assert(reloadFailure instanceof Error)
      assert.equal(reloadReads, 2)
      assert.match(reloadFailure.message, /synthetic worker failure/)
      assert.match(reloadFailure.message, /synthetic reload failure/)
      assert(reloadFailure.cause instanceof AggregateError)
      assert.deepEqual(
        reloadFailure.cause.errors.map((error) => error.message),
        ['synthetic worker failure', 'synthetic reload failure']
      )

      afterTransferFailure = 'Out of memory while parsing .fig'
      let oomReads = 0
      let oomFailure
      try {
        await readFigSource(
          {
            async read() {
              oomReads++
              return fixtureBlob.arrayBuffer()
            }
          },
          { populate: 'first-page' }
        )
      } catch (error) {
        oomFailure = error
      }
      assert(oomFailure instanceof Error)
      assert.equal(oomReads, 1)
      assert.match(oomFailure.message, /Out of memory/)
      assert.match(oomFailure.message, /fallback was skipped/)
      assert.equal(oomFailure.cause?.message, 'Out of memory while parsing .fig')

      // Untrusted remote input never retries on the main thread after a worker failure.
      globalThis.Worker = FailingAfterTransferWorker
      afterTransferFailure = 'synthetic untrusted worker failure'
      let untrustedReads = 0
      await assert.rejects(
        readFigSource(
          {
            async read() {
              untrustedReads++
              return fixtureBlob.arrayBuffer()
            }
          },
          { populate: 'all', allowMainThreadFallback: false }
        ),
        /fallback is disabled for untrusted/
      )
      assert.equal(untrustedReads, 1)

      // Aborting an active untrusted parse terminates its dedicated worker.
      let abortTerminations = 0
      class PendingWorker {
        onmessage = null
        onmessageerror = null
        onerror = null
        postMessage(message, transfer) {
          structuredClone(message, { transfer })
        }
        terminate() {
          abortTerminations++
        }
      }
      globalThis.Worker = PendingWorker
      const controller = new AbortController()
      const pending = readFigSource(
        { read: () => fixtureBlob.arrayBuffer() },
        {
          populate: 'all',
          signal: controller.signal,
          allowMainThreadFallback: false
        }
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      controller.abort(new DOMException('remote parse cancelled', 'AbortError'))
      await assert.rejects(pending, /remote parse cancelled/)
      assert.equal(abortTerminations, 1)

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
}, 20_000)
