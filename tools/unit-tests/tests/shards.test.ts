import { expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  isHeavyUnitTest,
  listHeavyUnitTests,
  listUnitTests,
  pathsForUnitTestGroup,
  unitTestGroupNames
} from '../src/shards'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const REQUIRED_UNIT_TEST_ROOTS = [
  'tests/engine',
  'packages/motion/tests',
  'packages/plugin-contracts/tests',
  'packages/lowcode/tests',
  'packages/motion-runtime/tests',
  'packages/codepen-sidecar/tests'
] as const

async function repositoryTestFiles(path: string): Promise<string[]> {
  const entries = await readdir(resolve(REPO_ROOT, path), { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const childPath = `${path}/${entry.name}`
      if (entry.isDirectory()) return repositoryTestFiles(childPath)
      if (entry.isFile() && entry.name.endsWith('.test.ts')) return [childPath]
      return []
    })
  )
  return files.flat()
}

test('unit test groups cover all declared shards', () => {
  expect(unitTestGroupNames()).toContain('all')
  expect(unitTestGroupNames()).toContain('compiler')
  expect(unitTestGroupNames()).toContain('compiler-browser')
  expect(unitTestGroupNames()).toContain('motion')
  expect(pathsForUnitTestGroup('dom')).toContain('tests/engine/dom-css')
  expect(pathsForUnitTestGroup('all')).toContain('tests/engine/io')
  expect(pathsForUnitTestGroup('compiler-browser')).toEqual(['tests/engine/compiler/preview'])
  expect(pathsForUnitTestGroup('motion')).toContain('packages/motion/tests')
  expect(pathsForUnitTestGroup('motion')).toContain('packages/motion-runtime/tests')
  expect(pathsForUnitTestGroup('app')).toContain('packages/plugin-contracts/tests')
  expect(pathsForUnitTestGroup('scene')).toContain('packages/lowcode/tests')
})

test('compiler browser tests are isolated from the non-browser compiler shard', async () => {
  const compilerFiles = await listUnitTests('compiler', { includeHeavy: true })
  const browserFiles = await listUnitTests('compiler-browser', { includeHeavy: true })

  expect(browserFiles.length).toBeGreaterThan(0)
  expect(browserFiles.every((file) => file.startsWith('tests/engine/compiler/preview/'))).toBeTrue()
  expect(
    compilerFiles.some((file) => file.startsWith('tests/engine/compiler/preview/'))
  ).toBeFalse()
  expect(browserFiles).toContain(
    'tests/engine/compiler/preview/motion/sampler-parity-browser.test.ts'
  )
})

test('unit test groups own every repository unit test exactly once', async () => {
  const owners = new Map<string, string[]>()
  for (const group of unitTestGroupNames().filter((candidate) => candidate !== 'all')) {
    for (const file of await listUnitTests(group, { includeHeavy: true })) {
      owners.set(file, [...(owners.get(file) ?? []), group])
    }
  }
  const expected = (
    await Promise.all(REQUIRED_UNIT_TEST_ROOTS.map((root) => repositoryTestFiles(root)))
  )
    .flat()
    .sort()
  const actual = [...owners.keys()].sort()
  const duplicates = [...owners]
    .filter(([, groups]) => groups.length !== 1)
    .map(([file, groups]) => ({ file, groups }))

  expect({
    missing: expected.filter((file) => !owners.has(file)),
    unexpected: actual.filter((file) => !expected.includes(file)),
    duplicates
  }).toEqual({ missing: [], unexpected: [], duplicates: [] })
})

test('PR CI delegates every declared quick shard to the cross-platform runner', async () => {
  const workflow = await readFile(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')
  const unitJobStart = workflow.indexOf('\n  unit-tests:')
  const unitJobEnd = workflow.indexOf('\n  p2-motion-e2e:')
  if (unitJobStart === -1 || unitJobEnd === -1)
    throw new Error('Unit-test CI job boundary is missing')
  const unitJob = workflow.slice(unitJobStart, unitJobEnd)
  const matrix = workflow.match(/group:\s*\[([^\]]+)\]/)
  if (!matrix?.[1]) throw new Error('Unit-test matrix group list is missing from CI')
  const ciGroups = matrix[1]
    .split(',')
    .map((group) => group.trim())
    .sort()
  const declaredGroups = unitTestGroupNames()
    .filter((group) => group !== 'all')
    .sort()

  expect(ciGroups).toEqual(declaredGroups)
  expect(unitJob).toContain("if: matrix.group == 'compiler-browser'")
  expect(unitJob).not.toContain("if: matrix.group == 'compiler'")
  expect(unitJob.match(/playwright install --with-deps chromium/g)).toHaveLength(1)
  expect(unitJob).toMatch(/bun tools\/unit-tests\/src\/run\.ts "\$\{\{ matrix\.group \}\}"/)
  expect(unitJob).not.toContain('mapfile')
  expect(unitJob).not.toContain('--retry')
})

test('heavy unit test matcher excludes fixture-heavy tests', () => {
  expect(isHeavyUnitTest('tests/engine/io/fig/heavy/fixtures.test.ts')).toBe(true)
  expect(isHeavyUnitTest('tests/engine/io/fig/roundtrip/glyph-blob.test.ts')).toBe(true)
  expect(isHeavyUnitTest('tests/engine/dom-css/runtime.test.ts')).toBe(false)
})

test('quick unit test listing excludes heavy tests', async () => {
  const quickFiles = await listUnitTests('all')
  expect(quickFiles).toContain('tests/engine/dom-css/runtime.test.ts')
  expect(quickFiles).not.toContain('tests/engine/io/fig/heavy/fixtures.test.ts')
  expect(quickFiles).not.toContain('tests/engine/io/fig/roundtrip/glyph-blob.test.ts')
})

test('heavy unit test listing contains only heavy tests', async () => {
  const heavyFiles = await listHeavyUnitTests()
  expect(heavyFiles).toContain('tests/engine/io/fig/heavy/fixtures.test.ts')
  expect(heavyFiles.every(isHeavyUnitTest)).toBe(true)
})

test('every heavy-tagged suite enters the heavy test gate', async () => {
  const files = await listUnitTests('all', { includeHeavy: true })
  const tagged = (
    await Promise.all(
      files.map(async (file) => ({
        file,
        source: await readFile(resolve(REPO_ROOT, file), 'utf8')
      }))
    )
  )
    .filter(({ source }) => /\bheavy\s*\(/.test(source))
    .map(({ file }) => file)
    .sort()
  const heavyFiles = await listHeavyUnitTests()

  expect(tagged).toHaveLength(10)
  expect(tagged.filter((file) => !isHeavyUnitTest(file))).toEqual([])
  expect(tagged.filter((file) => !heavyFiles.includes(file))).toEqual([])
})

test('root unit test scripts select heavy suites explicitly', async () => {
  const packageJSON = JSON.parse(await readFile(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }

  expect(packageJSON.scripts?.['test:unit']).toContain('BUN_HEAVY_TESTS=true')
  expect(packageJSON.scripts?.['test:unit']).toContain('./packages/motion/tests')
  expect(packageJSON.scripts?.['test:unit']).toContain('./packages/plugin-contracts/tests')
  expect(packageJSON.scripts?.['test:unit']).toContain('./packages/motion-runtime/tests')
  expect(packageJSON.scripts?.['test:unit:quick']).toContain('BUN_HEAVY_TESTS=false')
  expect(packageJSON.scripts?.['test:unit:quick']).toContain('tools/unit-tests/src/run.ts all')
  expect(packageJSON.scripts?.['test:unit:heavy']).toContain('BUN_HEAVY_TESTS=true')
  expect(packageJSON.scripts?.['test:unit:heavy']).toContain('--heavy-only')
})

test('scheduled heavy CI both selects and enables heavy suites', async () => {
  const workflow = await readFile(resolve(REPO_ROOT, '.github/workflows/heavy-tests.yml'), 'utf8')

  expect(workflow).toContain('list.ts all --heavy-only')
  expect(workflow).toContain("BUN_HEAVY_TESTS: 'true'")
})
