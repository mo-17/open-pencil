import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runHeavyTestFile, runHeavyTests } from '../src/heavy'

const directory = await mkdtemp(join(tmpdir(), 'open-pencil-heavy-runner-'))
const quiet = () => undefined

afterAll(() => rm(directory, { recursive: true, force: true }))

async function fixture(name: string, source: string): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, source)
  return path
}

describe('heavy test process isolation', () => {
  test('runs separate processes in order with heavy fixtures enabled, including paths with spaces', async () => {
    const marker = join(directory, 'first-finished')
    const first = await fixture(
      'first file.test.ts',
      `
      import { expect, test } from 'bun:test'
      test('first', async () => {
        expect(process.env.BUN_HEAVY_TESTS).toBe('true')
        globalThis.heavyTestContamination = true
        await Bun.write(${JSON.stringify(marker)}, 'finished')
      })
    `
    )
    const second = await fixture(
      'second.test.ts',
      `
      import { expect, test } from 'bun:test'
      test('second', async () => {
        expect(globalThis.heavyTestContamination).toBeUndefined()
        expect(await Bun.file(${JSON.stringify(marker)}).text()).toBe('finished')
      })
    `
    )
    expect(await runHeavyTests([first, second], { log: quiet })).toBe(0)
  })

  test('preserves failures and does not start later files', async () => {
    const marker = join(directory, 'must-not-run')
    const first = await fixture('failure.test.ts', 'process.exit(23)')
    const second = await fixture(
      'later.test.ts',
      `await Bun.write(${JSON.stringify(marker)}, 'bad')`
    )
    expect(await runHeavyTests([first, second], { log: quiet })).toBe(23)
    expect(await Bun.file(marker).exists()).toBeFalse()
  })

  test('an empty group succeeds without launching tests', async () => {
    expect(await runHeavyTests([], { log: quiet })).toBe(0)
  })

  test('cancellation before execution never starts a test', async () => {
    const controller = new AbortController()
    controller.abort(143)
    expect(await runHeavyTestFile('missing.test.ts', { signal: controller.signal })).toBe(143)
  })

  test('cancellation interrupts an active test and keeps its cancellation exit code', async () => {
    const waiting = await fixture(
      'cancel.test.ts',
      `
      import { test } from 'bun:test'
      test('wait', async () => { await Bun.sleep(10000) })
    `
    )
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(130), 100)
    try {
      expect(await runHeavyTestFile(waiting, { signal: controller.signal, log: quiet })).toBe(130)
    } finally {
      clearTimeout(timer)
    }
  })

  test('a wall-clock deadline interrupts synchronous code and reports timeout failure', async () => {
    const hanging = await fixture(
      'busy.test.ts',
      `
      import { test } from 'bun:test'
      process.on('SIGTERM', () => {})
      test('busy', () => { while (true) {} })
    `
    )
    expect(await runHeavyTestFile(hanging, { timeoutMs: 200, killGraceMs: 100, log: quiet })).toBe(
      124
    )
  })

  test.skipIf(process.platform === 'win32')('timeout also stops a CLI grandchild', async () => {
    const marker = join(directory, 'grandchild-survived')
    const ready = join(directory, 'grandchild-ready')
    const grandchild = `
      process.on('SIGTERM', () => {})
      await Bun.write(${JSON.stringify(ready)}, 'ready')
      await Bun.sleep(1000)
      await Bun.write(${JSON.stringify(marker)}, 'bad')
    `
    const parent = await fixture(
      'grandchild.test.ts',
      `
      import { test } from 'bun:test'
      Bun.spawn([process.execPath, '-e', ${JSON.stringify(grandchild)}], { stdout: 'inherit', stderr: 'inherit' })
      test('wait', async () => { await Bun.sleep(10000) })
    `
    )
    expect(await runHeavyTestFile(parent, { timeoutMs: 400, killGraceMs: 100, log: quiet })).toBe(
      124
    )
    expect(await readFile(ready, 'utf8')).toBe('ready')
    await Bun.sleep(900)
    expect(await Bun.file(marker).exists()).toBeFalse()
  })

  test.skipIf(process.platform === 'win32').each([0, 23])(
    'cleans a CLI grandchild when the test process exits with %i',
    async (exitCode) => {
      const marker = join(directory, `orphan-survived-${exitCode}`)
      const ready = join(directory, `orphan-ready-${exitCode}`)
      const grandchild = `
        await Bun.write(${JSON.stringify(ready)}, 'ready')
        await Bun.sleep(700)
        await Bun.write(${JSON.stringify(marker)}, 'bad')
      `
      const parent = await fixture(
        `exiting-${exitCode}.test.ts`,
        `
        Bun.spawn([process.execPath, '-e', ${JSON.stringify(grandchild)}], { stdout: 'inherit', stderr: 'inherit' })
        while (!(await Bun.file(${JSON.stringify(ready)}).exists())) await Bun.sleep(10)
        process.exit(${exitCode})
      `
      )
      expect(await runHeavyTestFile(parent, { timeoutMs: 2000, log: quiet })).toBe(exitCode)
      expect(await readFile(ready, 'utf8')).toBe('ready')
      await Bun.sleep(800)
      expect(await Bun.file(marker).exists()).toBeFalse()
    }
  )
})
