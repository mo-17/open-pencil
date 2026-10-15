#!/usr/bin/env bun

import { resolve } from 'node:path'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts-tools'

import { listHeavyUnitTests, listUnitTests, type UnitTestGroup, unitTestGroupNames } from './shards'

const REPO_ROOT = await resolveWorkspaceRoot(import.meta.dir)

export type ConcreteUnitTestGroup = Exclude<UnitTestGroup, 'all'>

export interface UnitTestRun {
  group: ConcreteUnitTestGroup
  files: string[]
}

type SpawnResult = Pick<Bun.SyncSubprocess, 'success' | 'exitCode'>

export interface UnitTestRunnerDeps {
  executable?: string
  bunTestArgs?: string[]
  includeHeavy?: boolean
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

export interface UnitTestRunOptions {
  includeHeavy?: boolean
  heavyOnly?: boolean
  isolate?: boolean
  coverage?: boolean
}

export function parseUnitTestRunOptions(argv: string[]) {
  const separator = argv.indexOf('--')
  const ownArgs = separator === -1 ? argv : argv.slice(0, separator)
  const bunTestArgs = separator === -1 ? [] : argv.slice(separator + 1)
  const flags = ownArgs.filter((arg) => arg.startsWith('--'))
  for (const flag of flags) {
    if (flag !== '--include-heavy' && flag !== '--heavy-only' && flag !== '--isolate') {
      throw new Error(`Unknown unit test flag: ${flag}`)
    }
  }
  return {
    group: parseUnitTestRunArgs(ownArgs.filter((arg) => !arg.startsWith('--'))),
    includeHeavy: flags.includes('--include-heavy') || flags.includes('--heavy-only'),
    heavyOnly: flags.includes('--heavy-only'),
    isolate: flags.includes('--isolate'),
    bunTestArgs
  }
}

export async function buildUnitTestRunPlan(
  group: UnitTestGroup,
  options: UnitTestRunOptions = {}
): Promise<UnitTestRun[]> {
  const groups = (
    group === 'all' ? unitTestGroupNames().filter((candidate) => candidate !== 'all') : [group]
  ) as ConcreteUnitTestGroup[]
  const plan: UnitTestRun[] = []

  for (const currentGroup of groups) {
    const lightFiles = options.heavyOnly ? [] : await listUnitTests(currentGroup)
    const heavyFiles =
      options.includeHeavy || options.heavyOnly ? await listHeavyUnitTests(currentGroup) : []
    const files = [...lightFiles, ...heavyFiles]
    if (options.isolate || currentGroup === 'compiler-browser') {
      plan.push(...files.map((file) => ({ group: currentGroup, files: [file] })))
    } else if (options.coverage) {
      if (files.length > 0) plan.push({ group: currentGroup, files })
    } else {
      if (lightFiles.length > 0) plan.push({ group: currentGroup, files: lightFiles })
      plan.push(...heavyFiles.map((file) => ({ group: currentGroup, files: [file] })))
    }
  }

  return plan
}

export function runUnitTestPlan(
  plan: UnitTestRun[],
  {
    executable = process.execPath,
    bunTestArgs = [],
    includeHeavy = false,
    spawnSync
  }: UnitTestRunnerDeps = {}
): number {
  for (const run of plan) {
    // Absolute paths select exact files; bare paths are Bun discovery filters.
    const result = (spawnSync ?? ((command) => spawnUnitTest(command, includeHeavy)))([
      executable,
      'test',
      ...bunTestArgs,
      ...run.files.map((file) => resolve(REPO_ROOT, file))
    ])
    if (!result.success) return result.exitCode || 1
  }
  return 0
}

function spawnUnitTest(command: string[], includeHeavy: boolean): SpawnResult {
  return Bun.spawnSync(command, {
    cwd: REPO_ROOT,
    env: { ...process.env, BUN_HEAVY_TESTS: includeHeavy ? 'true' : 'false' },
    stdout: 'inherit',
    stderr: 'inherit'
  })
}

if (import.meta.main) {
  try {
    const options = parseUnitTestRunOptions(process.argv.slice(2))
    const plan = await buildUnitTestRunPlan(options.group, {
      ...options,
      coverage: options.bunTestArgs.some((arg) => arg.startsWith('--coverage'))
    })
    process.exitCode = runUnitTestPlan(plan, options)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
