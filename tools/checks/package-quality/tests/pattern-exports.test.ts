import { afterEach, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  collectPatternExportChecks,
  verifyPatternExports
} from '#package-quality/smoke/pattern-exports'

import { CommandError, runCommand } from '@open-pencil/package-artifacts-tools'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(options: { missingAsset?: boolean; moduleFails?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'open-pencil-pattern-exports-'))
  roots.push(root)
  const packageDir = join(root, 'package')
  const consumer = join(root, 'consumer')
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: '@fixture/patterns',
      version: '1.0.0',
      type: 'module',
      files: ['node-assets', 'bun-assets', 'dist', 'src'],
      exports: {
        './assets/*': { bun: './bun-assets/*', default: './node-assets/*' },
        './run/*': { bun: './src/*.ts', default: './dist/*.js' }
      }
    }),
    'node-assets/value.txt': 'Node resource bytes',
    'src/probe.ts': options.moduleFails
      ? "throw new Error('pattern module executed')"
      : 'export const ready = true',
    'dist/probe.js': options.moduleFails
      ? "throw new Error('pattern module executed')"
      : 'export const ready = true'
  }
  if (!options.missingAsset) files['bun-assets/value.txt'] = 'Different Bun resource bytes'
  for (const [path, text] of Object.entries(files)) {
    const destination = join(packageDir, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, text)
  }
  const tarball = join(root, 'fixture-patterns-1.0.0.tgz')
  await runCommand({
    command: 'tar',
    args: ['-czf', tarball, '-C', root, 'package'],
    cwd: root
  })
  await mkdir(join(consumer, 'node_modules/@fixture'), { recursive: true })
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  await cp(packageDir, join(consumer, 'node_modules/@fixture/patterns'), { recursive: true })
  return { tarball, consumer }
}

test('checks every concrete pattern export with each runtime condition and packed bytes', async () => {
  const { tarball, consumer } = await fixture()
  const checks = await collectPatternExportChecks(tarball)
  expect(checks.map(({ specifier }) => specifier)).toEqual([
    '@fixture/patterns/assets/value.txt',
    '@fixture/patterns/run/probe'
  ])
  expect(checks[0]?.targets.map(({ path }) => path)).toEqual([
    'bun-assets/value.txt',
    'node-assets/value.txt'
  ])
  expect(checks[0]?.targets.map(({ sha256 }) => sha256)[0]).not.toBe(
    checks[0]?.targets.map(({ sha256 }) => sha256)[1]
  )
  await verifyPatternExports(checks, consumer)
})

for (const runtime of ['node', 'bun'] as const) {
  test(`rejects corruption in the installed ${runtime} resource`, async () => {
    const { tarball, consumer } = await fixture()
    const checks = await collectPatternExportChecks(tarball)
    await writeFile(
      join(consumer, 'node_modules/@fixture/patterns', `${runtime}-assets/value.txt`),
      'corrupted'
    )
    const error: unknown = await verifyPatternExports(checks, consumer).catch(
      (error: unknown) => error
    )
    expect(error).toBeInstanceOf(CommandError)
    if (!(error instanceof CommandError)) throw new Error('Expected runtime command rejection')
    expect(error.timedOut).toBe(false)
    expect(error.stderr).toContain('does not match packed bytes')
  })
}

test('rejects a conditional pattern target omitted from the tarball', async () => {
  const { tarball } = await fixture({ missingAsset: true })
  await expect(collectPatternExportChecks(tarball)).rejects.toThrow(
    'target is missing (./bun-assets/*)'
  )
})

test('executes pattern modules after resolving and verifying their bytes', async () => {
  const { tarball, consumer } = await fixture({ moduleFails: true })
  const checks = await collectPatternExportChecks(tarball)
  const error: unknown = await verifyPatternExports(checks, consumer).catch(
    (error: unknown) => error
  )
  expect(error).toBeInstanceOf(CommandError)
  if (!(error instanceof CommandError)) throw new Error('Expected module execution rejection')
  expect(error.timedOut).toBe(false)
  expect(error.stderr).toContain('pattern module executed')
})
