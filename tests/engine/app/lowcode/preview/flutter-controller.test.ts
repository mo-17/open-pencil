import { afterEach, describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref, shallowRef } from 'vue'

import type {
  FlutterPreviewCommand,
  FlutterPreviewDevice,
  FlutterPreviewEvent,
  FlutterPreviewState
} from '@open-pencil/compiler/flutter-preview'
import { SceneGraph } from '@open-pencil/scene-graph'

import type { DocumentSaveStatus } from '@/app/document/io/save'
import type { PreviewRefreshPolicy } from '@/app/lowcode/preview-pane/compile-scheduler'
import { createFlutterNativePreview } from '@/app/lowcode/preview-pane/flutter-native/controller'
import type {
  FlutterNativeProcess,
  startFlutterNativeProcess
} from '@/app/lowcode/preview-pane/flutter-native/process'

import { applicationModeFixture } from '#tests/helpers/compiler/application-mode/fixture'

type Result = Extract<FlutterPreviewEvent, { type: 'result' }>
const SESSION = '10000000-0000-4000-8000-000000000001'
const OTHER_SESSION = '10000000-0000-4000-8000-000000000002'
const DEVICES: FlutterPreviewDevice[] = [
  { id: 'booted-ios', name: 'Booted iOS', platform: 'ios' },
  { id: 'attached-android', name: 'Attached Android', platform: 'android' }
]
const IDLE: FlutterPreviewState = {
  sessionId: null,
  phase: 'idle',
  deviceId: null,
  revision: null,
  projectDirectory: null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function saved(): DocumentSaveStatus {
  return { phase: 'saved', destination: 'file', updatedAt: '2026-10-01T12:00:00.000Z' }
}

function scene(text = 'Initial') {
  const graph = new SceneGraph()
  const page = graph.addPage('Preview')
  graph.createNode('TEXT', page.id, { id: 'preview-text', text, width: 100, height: 30 })
  return graph
}

function transport(
  onEvent: (event: FlutterPreviewEvent) => void,
  onTerminal: (message: string) => void
) {
  const requests: Array<{
    command: FlutterPreviewCommand
    response: ReturnType<typeof deferred<Result>>
  }> = []
  const opening = deferred<FlutterNativeProcess>()
  let closing: ReturnType<typeof deferred<undefined>> | undefined
  let closes = 0
  const process: FlutterNativeProcess = {
    request(command) {
      const response = deferred<Result>()
      requests.push({ command, response })
      return response.promise
    },
    async close() {
      ++closes
      await closing?.promise
    }
  }
  return {
    process,
    requests,
    opening,
    open: () => opening.resolve(process),
    closes: () => closes,
    delayClose() {
      closing = deferred<undefined>()
      return closing
    },
    progress: (message: string) => onEvent({ version: 1, type: 'progress', id: null, message }),
    terminal: onTerminal,
    release() {
      opening.resolve(process)
      closing?.resolve(undefined)
      for (const request of requests) request.response.reject(new Error('Fixture disposed'))
    }
  }
}

const fixtures: Array<{
  scope: ReturnType<typeof effectScope>
  processes: Array<ReturnType<typeof transport>>
}> = []

function fixture(policy: PreviewRefreshPolicy = 'manual', delayOpen = false, desktop = true) {
  const scope = effectScope()
  const graph = shallowRef(scene())
  const currentPage = ref<string>()
  const version = ref(0)
  const status = shallowRef<DocumentSaveStatus>(saved())
  const mode = ref<PreviewRefreshPolicy>(policy)
  const processes: Array<ReturnType<typeof transport>> = []
  const startProcess: typeof startFlutterNativeProcess = (onEvent, onTerminal) => {
    const owned = transport(onEvent, onTerminal)
    processes.push(owned)
    if (!delayOpen) owned.open()
    return owned.opening.promise
  }
  const source = {
    get graph() {
      return graph.value
    },
    get sceneVersion() {
      return version.value
    },
    get currentPageId() {
      return currentPage.value
    },
    getSaveStatus: () => status.value
  }
  const controller = scope.run(() =>
    createFlutterNativePreview(mode, source, { desktop, startProcess })
  )
  if (!controller) throw new Error('Flutter controller scope did not initialize')
  const result = {
    scope,
    graph,
    currentPage,
    version,
    status,
    mode,
    processes,
    controller,
    async edit(text: string) {
      graph.value.updateNode('preview-text', { text })
      ++version.value
      await nextTick()
    }
  }
  fixtures.push(result)
  return result
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.scope.stop()
    for (const owned of f.processes) owned.release()
  }
  await flush()
})

async function flush() {
  await nextTick()
  for (let i = 0; i < 8; ++i) await Promise.resolve()
}

function request(f: ReturnType<typeof fixture>, index: number, processIndex = 0) {
  const value = f.processes[processIndex]?.requests[index]
  if (!value) throw new Error(`Missing native request ${processIndex}:${index}`)
  return value
}

function ack(
  item: ReturnType<typeof request>,
  deviceId = DEVICES[0].id,
  changes: Partial<FlutterPreviewState> = {}
) {
  const command = item.command
  const state: FlutterPreviewState =
    command.command === 'devices'
      ? IDLE
      : {
          sessionId: SESSION,
          phase: 'running',
          deviceId,
          revision: 'revision' in command ? command.revision : null,
          projectDirectory: '/owned/preview-project',
          ...changes
        }
  item.response.resolve({
    version: 1,
    type: 'result',
    id: command.id,
    state,
    ...(command.command === 'devices' ? { devices: DEVICES } : {})
  })
}

async function discover(f: ReturnType<typeof fixture>, processIndex = 0) {
  const pending = f.controller.discover()
  await flush()
  expect(request(f, 0, processIndex).command.command).toBe('devices')
  ack(request(f, 0, processIndex))
  await pending
}

async function start(f: ReturnType<typeof fixture>, processIndex = 0) {
  f.controller.start()
  await flush()
  const item = request(f, 1, processIndex)
  expect(item.command.command).toBe('start')
  ack(item, f.controller.deviceId.value)
  await flush()
  expect(f.controller.state.value.phase).toBe('running')
}

function text(item: ReturnType<typeof request>) {
  if (!('snapshot' in item.command)) throw new Error('Expected snapshot command')
  return item.command.snapshot.graph.nodes.find(([id]) => id === 'preview-text')?.[1].text
}

function activeTextPage(f: ReturnType<typeof fixture>) {
  const page = f.graph.value.getNode('preview-text')?.parentId
  if (!page) throw new Error('Expected authored text page')
  return page
}

describe('Flutter native preview controller', () => {
  test('application page switching retains its owned session and captures the full navigation graph', async () => {
    const f = fixture('realtime')
    const app = applicationModeFixture(true)
    f.graph.value = app.graph
    f.currentPage.value = app.home.id
    await flush()
    await discover(f)
    await start(f)
    const initial = request(f, 1).command
    if (!('snapshot' in initial)) throw new Error('Expected start snapshot')
    expect(initial.snapshot.pageIds).toEqual(app.graph.getPages().map((page) => page.id))
    f.currentPage.value = app.products.id
    await flush()
    expect(f.processes[0].closes()).toBe(0)
    expect(f.controller.state.value.phase).toBe('running')
    app.graph.updateNode(app.homeEntry.id, { width: 390 })
    ++f.version.value
    await flush()
    const update = request(f, 2)
    expect(update.command.command).toBe('update')
    ack(update)
    await flush()
    expect(f.controller.state.value.phase).toBe('running')
  })

  test('leaving application mode revokes the multi-page session', async () => {
    const f = fixture()
    const app = applicationModeFixture(true)
    f.graph.value = app.graph
    f.currentPage.value = app.home.id
    await flush()
    await discover(f)
    await start(f)
    app.graph.updateNode(app.graph.rootId, { lowcodeApplication: { version: 1, enabled: false } })
    ++f.version.value
    await flush()
    expect(f.processes[0].closes()).toBe(1)
    expect(f.controller.state.value.phase).toBe('idle')
  })

  for (const policy of ['realtime', 'auto', 'save', 'manual'] as const) {
    test(`discovers and starts explicitly with an initial snapshot in ${policy} mode`, async () => {
      const f = fixture(policy)
      await flush()
      f.controller.start()
      expect(f.processes).toHaveLength(0)
      await discover(f)
      expect(f.controller.devices.value).toEqual(DEVICES)
      expect(f.controller.deviceId.value).toBe(DEVICES[0].id)
      expect(f.processes[0].requests).toHaveLength(1)
      await start(f)
      expect(text(request(f, 1))).toBe('Initial')
      expect(f.controller.state.value).toMatchObject({ sessionId: SESSION, revision: 1 })
      expect(f.controller.busy.value).toBe(false)
      expect(f.controller.error.value).toBeNull()
    })
  }

  test('auto uses a real trailing delay and captures the latest detached graph snapshot', async () => {
    const f = fixture('auto')
    await discover(f)
    await start(f)
    await f.edit('First')
    await Bun.sleep(220)
    await f.edit('Latest')
    await Bun.sleep(230)
    expect(f.processes[0].requests).toHaveLength(2)
    await Bun.sleep(210)
    const latest = request(f, 2)
    expect(latest.command.command).toBe('update')
    expect(text(latest)).toBe('Latest')
    await f.edit('After captured snapshot')
    expect(text(latest)).toBe('Latest')
    ack(latest)
    await flush()
    expect(f.controller.state.value.revision).toBe(3)
    await Bun.sleep(440)
    expect(text(request(f, 3))).toBe('After captured snapshot')
    ack(request(f, 3))
    await flush()
    expect(f.controller.state.value.revision).toBe(4)
  })

  test('in-flight changes coalesce into one next request after acknowledgement', async () => {
    const f = fixture('realtime')
    await discover(f)
    await start(f)
    await f.edit('In flight')
    await flush()
    await f.edit('Superseded')
    await f.edit('Newest')
    expect(f.processes[0].requests).toHaveLength(3)
    ack(request(f, 2))
    await flush()
    expect(f.processes[0].requests).toHaveLength(4)
    expect(text(request(f, 3))).toBe('Newest')
    ack(request(f, 3))
    await flush()
    expect(f.controller.state.value.revision).toBe(4)
    expect(f.controller.busy.value).toBe(false)
  })

  test('save ignores edits, failure and cancellation, then syncs only a fresh successful status', async () => {
    const f = fixture('save')
    const original = f.status.value
    await discover(f)
    await start(f)
    await f.edit('Saved latest')
    f.status.value = { ...original, phase: 'saving' }
    await nextTick()
    f.status.value = { ...original, phase: 'failed' }
    await nextTick()
    f.status.value = original
    await nextTick()
    await Bun.sleep(430)
    expect(f.processes[0].requests).toHaveLength(2)
    f.status.value = saved()
    await flush()
    expect(text(request(f, 2))).toBe('Saved latest')
    ack(request(f, 2))
    await flush()
    const success = f.status.value
    f.status.value = { ...success, phase: 'saving' }
    await nextTick()
    f.status.value = success
    await flush()
    expect(f.processes[0].requests).toHaveLength(3)
  })

  test('manual ignores saves and edits until explicit reload', async () => {
    const f = fixture()
    await discover(f)
    await start(f)
    await f.edit('Manual latest')
    f.status.value = saved()
    await nextTick()
    await Bun.sleep(430)
    expect(f.processes[0].requests).toHaveLength(2)
    f.controller.reload()
    await flush()
    expect(text(request(f, 2))).toBe('Manual latest')
    ack(request(f, 2))
    await flush()
    expect(f.controller.state.value.phase).toBe('running')
  })

  test('device selected at start remains fixed for updates despite changing selection', async () => {
    const f = fixture()
    await discover(f)
    f.controller.deviceId.value = DEVICES[1].id
    await start(f)
    expect(request(f, 1).command).toMatchObject({ deviceId: DEVICES[1].id })
    f.controller.deviceId.value = DEVICES[0].id
    f.controller.reload()
    await flush()
    ack(request(f, 2), DEVICES[1].id)
    await flush()
    expect(f.controller.state.value.deviceId).toBe(DEVICES[1].id)
    expect(f.controller.error.value).toBeNull()
  })

  for (const changes of [{ deviceId: DEVICES[1].id }, { revision: 999 }, { sessionId: null }]) {
    test(`fails closed and closes the owned process for invalid start ACK ${JSON.stringify(changes)}`, async () => {
      const f = fixture()
      await discover(f)
      f.controller.start()
      await flush()
      ack(request(f, 1), DEVICES[0].id, changes)
      await flush()
      expect(f.controller.state.value.phase).toBe('failed')
      expect(f.controller.error.value).toContain('acknowledgement')
      expect(f.processes[0].closes()).toBe(1)
      f.controller.reload()
      await f.edit('After invalid acknowledgement')
      await flush()
      expect(f.processes[0].requests).toHaveLength(2)
    })
  }

  test('update ACK cannot silently switch to another session', async () => {
    const f = fixture()
    await discover(f)
    await start(f)
    f.controller.reload()
    await flush()
    ack(request(f, 2), DEVICES[0].id, { sessionId: OTHER_SESSION })
    await flush()
    expect(f.controller.state.value.phase).toBe('failed')
    expect(f.processes[0].closes()).toBe(1)
  })

  test('stopping a pending start rejects its late ACK and old progress before restart', async () => {
    const f = fixture()
    await discover(f)
    f.controller.start()
    await flush()
    const old = f.processes[0]
    await f.controller.stop()
    expect(old.closes()).toBe(1)
    await discover(f, 1)
    f.controller.start()
    await flush()
    old.progress('Old preparation')
    ack(request(f, 1))
    await flush()
    expect(f.controller.progress.value).toBe('')
    expect(f.controller.state.value.phase).toBe('preparing')
    ack(request(f, 1, 1))
    await flush()
    expect(f.controller.state.value.phase).toBe('running')
    expect(f.controller.error.value).toBeNull()
  })

  test('a replaced graph closes its session and pending devices never populate the new graph', async () => {
    const f = fixture()
    const discovery = f.controller.discover()
    await flush()
    f.graph.value = scene('New document')
    await flush()
    ack(request(f, 0))
    await discovery
    expect(f.processes[0].closes()).toBe(1)
    expect(f.controller.devices.value).toEqual([])
    expect(f.controller.state.value.phase).toBe('idle')
    await discover(f, 1)
    await start(f, 1)
    expect(text(request(f, 1, 1))).toBe('New document')
    f.processes[0].progress('Old graph progress')
    expect(f.controller.progress.value).toBe('')
  })

  test('stop while process opening closes the late process without publishing commands', async () => {
    const f = fixture('manual', true)
    const discovery = f.controller.discover()
    await flush()
    const stopping = f.controller.stop()
    f.processes[0].open()
    await Promise.all([discovery, stopping])
    expect(f.processes[0].closes()).toBe(1)
    expect(f.processes[0].requests).toHaveLength(0)
    expect(f.controller.state.value.phase).toBe('idle')
    expect(f.controller.error.value).toBeNull()
  })

  test('scope disposal closes the owned process and silences late callbacks and saves', async () => {
    const f = fixture('auto')
    await discover(f)
    await start(f)
    await f.edit('Queued')
    f.scope.stop()
    const before = {
      state: f.controller.state.value,
      error: f.controller.error.value,
      progress: f.controller.progress.value
    }
    f.processes[0].progress('Late progress')
    f.processes[0].terminal('Late terminal failure')
    f.status.value = saved()
    await f.edit('Disposed')
    await Bun.sleep(440)
    expect(f.processes[0].closes()).toBe(1)
    expect(f.processes[0].requests).toHaveLength(2)
    expect({
      state: f.controller.state.value,
      error: f.controller.error.value,
      progress: f.controller.progress.value
    }).toEqual(before)
  })

  test('an old pending stop cannot overwrite a newly running generation', async () => {
    const f = fixture()
    await discover(f)
    await start(f)
    const gate = f.processes[0].delayClose()
    const oldStop = f.controller.stop()
    await f.controller.stop()
    await discover(f, 1)
    await start(f, 1)
    gate.resolve(undefined)
    await oldStop
    expect(f.controller.state.value).toMatchObject({ phase: 'running', sessionId: SESSION })
    expect(f.controller.busy.value).toBe(false)
  })

  test('browser environment fails before invoking a native process', async () => {
    const f = fixture('manual', false, false)
    await f.controller.discover()
    expect(f.processes).toHaveLength(0)
    expect(f.controller.error.value).toContain('desktop app')
    expect(f.controller.busy.value).toBe(false)
  })

  test('stopping immediately after start prevents the awaited process from publishing start', async () => {
    const f = fixture()
    await discover(f)
    f.controller.start()
    await f.controller.stop()
    await flush()
    expect(f.processes[0].requests).toHaveLength(1)
    expect(f.processes[0].closes()).toBe(1)
    expect(f.controller.state.value.phase).toBe('idle')
  })

  test('scope disposal during opening closes only that late process and ignores its callbacks', async () => {
    const f = fixture('manual', true)
    const discovery = f.controller.discover()
    await flush()
    f.scope.stop()
    const before = {
      state: f.controller.state.value,
      error: f.controller.error.value,
      progress: f.controller.progress.value
    }
    f.processes[0].open()
    await discovery
    f.processes[0].progress('Disposed opening progress')
    f.processes[0].terminal('Disposed opening failure')
    await flush()
    expect(f.processes[0].closes()).toBe(1)
    expect(f.processes[0].requests).toHaveLength(0)
    expect({
      state: f.controller.state.value,
      error: f.controller.error.value,
      progress: f.controller.progress.value
    }).toEqual(before)
  })

  test('terminal process callbacks cannot mutate a newly opened generation', async () => {
    const f = fixture()
    await discover(f)
    await start(f)
    const old = f.processes[0]
    old.terminal('Old process stopped unexpectedly')
    await flush()
    expect(f.controller.state.value.phase).toBe('failed')
    await discover(f, 1)
    await start(f, 1)
    old.progress('Late progress from terminal process')
    old.terminal('Late repeated terminal failure')
    expect(f.controller.progress.value).toBe('')
    expect(f.controller.error.value).toBeNull()
    expect(f.controller.state.value.phase).toBe('running')
  })

  test('switching from auto to manual preserves queued edits until explicit reload', async () => {
    const f = fixture('auto')
    await discover(f)
    await start(f)
    await f.edit('Queued before mode switch')
    f.mode.value = 'manual'
    await nextTick()
    await Bun.sleep(430)
    expect(f.processes[0].requests).toHaveLength(2)
    f.controller.reload()
    await flush()
    expect(text(request(f, 2))).toBe('Queued before mode switch')
    ack(request(f, 2))
    await flush()
    expect(f.controller.state.value.phase).toBe('running')
  })

  test('multi-page snapshots select the authored active page instead of an empty page', async () => {
    const f = fixture()
    const active = activeTextPage(f)
    const empty = f.graph.value.addPage('Empty page')
    f.currentPage.value = active
    await flush()
    await discover(f)
    await start(f)
    const command = request(f, 1).command
    if (!('snapshot' in command)) throw new Error('Expected active page snapshot')
    expect(command.snapshot.pageIds).toEqual([active])
    expect(command.snapshot.pageIds).not.toContain(empty.id)
    expect(text(request(f, 1))).toBe('Initial')
  })

  test('switching active page synchronously stops the old session and ignores its pending ACK', async () => {
    const f = fixture()
    f.currentPage.value = activeTextPage(f)
    await flush()
    await discover(f)
    f.controller.start()
    await flush()
    const next = f.graph.value.addPage('Next active page')
    f.currentPage.value = next.id
    expect(f.controller.state.value.phase).toBe('stopping')
    await flush()
    expect(f.processes[0].closes()).toBe(1)
    ack(request(f, 1))
    await flush()
    expect(f.controller.state.value).toMatchObject({ phase: 'idle', sessionId: null })
    await discover(f, 1)
    await start(f, 1)
    const command = request(f, 1, 1).command
    if (!('snapshot' in command)) throw new Error('Expected new active page snapshot')
    expect(command.snapshot.pageIds).toEqual([next.id])
  })
})
