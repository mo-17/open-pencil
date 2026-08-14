import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { serializeCodePenSidecarRequest } from '@open-pencil/compiler/codepen/sidecar-wire'

import { handleCodePenSidecarInput, readCodePenSidecarFrame } from '../src/index'
import { CODEPEN_SIDECAR_LIMITS, parseCodePenSidecarRequest } from '../src/protocol'

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..')
const SIDECAR_ENTRY = resolve(import.meta.dir, '../src/index.ts')

interface RequestFileFixture {
  path: string
  kind: string
  content: string
  extra?: boolean
}

interface RequestFixture {
  version: number
  requestId: string
  target: string
  packageName: string
  files: RequestFileFixture[]
  options: Record<string, unknown>
  extra?: boolean
}

function request(overrides: Partial<RequestFixture> = {}): RequestFixture {
  return {
    version: 1,
    requestId: 'protocol-1',
    target: 'react',
    packageName: 'protocol-demo',
    files: [
      { path: 'package.json', kind: 'text', content: '{"name":"protocol-demo"}' },
      { path: 'src/main.tsx', kind: 'text', content: 'document.body.dataset.ready = "yes"' }
    ],
    options: {},
    ...overrides
  }
}

describe('CodePen sidecar strict protocol', () => {
  test('rejects unknown request, file, and option fields', () => {
    expect(() => parseCodePenSidecarRequest(JSON.stringify(request({ extra: true })))).toThrow(
      'unsupported field'
    )
    const fileField = request()
    fileField.files[0].extra = true
    expect(() => parseCodePenSidecarRequest(JSON.stringify(fileField))).toThrow('unsupported field')
    expect(() =>
      parseCodePenSidecarRequest(JSON.stringify(request({ options: { token: 'forbidden' } })))
    ).toThrow('unsupported field')
  })

  test('rejects unsafe, duplicate, mismatched, and noncanonical binary inputs', () => {
    const unsafe = request()
    unsafe.files[1].path = '../secret.ts'
    expect(() => parseCodePenSidecarRequest(JSON.stringify(unsafe))).toThrow('normalized')

    const duplicate = request()
    duplicate.files.push({
      path: 'src/main.tsx',
      kind: 'text',
      content: ''
    })
    expect(() => parseCodePenSidecarRequest(JSON.stringify(duplicate))).toThrow('unique')
    expect(() =>
      parseCodePenSidecarRequest(JSON.stringify(request({ packageName: 'another-name' })))
    ).toThrow('does not match')

    const binary = request()
    binary.files[1] = {
      path: 'src/image.png',
      kind: 'base64',
      content: 'AA='
    }
    expect(() => parseCodePenSidecarRequest(JSON.stringify(binary))).toThrow('canonical base64')
  })

  test('bounds aggregate source bytes and never echoes rejected source text', async () => {
    const marker = 'DO_NOT_ECHO_THIS_SOURCE_MARKER'
    const oversized = request({
      files: [
        { path: 'package.json', kind: 'text', content: '{"name":"protocol-demo"}' },
        {
          path: 'src/main.tsx',
          kind: 'text',
          content: 'x'.repeat(CODEPEN_SIDECAR_LIMITS.maxTextFileBytes + 1)
        }
      ]
    })
    expect(() => parseCodePenSidecarRequest(JSON.stringify(oversized))).toThrow('byte limit')

    const invalid = JSON.stringify(request({ target: marker }))
    const response = await handleCodePenSidecarInput(invalid)
    expect(JSON.stringify(response)).not.toContain(marker)
  })

  test('finishes on the first newline while the input stream remains open', async () => {
    const framed = serializeCodePenSidecarRequest({
      requestId: 'stream-open',
      target: 'react',
      packageName: 'stream-demo',
      files: new Map([['package.json', '{"name":"stream-demo"}']])
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${framed}\n`))
      }
    })
    const result = await Promise.race([
      readCodePenSidecarFrame(stream),
      Bun.sleep(250).then(() => 'timed-out')
    ])
    expect(result).toBe(framed)
  })

  test('rejects CRLF and a second frame in the same chunk', async () => {
    const stream = (value: string) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(value))
          controller.close()
        }
      })
    const rejectionMessage = async (promise: Promise<unknown>): Promise<string> => {
      try {
        await promise
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
      throw new Error('Expected the frame read to reject')
    }
    expect(await rejectionMessage(readCodePenSidecarFrame(stream('{}\r\n')))).toContain('Carriage')
    expect(await rejectionMessage(readCodePenSidecarFrame(stream('{}\n{}\n')))).toContain(
      'Only one'
    )
  })

  test('rejects process arguments with one structured stdout line', async () => {
    const child = Bun.spawn([process.execPath, SIDECAR_ENTRY, '--forbidden'], {
      cwd: REPOSITORY_ROOT,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    expect(exitCode).toBe(2)
    expect(stdout.split('\n')).toHaveLength(2)
    expect(JSON.parse(stdout).error.code).toBe('arguments-forbidden')
    expect(stderr).toBe('')
  })

  test('real process exits after one frame without the parent closing stdin', async () => {
    const requestJSON = serializeCodePenSidecarRequest({
      requestId: 'real-open-stdin',
      target: 'react',
      packageName: 'real-open-stdin',
      files: new Map([
        ['package.json', '{"name":"real-open-stdin"}'],
        ['src/main.tsx', `document.body.dataset.ready = 'yes'`]
      ])
    })
    const child = Bun.spawn([process.execPath, SIDECAR_ENTRY], {
      cwd: REPOSITORY_ROOT,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    })
    await child.stdin.write(`${requestJSON}\n`)
    await child.stdin.flush()
    const outcome = await Promise.race([
      child.exited.then((exitCode) => ({ kind: 'exit' as const, exitCode })),
      Bun.sleep(2_000).then(() => ({ kind: 'timeout' as const }))
    ])
    if (outcome.kind === 'timeout') {
      child.kill()
      throw new Error('Sidecar waited for stdin EOF after its first request frame')
    }
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    expect(outcome.exitCode).toBe(0)
    expect(stdout.split('\n')).toHaveLength(2)
    expect(JSON.parse(stdout).requestId).toBe('real-open-stdin')
    expect(stderr).toBe('')
  }, 5_000)
})
