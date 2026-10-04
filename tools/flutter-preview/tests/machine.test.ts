import { describe, expect, test } from 'bun:test'

import { FlutterMachine } from '../src/machine'
import { deferred, FakeChild, tick } from './helpers/index'

function fixture() {
  const child = new FakeChild()
  const logs: string[] = []
  let exits = 0
  const machine = new FlutterMachine(child, {
    deviceId: 'booted-ios',
    directory: '/owned/session',
    onLog: (message) => logs.push(message),
    onProgress: (message) => logs.push(message),
    onExit: () => {
      exits++
    }
  })
  child.onWrite = async (request) => child.acknowledge(request)
  return { child, machine, logs, exits: () => exits }
}

describe('Flutter machine correlation and lifecycle', () => {
  test('ignores another app/device and requires the owned app started event', async () => {
    const { child, machine } = fixture()
    child.ready('/unowned/project', 'other-device')
    await expect(machine.waitReady(10, new AbortController().signal)).rejects.toThrow('app.started')
    child.ready()
    await machine.waitReady(100, new AbortController().signal)
    expect(machine.isRunning()).toBe(true)
    await machine.stop()
  })

  test('stray diagnostic lines and unrelated ACKs cannot satisfy restart', async () => {
    const { child, machine, logs } = fixture()
    child.stdout.push('[info] a stray SDK diagnostic\n')
    child.ready()
    await machine.waitReady(100, new AbortController().signal)
    child.onWrite = async (request) => {
      child.events([{ id: 99_999, result: { code: 0 } }])
      child.acknowledge(request, 1)
    }
    await expect(machine.reload(new AbortController().signal, 100)).rejects.toThrow('rejected')
    expect(logs).toContain('[info] a stray SDK diagnostic')
    await machine.stop()
  })

  test('a never-resolving write is still governed by the RPC deadline', async () => {
    const { child, machine } = fixture()
    child.ready()
    await machine.waitReady(100, new AbortController().signal)
    child.onWrite = () => deferred<undefined>().promise
    await expect(machine.reload(new AbortController().signal, 10)).rejects.toThrow(
      'acknowledgement timed out'
    )
    child.finish()
    await machine.stop()
    expect(child.stops).toBeGreaterThan(0)
  })

  test('abort cancels reload even if the transport write is blocked', async () => {
    const { child, machine } = fixture()
    child.ready()
    await machine.waitReady(100, new AbortController().signal)
    child.onWrite = () => deferred<undefined>().promise
    const signal = new AbortController()
    const reload = machine.reload(signal.signal, 1_000)
    signal.abort()
    await expect(reload).rejects.toThrow('cancelled')
    child.finish()
    await machine.stop()
  })

  test('an early ACK cannot cancel the deadline for a blocked transport write', async () => {
    const { child, machine } = fixture()
    child.ready()
    await machine.waitReady(100, new AbortController().signal)
    child.onWrite = (request) => {
      child.acknowledge(request)
      return deferred<undefined>().promise
    }
    await expect(machine.reload(new AbortController().signal, 10)).rejects.toThrow(
      'acknowledgement timed out'
    )
    child.finish()
    await machine.stop()
  })

  test('exited app cannot be marked running and reports exit only once', async () => {
    const { child, machine, exits } = fixture()
    child.ready()
    await machine.waitReady(100, new AbortController().signal)
    child.events([{ event: 'app.stop', params: { appId: 'owned-app' } }])
    child.finish(1)
    await tick()
    expect(machine.isRunning()).toBe(false)
    expect(exits()).toBe(1)
    await machine.stop()
  })
})
