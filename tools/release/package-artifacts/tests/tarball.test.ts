import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  inspectTarball,
  packageBinTargets,
  packageExportTargetPaths
} from '#package-artifacts/tarball'
import { createTarGzip } from 'nanotar'

describe('tarball metadata', () => {
  test('normalizes string and named binaries', () => {
    expect(packageBinTargets({ name: 'example', version: '1', bin: './cli.js' })).toEqual({
      example: './cli.js'
    })
    expect(
      packageBinTargets({ name: 'example', version: '1', bin: { other: './other.js' } })
    ).toEqual({ other: './other.js' })
  })

  test('collects targets across multiple subpaths', () => {
    expect(
      packageExportTargetPaths({
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
          './feature': { import: './dist/feature.js' }
        }
      })
    ).toEqual(['./dist/index.d.ts', './dist/index.js', './dist/feature.js'])
  })

  test('collects nested and wildcard export targets', () => {
    expect(
      packageExportTargetPaths({
        exports: {
          './feature/*': { types: './dist/*.d.ts', import: ['./dist/*.js', null] }
        }
      })
    ).toEqual(['./dist/*.d.ts', './dist/*.js'])
  })
})

describe('inspectTarball', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    )
  })

  /** Build the archive in-process, so the test never depends on a tar executable. */
  async function createTarball(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'open-pencil-tarball-'))
    temporaryDirectories.push(root)
    const tarball = join(root, 'package.tgz')
    await writeFile(
      tarball,
      await createTarGzip(
        Object.entries(files).map(([file, data]) => ({ name: `package/${file}`, data }))
      )
    )
    return tarball
  }

  const manifest = (bunTarget: string) =>
    JSON.stringify({
      name: '@fixture/resolution',
      version: '1.0.0',
      exports: { '.': { bun: bunTarget, import: './dist/index.js' } }
    })

  test('reads entries and the manifest without a tar executable', async () => {
    const tarball = await createTarball({
      'package.json': manifest('./dist/index.js'),
      'dist/index.js': 'export const ready = true\n'
    })
    const inspection = await inspectTarball(tarball)
    expect(inspection.manifest.name).toBe('@fixture/resolution')
    expect([...inspection.entries].sort()).toEqual([
      'package/dist/index.js',
      'package/package.json'
    ])
    expect(inspection.diagnostics).toEqual([])
  })

  test('reports export conditions whose targets were not packed', async () => {
    const tarball = await createTarball({
      'package.json': manifest('./src/index.ts'),
      'dist/index.js': 'export const ready = true\n'
    })
    expect((await inspectTarball(tarball)).diagnostics).toEqual([
      {
        field: 'exports["."].bun',
        message: 'target is missing (./src/index.ts)',
        packageName: '@fixture/resolution',
        tarballPath: tarball
      }
    ])
  })

  test('validates every conditional package import target against packed files', async () => {
    const tarball = await createTarball({
      'package.json': JSON.stringify({
        name: '@fixture/resolution',
        version: '1.0.0',
        imports: {
          '#fixture/*': { types: './src/*.ts', bun: './src/*.ts', default: './dist/*.js' }
        }
      }),
      'src/value.ts': 'export const ready = true\n',
      'dist/value.js': 'export const ready = true\n'
    })
    expect((await inspectTarball(tarball)).diagnostics).toEqual([])
  })

  test('rejects missing, external, escaping, and invalid package import mappings', async () => {
    const tarball = await createTarball({
      'package.json': JSON.stringify({
        name: '@fixture/resolution',
        version: '1.0.0',
        imports: {
          '#missing/*': './missing/*.ts',
          '#private': '@open-pencil/compiler',
          '#escape': './../outside.js',
          '#encoded-escape': './%2e%2e/outside.js',
          '#/invalid': './dist/index.js'
        }
      }),
      'dist/index.js': 'export {}\n',
      '%2e%2e/outside.js': 'export {}\n'
    })
    const diagnostics = (await inspectTarball(tarball)).diagnostics
    expect(diagnostics.map(({ field, message }) => ({ field, message }))).toEqual([
      { field: 'imports["#missing/*"]', message: 'target is missing (./missing/*.ts)' },
      {
        field: 'imports["#private"]',
        message: 'target must be package-relative (@open-pencil/compiler)'
      },
      { field: 'imports["#escape"]', message: 'target is missing (./../outside.js)' },
      {
        field: 'imports["#encoded-escape"]',
        message: 'target is missing (./%2e%2e/outside.js)'
      },
      { field: 'imports["#/invalid"]', message: 'invalid package import specifier' }
    ])
  })

  test('rejects archives without a package manifest', async () => {
    const tarball = await createTarball({ 'dist/index.js': 'export {}\n' })
    await expect(inspectTarball(tarball)).rejects.toThrow('package/package.json is missing')
  })
})
