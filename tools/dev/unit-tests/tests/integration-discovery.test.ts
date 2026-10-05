import { expect, test } from 'bun:test'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts-tools'

import { buildUnitTestRunPlan } from '../src/run'

test('all committed app, integration and package contract suites are assigned exactly once', async () => {
  const root = await resolveWorkspaceRoot(import.meta.dir)
  const expected: string[] = []
  for (const pattern of [
    'tests/app/**/*.test.ts',
    'tests/integration/**/*.test.ts',
    'tests/engine/**/*.test.ts',
    'packages/*/tests/**/*.test.ts'
  ]) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root })) {
      if (!path.startsWith('packages/harness/')) expected.push(path)
    }
  }
  const plan = await buildUnitTestRunPlan('all', { includeHeavy: true })
  const actual = plan.flatMap((run) => run.files)
  expect(actual.length).toBe(new Set(actual).size)
  expect([...new Set(actual)].sort()).toEqual([...new Set(expected)].sort())
  for (const group of ['compiler', 'compiler-browser', 'lowcode', 'motion']) {
    expect(
      plan.filter((run) => run.group === group).flatMap((run) => run.files).length
    ).toBeGreaterThan(0)
  }
})
