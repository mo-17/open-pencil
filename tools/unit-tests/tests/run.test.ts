import { describe, expect, test } from 'bun:test'

import {
  buildUnitTestRunPlan,
  parseUnitTestRunArgs,
  runUnitTestPlan,
  type UnitTestRun
} from '../src/run'

describe('unit test runner arguments', () => {
  test('defaults to all and accepts a declared group', () => {
    expect(parseUnitTestRunArgs([])).toBe('all')
    expect(parseUnitTestRunArgs(['compiler-browser'])).toBe('compiler-browser')
  })

  test('rejects unknown groups and extra arguments', () => {
    expect(() => parseUnitTestRunArgs(['missing'])).toThrow('Unknown unit test group')
    expect(() => parseUnitTestRunArgs(['compiler', 'extra'])).toThrow(
      'Expected at most one unit-test group'
    )
  })
})

describe('unit test runner plan', () => {
  test('keeps an ordinary shard in one process and excludes browser tests', async () => {
    const plan = await buildUnitTestRunPlan('compiler')

    expect(plan).toHaveLength(1)
    expect(plan[0].group).toBe('compiler')
    expect(plan[0].files.length).toBeGreaterThan(0)
    expect(
      plan[0].files.some((file) => file.startsWith('tests/engine/compiler/preview/'))
    ).toBeFalse()
  })

  test('isolates every compiler browser file in its own process', async () => {
    const plan = await buildUnitTestRunPlan('compiler-browser')

    expect(plan.length).toBeGreaterThan(0)
    expect(plan.every((run) => run.group === 'compiler-browser')).toBeTrue()
    expect(plan.every((run) => run.files.length === 1)).toBeTrue()
    expect(
      plan.every((run) => run.files[0].startsWith('tests/engine/compiler/preview/'))
    ).toBeTrue()
  })

  test('runs all ordinary shards separately while preserving browser isolation', async () => {
    const plan = await buildUnitTestRunPlan('all')
    const ordinaryGroups = plan
      .filter((run) => run.group !== 'compiler-browser')
      .map((run) => run.group)
    const browserRuns = plan.filter((run) => run.group === 'compiler-browser')

    expect(new Set(ordinaryGroups).size).toBe(ordinaryGroups.length)
    expect(ordinaryGroups).toContain('compiler')
    expect(ordinaryGroups).toContain('motion')
    expect(browserRuns.length).toBeGreaterThan(0)
    expect(browserRuns.every((run) => run.files.length === 1)).toBeTrue()
  })
})

describe('unit test runner execution', () => {
  const plan: UnitTestRun[] = [
    { group: 'compiler', files: ['compiler-a.test.ts', 'compiler-b.test.ts'] },
    { group: 'compiler-browser', files: ['browser.test.ts'] },
    { group: 'motion', files: ['motion.test.ts'] }
  ]

  test('uses argument arrays and executes every planned process once', () => {
    const commands: string[][] = []
    const exitCode = runUnitTestPlan(plan, {
      executable: '/test/bun',
      spawnSync(command) {
        commands.push(command)
        return { success: true, exitCode: 0 }
      }
    })

    expect(exitCode).toBe(0)
    expect(commands).toEqual([
      ['/test/bun', 'test', 'compiler-a.test.ts', 'compiler-b.test.ts'],
      ['/test/bun', 'test', 'browser.test.ts'],
      ['/test/bun', 'test', 'motion.test.ts']
    ])
  })

  test('stops immediately after the first failed process', () => {
    const commands: string[][] = []
    const exitCode = runUnitTestPlan(plan, {
      spawnSync(command) {
        commands.push(command)
        return commands.length === 2
          ? { success: false, exitCode: 23 }
          : { success: true, exitCode: 0 }
      }
    })

    expect(exitCode).toBe(23)
    expect(commands).toHaveLength(2)
  })
})
