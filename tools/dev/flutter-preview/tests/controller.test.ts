import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { compileFlutterPreviewSnapshot } from '@open-pencil/compiler/flutter-preview'

import { FlutterPreviewController } from '../src/controller'
import {
  controllerFixture,
  generated,
  snapshot,
  startCommand,
  tick,
  updateCommand,
  testSDK,
  FakeProject,
  FakeChild
} from './helpers/index'

describe('owned native Flutter controller', () => {
  test('starts only a freshly discovered emulator with fixed arguments and acknowledges started', async () => {
    const fixture = controllerFixture()
    const result = await fixture.controller.execute(startCommand())
    expect(result.type).toBe('result')
    expect(fixture.controller.getState()).toMatchObject({
      phase: 'running',
      revision: 1,
      deviceId: 'booted-ios'
    })
    expect(fixture.calls.map((call) => call.args[2])).toEqual(['devices', 'create', 'pub', 'run'])
    expect(
      fixture.calls.every(
        (call) => call.args[0] === '--no-version-check' && call.args[1] === '--suppress-analytics'
      )
    ).toBe(true)
    expect(fixture.calls[1]?.args).toContain('--no-pub')
    expect(fixture.calls[2]?.args).toContain('--offline')
    expect(fixture.calls[3]?.args).toEqual([
      '--no-version-check',
      '--suppress-analytics',
      'run',
      '--machine',
      '--debug',
      '--no-pub',
      '-d',
      'booted-ios',
      '--target',
      'lib/main.dart'
    ])
    expect(fixture.calls.slice(1).every((call) => call.cwd === fixture.project.directory)).toBe(
      true
    )
    await fixture.controller.stop()
    expect(fixture.run.stops).toBeGreaterThan(0)
  })

  test('refuses stale, physical or unknown device IDs before create', async () => {
    const fixture = controllerFixture()
    await expect(fixture.controller.execute(startCommand(1, 'unavailable-device'))).rejects.toThrow(
      'already-running'
    )
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.project.writes).toBe(0)
    await fixture.controller.stop()
  })

  test('missing cached artifacts fail before creating or writing any project', async () => {
    const fixture = controllerFixture({ missingCache: true })
    await expect(fixture.controller.execute(startCommand())).rejects.toThrow('Missing cache')
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.project.writes).toBe(0)
    await fixture.controller.stop()
  })

  test('stop preempts a hanging create without waiting for its preparation deadline', async () => {
    const fixture = controllerFixture({ hangingCreate: true })
    const start = fixture.controller.execute(startCommand()).catch((error: unknown) => error)
    await tick()
    expect(fixture.calls.at(-1)?.args).toContain('create')
    const stop = await fixture.controller.execute({
      version: 1,
      type: 'command',
      id: randomUUID(),
      command: 'stop'
    })
    expect(stop.type).toBe('result')
    expect(fixture.controller.getState().phase).toBe('idle')
    expect(await start).toBeInstanceOf(Error)
    expect(
      fixture.calls.some((call) => call.args.includes('pub') || call.args.includes('run'))
    ).toBe(false)
    expect(fixture.calls.at(-1)?.child.stops).toBeGreaterThan(0)
  })

  test('close aborts preparation and permanently rejects future starts', async () => {
    const fixture = controllerFixture({ hangingCreate: true })
    const start = fixture.controller.execute(startCommand()).catch((error: unknown) => error)
    await tick()
    await fixture.controller.execute({
      version: 1,
      type: 'command',
      id: randomUUID(),
      command: 'close'
    })
    await start
    await expect(fixture.controller.execute(startCommand())).rejects.toThrow('closed')
  })

  test('successful hot reload uses machine restart without full restart and commits revision only after ACK', async () => {
    const fixture = controllerFixture()
    await fixture.controller.execute(startCommand())
    let acknowledge: (() => void) | undefined
    fixture.run.onWrite = async (request) => {
      acknowledge = () => fixture.run.acknowledge(request)
    }
    const update = fixture.controller.execute(updateCommand())
    await tick()
    expect(fixture.controller.getState()).toMatchObject({ revision: 1, phase: 'reloading' })
    expect(fixture.run.writes[0]).toMatchObject({
      method: 'app.restart',
      params: { appId: 'owned-app', fullRestart: false, pause: false }
    })
    acknowledge?.()
    await update
    expect(fixture.controller.getState()).toMatchObject({ revision: 2, phase: 'running' })
    await fixture.controller.stop()
  })

  test('a rejected reload restores source and retains last acknowledged revision', async () => {
    const fixture = controllerFixture({ reloadCode: 1 })
    await fixture.controller.execute(startCommand())
    await expect(fixture.controller.execute(updateCommand())).rejects.toThrow(
      'previous acknowledged'
    )
    expect(fixture.controller.getState().revision).toBe(1)
    expect(fixture.project.files.get('lib/main.dart')).toBe('initial')
    await fixture.controller.stop()
  })

  test('stop during reload rolls back source, retains ACK and kills only its own run', async () => {
    const fixture = controllerFixture()
    await fixture.controller.execute(startCommand())
    fixture.run.onWrite = async () => undefined
    const update = fixture.controller.execute(updateCommand()).catch((error: unknown) => error)
    await tick()
    await fixture.controller.stop()
    expect(await update).toBeInstanceOf(Error)
    expect(fixture.project.files.get('lib/main.dart')).toBe('initial')
    expect(fixture.controller.getState()).toMatchObject({ phase: 'idle', revision: 1 })
    expect(fixture.run.stops).toBeGreaterThan(0)
  })

  test('busy and old revisions never write or start concurrent processes', async () => {
    const fixture = controllerFixture({ hangingCreate: true })
    const first = fixture.controller.execute(startCommand()).catch((error: unknown) => error)
    await expect(fixture.controller.execute(updateCommand())).rejects.toThrow('busy')
    await fixture.controller.stop()
    await first
    const running = controllerFixture()
    await running.controller.execute(startCommand(4))
    const writes = running.project.writes
    await expect(running.controller.execute(updateCommand(4))).rejects.toThrow('older or repeated')
    expect(running.project.writes).toBe(writes)
    await running.controller.stop()
  })

  test('Android cache preparation occurs before offline pub and run', async () => {
    const fixture = controllerFixture({ android: true })
    await fixture.controller.execute(startCommand())
    expect(fixture.androidPreparations()).toBe(1)
    expect(fixture.calls[1]?.args).toContain('--platforms=android')
    await fixture.controller.stop()
  })

  test('dependency changes require explicit restart before writes or RPC', async () => {
    const project = new FakeProject()
    const run = new FakeChild()
    let count = 0
    const controller = new FlutterPreviewController({
      onEvent: () => undefined,
      resolveSDK: async () => testSDK,
      ensureCache: async () => undefined,
      createProject: async () => project,
      compile: () => {
        const files = generated(count++ ? 'edited' : 'initial')
        if (count > 1) files.set('assets/new.png', 'new asset')
        return { files, warnings: [] }
      },
      spawn: (_executable, args) => {
        const child = args.includes('run') ? run : new FakeChild()
        if (args.includes('devices'))
          child.stdout.push(
            JSON.stringify([
              { id: 'booted-ios', name: 'Phone', emulator: true, targetPlatform: 'ios' }
            ])
          )
        if (args.includes('run')) {
          child.ready(project.directory)
          child.onWrite = async (request) => child.acknowledge(request)
        } else child.finish()
        return child
      }
    })
    await controller.execute(startCommand())
    await expect(controller.execute(updateCommand())).rejects.toThrow('requires stopping')
    expect(project.writes).toBe(1)
    expect(run.writes).toHaveLength(0)
    await controller.stop()
  })

  test('public SceneGraph snapshot compiles real Flutter source, not caller-supplied Dart', () => {
    const compiled = compileFlutterPreviewSnapshot(snapshot('Preview page'))
    expect(compiled.files.get('pubspec.yaml')).toContain('name: openpencil_flutter_preview')
    expect(compiled.files.get('lib/main.dart')).toContain('OpenPencilApp')
    expect([...compiled.files.keys()].some((path) => path.startsWith('lib/pages/'))).toBe(true)
  })
})
