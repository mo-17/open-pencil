import { describe, expect, test } from 'bun:test'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import {
  buildReleasePackages,
  createPublicationPlan,
  prepareReleasePackages,
  packReleasePackages,
  releasePaths,
  validatePublicationArtifacts
} from '#release/workflow'
import { createTarGzip } from 'nanotar'
import * as v from 'valibot'

import { parseWorkspacePackageJSON } from '@open-pencil/package-artifacts-tools'
import { readTarball } from '@open-pencil/package-artifacts-tools/tarball'

import { DEFAULT_PACKAGES, PUBLIC_PACKAGE_NAME_MAP } from '../src/publish-dirs'

const FIXTURE_FILES = ['dist/index.js', 'dist/index.d.ts']

async function listFiles(directory: string, base = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return listFiles(path, base)
      return [relative(base, path).split(sep).join('/')]
    })
  )
  return nested.flat().sort()
}

const ManifestJSON = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({ name: v.string(), version: v.string() })
)

/** Packs a prepared directory the way npm lays out a tarball, without starting npm. */
async function packInProcess(directory: string, destination: string): Promise<string> {
  const manifest = v.parse(ManifestJSON, await readFile(join(directory, 'package.json'), 'utf8'))
  const files = await Promise.all(
    (await listFiles(directory)).map(async (name) => ({
      name: `package/${name}`,
      data: new Uint8Array(await readFile(join(directory, name)))
    }))
  )
  const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
  await writeFile(join(destination, filename), await createTarGzip(files))
  return filename
}

async function createWorkspace() {
  const root = join(tmpdir(), `open-pencil-release-workflow-${crypto.randomUUID()}`)
  await mkdir(join(root, 'packages/library'), { recursive: true })
  await mkdir(join(root, 'packages/app'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ workspaces: ['packages/app', 'packages/library'] })
  )
  await writeFile(
    join(root, 'packages/library/package.json'),
    JSON.stringify({
      name: '@fixture/library',
      version: '1.0.0',
      scripts: { build: "bun -e \"await Bun.write('../../order.txt', 'library')\"" }
    })
  )
  await writeFile(
    join(root, 'packages/app/package.json'),
    JSON.stringify({
      name: '@fixture/app',
      version: '1.0.0',
      dependencies: { '@fixture/library': 'workspace:*' },
      scripts: {
        build:
          "bun -e \"const previous = await Bun.file('../../order.txt').text(); await Bun.write('../../order.txt', previous + ',app')\""
      }
    })
  )
  return root
}

describe('release workflow', () => {
  test('uses conventional release artifact locations', () => {
    expect(releasePaths('/repo')).toEqual({
      root: '/repo',
      artifacts: '/repo/.npm-packages',
      prepared: '/repo/.publish'
    })
  })

  test('creates a dependency-ordered publication plan from registry results', async () => {
    const root = await createWorkspace()
    const plan = await createPublicationPlan(
      root,
      async ({ manifest }) => manifest.name === '@fixture/library'
    )
    expect(plan.map(({ package: pkg, status }) => ({ name: pkg.manifest.name, status }))).toEqual([
      { name: '@fixture/library', status: 'published' },
      { name: '@fixture/app', status: 'unpublished' }
    ])
  })

  test('rejects incomplete or stale artifact sets before publication', () => {
    const packageEntry = {
      directory: 'packages/example',
      manifest: { name: '@fixture/example', version: '1.0.0' }
    }
    expect(() =>
      validatePublicationArtifacts([{ package: packageEntry, status: 'unpublished' }], new Map())
    ).toThrow('Missing verified package artifact for @fixture/example@1.0.0')
    expect(() =>
      validatePublicationArtifacts(
        [{ package: packageEntry, status: 'published' }],
        new Map([['@fixture/example@1.0.0', '/artifact.tgz']])
      )
    ).not.toThrow()
    expect(() =>
      validatePublicationArtifacts([], new Map([['@fixture/unknown@1.0.0', '/artifact.tgz']]))
    ).toThrow('Unexpected package artifact for @fixture/unknown@1.0.0')
  })

  test('refuses an unmapped public workspace before preparing publication artifacts', async () => {
    const root = await createWorkspace()
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        workspaces: ['packages/app', 'packages/library']
      })
    )
    await expect(prepareReleasePackages(root)).rejects.toThrow(
      'Public workspace has no publish-name mapping'
    )
  })

  test('packs and validates an unpublished release artifact', async () => {
    const root = join(tmpdir(), `open-pencil-release-pack-${crypto.randomUUID()}`)
    await mkdir(join(root, 'packages/core/dist'), { recursive: true })
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', workspaces: ['packages/core'] })
    )
    await writeFile(join(root, 'packages/core/dist/index.js'), 'export const ready = true\n')
    await writeFile(join(root, 'LICENSE'), 'fixture license\n')
    await writeFile(
      join(root, 'packages/core/dist/index.d.ts'),
      'export declare const ready: true\n'
    )
    await writeFile(
      join(root, 'packages/core/package.json'),
      JSON.stringify({
        name: '@open-pencil/core',
        version: '1.0.0',
        files: ['dist'],
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
            default: './dist/index.js'
          }
        },
        devDependencies: { '@open-pencil/package-artifacts-tools': 'workspace:*' },
        publishConfig: { access: 'public' }
      })
    )

    const packageNames = Object.keys(PUBLIC_PACKAGE_NAME_MAP)
    for (const pkg of DEFAULT_PACKAGES) {
      if (pkg.dir === 'packages/core') continue
      const name = packageNames.find(
        (candidate) => candidate === `@open-pencil/${pkg.dir.split('/').at(-1)}`
      )
      if (!name) throw new Error(`Expected a publish name for ${pkg.dir}`)
      await mkdir(join(root, pkg.dir), { recursive: true })
      for (const file of pkg.extraFiles)
        await writeFile(join(root, pkg.dir, file), 'fixture notice\n')
      await writeFile(
        join(root, pkg.dir, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', private: false })
      )
    }
    const privateToolDirectory = 'tools/release/package-artifacts'
    await mkdir(join(root, privateToolDirectory), { recursive: true })
    await writeFile(
      join(root, privateToolDirectory, 'package.json'),
      JSON.stringify({ name: '@open-pencil/package-artifacts-tools', private: true })
    )
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        workspaces: [...DEFAULT_PACKAGES.map((pkg) => pkg.dir), privateToolDirectory]
      })
    )
    await prepareReleasePackages(root, {
      listPackageFiles: async (directory) =>
        directory.endsWith('/core')
          ? FIXTURE_FILES
          : (DEFAULT_PACKAGES.find((pkg) => directory.endsWith(`/${pkg.dir}`))?.extraFiles ?? [])
    })
    const sourceManifest = parseWorkspacePackageJSON(
      await readFile(join(root, 'packages/core/package.json'), 'utf8'),
      'packages/core'
    )
    const preparedManifest = parseWorkspacePackageJSON(
      await readFile(join(releasePaths(root).prepared, 'core/package.json'), 'utf8'),
      '.publish/core'
    )
    expect(sourceManifest.devDependencies).toEqual({
      '@open-pencil/package-artifacts-tools': 'workspace:*'
    })
    expect(preparedManifest.devDependencies).toBeUndefined()
    const plan = await packReleasePackages(
      root,
      async ({ manifest }) => manifest.name !== '@open-pencil-lowcode/core',
      {
        packDirectory: packInProcess
      }
    )
    expect(
      plan
        .filter(({ status }) => status === 'unpublished')
        .map(({ package: pkg, status }) => [pkg.manifest.name, status])
    ).toEqual([['@open-pencil-lowcode/core', 'unpublished']])
    const artifacts = releasePaths(root).artifacts
    const tarballs = (await readdir(artifacts)).filter((name) => name.endsWith('.tgz'))
    expect(tarballs).toHaveLength(DEFAULT_PACKAGES.length)
    expect(tarballs).toContain('open-pencil-lowcode-core-1.0.0.tgz')
    expect(
      [...(await readTarball(join(artifacts, 'open-pencil-lowcode-core-1.0.0.tgz'))).entries].sort()
    ).toEqual([
      'package/LICENSE',
      'package/dist/index.d.ts',
      'package/dist/index.js',
      'package/package.json'
    ])
  })

  test('builds discovered packages in dependency order', async () => {
    const root = await createWorkspace()
    const packages = await buildReleasePackages(root, { output: 'capture' })
    expect(packages.map(({ manifest }) => manifest.name)).toEqual([
      '@fixture/library',
      '@fixture/app'
    ])
    expect(await Bun.file(join(root, 'order.txt')).text()).toBe('library,app')
  })
})

test('publication lookup and plan use fork names instead of the upstream npm scope', async () => {
  const root = join(tmpdir(), `open-pencil-publication-map-${crypto.randomUUID()}`)
  await mkdir(join(root, 'packages/core'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/core'] }))
  await writeFile(
    join(root, 'packages/core/package.json'),
    JSON.stringify({
      name: '@open-pencil/core',
      version: '1.0.0',
      dependencies: { '@open-pencil/motion': 'workspace:*' }
    })
  )
  const queried: string[] = []
  const plan = await createPublicationPlan(root, async ({ manifest }) => {
    queried.push(manifest.name)
    return false
  })
  expect(queried).toEqual(['@open-pencil-lowcode/core'])
  expect(plan[0]?.package.manifest.dependencies).toEqual({
    '@open-pencil-lowcode/motion': '^1.0.0'
  })
})
