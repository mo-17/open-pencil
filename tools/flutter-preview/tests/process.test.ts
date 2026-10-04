import { afterEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  manageFlutterChild,
  runFlutterCommand,
  spawnFlutterChild,
  type FlutterChild
} from '../src/process'

const directories: string[] = []
const children: FlutterChild[] = []
const groups: Array<{ native: ChildProcessWithoutNullStreams; descendant?: number }> = []

function signalGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL') {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error
  }
}

afterEach(async () => {
  try {
    const results = await Promise.allSettled(children.splice(0).map((child) => child.stop()))
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  } finally {
    for (const group of groups.splice(0)) {
      const pid = group.native.pid
      const leaderLive = group.native.exitCode === null && group.native.signalCode === null
      if (pid && (leaderLive || (group.descendant && alive(group.descendant)))) {
        signalGroup(pid, 'SIGKILL')
      }
    }
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true })
  }
})

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'openpencil-owned-process-test-'))
  directories.push(path)
  return path
}

async function managed(
  source: string,
  killGroup?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
) {
  const cwd = await directory()
  const script = join(cwd, 'child.cjs')
  await writeFile(script, source)
  const native = spawn(process.execPath, [script], {
    cwd,
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  })
  const group: (typeof groups)[number] = { native }
  if (native.pid && process.platform !== 'win32') groups.push(group)
  const child = manageFlutterChild(native, killGroup)
  children.push(child)
  return { native, child, group }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

async function waitGone(pid: number) {
  for (let attempt = 0; attempt < 100 && alive(pid); ++attempt) await Bun.sleep(10)
  return !alive(pid)
}

function descendantId(output: string) {
  const value: unknown = JSON.parse(output)
  if (
    !value ||
    typeof value !== 'object' ||
    !('descendant' in value) ||
    typeof value.descendant !== 'number' ||
    !Number.isInteger(value.descendant) ||
    value.descendant <= 0
  ) {
    throw new Error('The owned test leader did not report its child PID')
  }
  return value.descendant
}

async function* unusedStream(): AsyncGenerator<string> {
  yield ''
}

describe('Flutter tool owned process boundary without SDK', () => {
  test.skipIf(process.platform === 'win32')(
    'a completed leader has already cleaned its private descendant group',
    async () => {
      const source = `
      const { spawn } = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.stdout.write(JSON.stringify({ descendant: descendant.pid }));
      setTimeout(() => process.exit(0), 30);
    `
      const { child, group } = await managed(source)
      const result = await runFlutterCommand(child, 2000, new AbortController().signal)
      const descendant = descendantId(result.stdout)
      group.descendant = descendant
      expect(result.code).toBe(0)
      expect(await waitGone(descendant)).toBe(true)
      await child.stop()
      expect(alive(descendant)).toBe(false)
    }
  )

  test('completed is published after the exit cleanup hook and close is idempotent', async () => {
    const calls: Array<{ pid: number; signal: string }> = []
    const { native, child } = await managed('process.exit(0)', (pid, signal) => {
      calls.push({ pid, signal })
    })
    if (!native.pid) throw new Error('Expected owned Bun PID')
    expect(await child.completed).toEqual({ code: 0 })
    expect(calls).toEqual([{ pid: native.pid, signal: 'SIGKILL' }])
    const first = child.stop()
    expect(child.stop()).toBe(first)
    await first
    expect(calls).toHaveLength(1)
    await expect(child.write('late write')).rejects.toThrow('no longer accepting')
  })

  test('live child stop is reentrant and waits for its own close', async () => {
    const { native, child } = await managed('setInterval(() => {}, 1000)')
    const first = child.stop()
    expect(child.stop()).toBe(first)
    await first
    await child.completed
    if (!native.pid) throw new Error('Expected owned Bun PID')
    expect(alive(native.pid)).toBe(false)
  })

  test('spawn accepts literal argv and normal stdout/stderr completion without a shell', async () => {
    const literal = 'literal * $(not-a-command) ; spaces'
    const cwd = await directory()
    const script = join(cwd, 'argv.cjs')
    await writeFile(
      script,
      "process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write('owned diagnostic')"
    )
    const child = spawnFlutterChild(process.execPath, [script, literal], {
      cwd,
      environment: process.env
    })
    children.push(child)
    const result = await runFlutterCommand(child, 2000, new AbortController().signal)
    expect(result).toEqual({
      code: 0,
      stdout: JSON.stringify([literal]),
      stderr: 'owned diagnostic'
    })
  })

  test('run command abort stops its real owned child and rejects the operation', async () => {
    const { native, child } = await managed('setInterval(() => {}, 1000)')
    const cancellation = new AbortController()
    const work = runFlutterCommand(child, 2000, cancellation.signal)
    cancellation.abort()
    await expect(work).rejects.toThrow('cancelled')
    await child.completed
    if (!native.pid) throw new Error('Expected owned Bun PID')
    expect(alive(native.pid)).toBe(false)
  })

  test('output budget failure stops only its real owned child', async () => {
    const { native, child } = await managed(
      'process.stdout.write(Buffer.alloc(512 * 1024 + 1, 120)); setInterval(() => {}, 1000)'
    )
    await expect(runFlutterCommand(child, 2000, new AbortController().signal)).rejects.toThrow(
      'byte budget'
    )
    await child.completed
    if (!native.pid) throw new Error('Expected owned Bun PID')
    expect(alive(native.pid)).toBe(false)
  })

  test('command timeout stops only its real owned child', async () => {
    const { native, child } = await managed('setInterval(() => {}, 1000)')
    await expect(runFlutterCommand(child, 20, new AbortController().signal)).rejects.toThrow(
      'timed out'
    )
    await child.completed
    if (!native.pid) throw new Error('Expected owned Bun PID')
    expect(alive(native.pid)).toBe(false)
  })

  test('pre-aborted command does not read or operate on the supplied child', async () => {
    let accesses = 0
    const child: FlutterChild = {
      get stdout() {
        ++accesses
        return unusedStream()
      },
      get stderr() {
        ++accesses
        return unusedStream()
      },
      get completed() {
        ++accesses
        return Promise.resolve({ code: 0 })
      },
      async write() {
        ++accesses
      },
      async stop() {
        ++accesses
      }
    }
    const cancellation = new AbortController()
    cancellation.abort()
    await expect(runFlutterCommand(child, 20, cancellation.signal)).rejects.toThrow('cancelled')
    expect(accesses).toBe(0)
  })
})
