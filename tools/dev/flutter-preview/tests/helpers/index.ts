import { randomUUID } from 'node:crypto'

import { FlutterPreviewController } from '#flutter-preview/controller'
import type { FlutterProject, GeneratedFiles } from '#flutter-preview/owned-project'
import type { FlutterChild, FlutterSpawn } from '#flutter-preview/process'
import type { FlutterSDK } from '#flutter-preview/sdk'

import {
  captureFlutterPreviewSnapshot,
  type FlutterPreviewCommand,
  type FlutterPreviewEvent
} from '@open-pencil/compiler/flutter-preview'
import { SceneGraph } from '@open-pencil/scene-graph'

export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred was not initialized')
  }
  let reject: (error: Error) => void = () => {
    throw new Error('Deferred was not initialized')
  }
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

export class InputQueue implements AsyncIterable<string> {
  private chunks: string[] = []
  private ended = false
  private wake = deferred<undefined>()
  push(value: string): void {
    this.chunks.push(value)
    this.wake.resolve(undefined)
  }
  end(): void {
    this.ended = true
    this.wake.resolve(undefined)
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (!this.ended || this.chunks.length) {
      const value = this.chunks.shift()
      if (value !== undefined) {
        yield value
        continue
      }
      this.wake = deferred<undefined>()
      await this.wake.promise
    }
  }
}

export class FakeChild implements FlutterChild {
  readonly stdout = new InputQueue()
  readonly stderr = new InputQueue()
  private readonly done = deferred<{ code: number | null }>()
  readonly completed = this.done.promise
  readonly writes: Array<Record<string, unknown>> = []
  stops = 0
  onWrite: (request: Record<string, unknown>) => Promise<void> = async () => undefined
  write(value: string): Promise<void> {
    const input: unknown = JSON.parse(value)
    if (!Array.isArray(input) || typeof input[0] !== 'object' || input[0] === null)
      throw new Error('Expected machine request')
    const request: Record<string, unknown> = input[0]
    this.writes.push(request)
    return this.onWrite(request)
  }
  finish(code = 0): void {
    this.stdout.end()
    this.stderr.end()
    this.done.resolve({ code })
  }
  stop(): Promise<void> {
    this.stops++
    this.finish()
    return Promise.resolve()
  }
  events(entries: readonly unknown[]): void {
    this.stdout.push(`${JSON.stringify(entries)}\n`)
  }
  ready(directory = '/owned/session', deviceId = 'booted-ios'): void {
    this.events([
      { event: 'app.start', params: { appId: 'owned-app', directory, deviceId } },
      { event: 'app.started', params: { appId: 'owned-app' } }
    ])
  }
  acknowledge(request: Record<string, unknown>, code = 0): void {
    this.events([{ id: request.id, result: { code } }])
  }
}

export const testSDK: FlutterSDK = {
  executable: '/cached/sdk/bin/flutter',
  directory: '/cached/sdk',
  environment: { PATH: '/cached/bin' }
}
export const pubspec =
  'name: openpencil_flutter_preview\ndependencies:\n  flutter:\n    sdk: flutter\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n'
export function generated(source = 'initial'): Map<string, string> {
  return new Map([
    ['pubspec.yaml', pubspec],
    ['lib/main.dart', source]
  ])
}

export class FakeProject implements FlutterProject {
  readonly sessionId = randomUUID()
  readonly directory = '/owned/session'
  files: GeneratedFiles = new Map()
  writes = 0
  logs = new Map<string, string>()
  platform = new Map<string, string>()
  async write(files: GeneratedFiles, expected?: GeneratedFiles): Promise<void> {
    if (expected)
      for (const [path, content] of expected) {
        if (this.files.get(path) !== content) throw new Error('Unexpected generated source changed')
      }
    this.files = new Map(files)
    this.writes++
  }
  async log(name: string, content: string): Promise<void> {
    this.logs.set(name, content)
  }
  async readPlatform(path: string): Promise<string> {
    const value = this.platform.get(path)
    if (value === undefined) throw new Error('Missing platform fixture')
    return value
  }
  async writePlatform(path: string, content: string): Promise<void> {
    this.platform.set(path, content)
  }
}

export function snapshot(title = 'initial') {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('SceneGraph requires a page')
  graph.updateNode(page.id, { name: title })
  return captureFlutterPreviewSnapshot(graph, [page.id])
}
export function startCommand(revision = 1, deviceId = 'booted-ios'): FlutterPreviewCommand {
  return {
    version: 1,
    type: 'command',
    id: randomUUID(),
    command: 'start',
    revision,
    deviceId,
    snapshot: snapshot()
  }
}
export function updateCommand(revision = 2): FlutterPreviewCommand {
  return {
    version: 1,
    type: 'command',
    id: randomUUID(),
    command: 'update',
    revision,
    snapshot: snapshot('edited')
  }
}
export async function tick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

export function controllerFixture(
  options: {
    hangingCreate?: boolean
    missingCache?: boolean
    android?: boolean
    reloadCode?: number
  } = {}
) {
  const events: FlutterPreviewEvent[] = []
  const calls: Array<{ args: readonly string[]; cwd: string; child: FakeChild }> = []
  const project = new FakeProject()
  const run = new FakeChild()
  let androidPreparations = 0
  const spawn: FlutterSpawn = (_executable, args, spawnOptions) => {
    const child = args.includes('run') ? run : new FakeChild()
    calls.push({ args, cwd: spawnOptions.cwd, child })
    if (args.includes('devices')) {
      child.stdout.push(
        JSON.stringify([
          {
            id: 'booted-ios',
            name: 'Booted phone',
            emulator: true,
            targetPlatform: options.android ? 'android-arm64' : 'ios'
          }
        ])
      )
      child.finish()
    } else if (args.includes('run')) {
      child.onWrite = async (request) => {
        child.acknowledge(request, options.reloadCode ?? 0)
      }
      child.ready(project.directory)
    } else if (!args.includes('create') || !options.hangingCreate) child.finish()
    return child
  }
  let compileCount = 0
  const controller = new FlutterPreviewController({
    onEvent: (event) => events.push(event),
    spawn,
    resolveSDK: async () => testSDK,
    ensureCache: async () => {
      if (options.missingCache) throw new Error('Missing cache')
    },
    createProject: async () => project,
    prepareAndroid: async () => {
      androidPreparations++
    },
    compile: () => ({ files: generated(compileCount++ ? 'edited' : 'initial'), warnings: [] }),
    timeouts: { commandMs: 200, startMs: 500, reloadMs: 100 }
  })
  return { controller, events, calls, project, run, androidPreparations: () => androidPreparations }
}
