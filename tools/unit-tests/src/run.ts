#!/usr/bin/env bun

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listUnitTests, type UnitTestGroup, unitTestGroupNames } from './shards'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export type ConcreteUnitTestGroup = Exclude<UnitTestGroup, 'all'>

export interface UnitTestRun {
  group: ConcreteUnitTestGroup
  files: string[]
}

interface SpawnResult {
  success: boolean
  exitCode: number
}

export interface UnitTestRunnerDeps {
  executable?: string
  spawnSync?: (command: string[]) => SpawnResult
}

export function parseUnitTestRunArgs(argv: string[]): UnitTestGroup {
  if (argv.length > 1) {
    throw new Error(`Expected at most one unit-test group, received: ${argv.join(' ')}`)
  }
  const group = argv[0] ?? 'all'
  const groups = unitTestGroupNames()
  if (!groups.includes(group as UnitTestGroup)) {
    throw new Error(`Unknown unit test group: ${group}. Expected one of: ${groups.join(', ')}`)
  }
  return group as UnitTestGroup
}

export async function buildUnitTestRunPlan(group: UnitTestGroup): Promise<UnitTestRun[]> {
  const groups = (
    group === 'all' ? unitTestGroupNames().filter((candidate) => candidate !== 'all') : [group]
  ) as ConcreteUnitTestGroup[]
  const plan: UnitTestRun[] = []

  for (const currentGroup of groups) {
    const files = await listUnitTests(currentGroup)
    if (currentGroup === 'compiler-browser') {
      plan.push(...files.map((file) => ({ group: currentGroup, files: [file] })))
    } else if (files.length > 0) {
      plan.push({ group: currentGroup, files })
    }
  }

  return plan
}

export function runUnitTestPlan(
  plan: UnitTestRun[],
  { executable = process.execPath, spawnSync = spawnUnitTest }: UnitTestRunnerDeps = {}
): number {
  for (const run of plan) {
    const result = spawnSync([executable, 'test', ...run.files])
    if (!result.success) return result.exitCode || 1
  }
  return 0
}

function spawnUnitTest(command: string[]): SpawnResult {
  return Bun.spawnSync(command, {
    cwd: REPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit'
  })
}

if (import.meta.main) {
  try {
    const group = parseUnitTestRunArgs(process.argv.slice(2))
    const plan = await buildUnitTestRunPlan(group)
    process.exitCode = runUnitTestPlan(plan)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
