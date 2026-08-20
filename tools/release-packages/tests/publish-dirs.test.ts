import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import {
  DEFAULT_PACKAGES,
  PREPARED_PUBLISH_PLAN,
  PUBLIC_PACKAGE_NAME_MAP,
  PUBLISH_REPOSITORY_URL,
  preparePublishDirectories,
  publishPackageJSON,
  remapPublicPackageSpecifiersInText
} from '../src/publish-dirs'
import type { PreparedPublishPlan } from '../src/publish-dirs'

const VERSION = '0.13.2'
const LICENSE_BYTES = Buffer.from('OpenPencil fixture license\n\0binary-safe\n')
const fixtureRoots: string[] = []

async function writeJSON(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function fixtureRoot(): Promise<string> {
  const root = join(tmpdir(), `open-pencil-release-packages-${crypto.randomUUID()}`)
  fixtureRoots.push(root)

  const publicWorkspaces = DEFAULT_PACKAGES.map((pkg) => pkg.dir)
  const workspaces = [...publicWorkspaces, 'packages/compiler']
  await mkdir(root, { recursive: true })
  await writeJSON(join(root, 'package.json'), { version: VERSION, workspaces })
  await writeFile(join(root, 'LICENSE'), LICENSE_BYTES)

  for (const packageDir of publicWorkspaces) {
    const packageName = `@open-pencil/${basename(packageDir)}`
    const manifest: Record<string, unknown> = { name: packageName, version: VERSION }
    if (packageName === '@open-pencil/core') {
      Object.assign(manifest, {
        description: 'Use @open-pencil/core/motion with @open-pencil/yoga-layout.',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            bun: './src/index.ts',
            import: './dist/index.js'
          }
        },
        imports: { '#core/*': './src/*' },
        scripts: { build: 'tsdown' },
        dependencies: {
          '@open-pencil/motion': 'workspace:*',
          '@open-pencil/yoga-layout': '^3.0.0'
        },
        devDependencies: { '@open-pencil/compiler': 'workspace:*' },
        peerDependencies: { '@open-pencil/plugin-contracts': 'workspace:^' },
        optionalDependencies: { '@open-pencil/fig': 'workspace:*' },
        peerDependenciesMeta: { '@open-pencil/plugin-contracts': { optional: true } },
        publishConfig: {
          access: 'public',
          main: './dist/index.js',
          provenance: true,
          types: './dist/index.d.ts'
        },
        repository: {
          directory: 'packages/core',
          type: 'git',
          url: 'git+https://github.com/open-pencil/open-pencil.git'
        }
      })
    }
    await mkdir(join(root, packageDir), { recursive: true })
    await writeJSON(join(root, packageDir, 'package.json'), manifest)
  }

  await mkdir(join(root, 'packages/compiler'), { recursive: true })
  await writeJSON(join(root, 'packages/compiler/package.json'), {
    name: '@open-pencil/compiler',
    private: true,
    version: VERSION
  })

  await mkdir(join(root, 'packages/scene-graph/dist'), { recursive: true })
  await writeFile(
    join(root, 'packages/scene-graph/dist/index.js'),
    "import '@open-pencil/core/motion'\nexport const yoga = '@open-pencil/yoga-layout'\n"
  )
  await writeJSON(join(root, 'packages/scene-graph/dist/index.js.map'), {
    sources: ['../src/index.ts'],
    sourcesContent: ["export * from '@open-pencil/motion'\n"]
  })
  await writeFile(
    join(root, 'packages/scene-graph/README.md'),
    '# @open-pencil/scene-graph\n\nWorks with @open-pencil/yoga-layout.\n'
  )

  const coreRuntimeFiles = {
    'dist/io/formats/fig/export-worker.js': 'export {}\n',
    'dist/io/formats/fig/export.js':
      "new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' })\n",
    'dist/io/formats/fig/read.js':
      "new Worker(new URL('../../../kiwi/fig/parse/worker.js', import.meta.url), { type: 'module' })\n",
    'dist/io/formats/pen/read.js':
      "new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })\n",
    'dist/io/formats/pen/worker.js': 'export {}\n',
    'dist/kiwi/fig/parse/worker.js': 'export {}\n'
  }
  for (const [path, contents] of Object.entries(coreRuntimeFiles)) {
    const destination = join(root, 'packages/core', path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents)
  }
  await mkdir(join(root, 'packages/motion/dist/runtime'), { recursive: true })
  await writeFile(
    join(root, 'packages/motion/dist/runtime/load.js'),
    "export const runtime = new URL('./runtime.wasm', import.meta.url)\n"
  )
  await writeFile(
    join(root, 'packages/motion/dist/runtime/runtime.wasm'),
    new Uint8Array([0, 97, 115, 109])
  )
  return root
}

async function readJSON<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('publishPackageJSON', () => {
  test('maps package metadata and exact workspace dependency keys', () => {
    const json = publishPackageJSON(
      {
        name: '@open-pencil/core',
        private: true,
        description: 'Use @open-pencil/core/motion with @open-pencil/yoga-layout.',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            bun: './src/index.ts',
            import: './dist/index.js'
          }
        },
        imports: { '#core/*': './src/*' },
        scripts: { build: 'tsdown' },
        dependencies: {
          '@open-pencil/motion': 'workspace:*',
          '@open-pencil/yoga-layout': '^3.0.0'
        },
        devDependencies: { typescript: '^5.0.0' },
        peerDependencies: { '@open-pencil/plugin-contracts': 'workspace:^' },
        optionalDependencies: { '@open-pencil/fig': 'workspace:*' },
        peerDependenciesMeta: { '@open-pencil/plugin-contracts': { optional: true } },
        publishConfig: { access: 'public', main: './dist/index.js', types: './dist/index.d.ts' },
        repository: { directory: 'packages/core' }
      },
      VERSION
    )

    expect(json).toEqual({
      name: '@open-pencil-lowcode/core',
      description: 'Use @open-pencil-lowcode/core/motion with @open-pencil/yoga-layout.',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js'
        }
      },
      dependencies: {
        '@open-pencil-lowcode/motion': `^${VERSION}`,
        '@open-pencil/yoga-layout': '^3.0.0'
      },
      peerDependencies: { '@open-pencil-lowcode/plugin-contracts': `^${VERSION}` },
      optionalDependencies: { '@open-pencil-lowcode/fig': `^${VERSION}` },
      peerDependenciesMeta: { '@open-pencil-lowcode/plugin-contracts': { optional: true } },
      main: './dist/index.js',
      types: './dist/index.d.ts',
      repository: {
        directory: 'packages/core',
        type: 'git',
        url: PUBLISH_REPOSITORY_URL
      }
    })
  })

  test('does not wildcard-rewrite external or similarly prefixed package names', () => {
    expect(
      remapPublicPackageSpecifiersInText(
        '@open-pencil/core @open-pencil/core/motion @open-pencil/core-extra @open-pencil/yoga-layout'
      )
    ).toBe(
      '@open-pencil-lowcode/core @open-pencil-lowcode/core/motion @open-pencil/core-extra @open-pencil/yoga-layout'
    )
  })

  test('rejects publishConfig attempts to override protected identity or lifecycle fields', () => {
    expect(() =>
      publishPackageJSON(
        {
          name: '@open-pencil/core',
          version: VERSION,
          publishConfig: {
            name: '@open-pencil-lowcode/evil',
            private: true,
            scripts: { postinstall: 'danger' },
            version: '9.9.9'
          }
        },
        VERSION
      )
    ).toThrow('@open-pencil/core: publishConfig cannot override protected field name')
  })
})

describe('DEFAULT_PACKAGES', () => {
  test('has an exact one-to-one mapping for every published workspace', () => {
    expect(DEFAULT_PACKAGES.map((pkg) => pkg.dir)).toEqual([
      'packages/scene-graph',
      'packages/motion',
      'packages/plugin-contracts',
      'packages/lowcode',
      'packages/pen',
      'packages/kiwi',
      'packages/fig',
      'packages/core',
      'packages/motion-runtime',
      'packages/dom-css',
      'packages/mcp',
      'packages/harness',
      'packages/vue',
      'packages/cli'
    ])
    expect(Object.keys(PUBLIC_PACKAGE_NAME_MAP)).toHaveLength(DEFAULT_PACKAGES.length)
    expect(Object.values(PUBLIC_PACKAGE_NAME_MAP) as string[]).toEqual(
      DEFAULT_PACKAGES.map((pkg) => `@open-pencil-lowcode/${basename(pkg.dir)}`)
    )
  })
})

describe('preparePublishDirectories', () => {
  test('remaps copied dist, source map, source, README, and manifest text', async () => {
    const root = await fixtureRoot()
    const outRoot = join(root, '.publish')

    await preparePublishDirectories({
      coreVersion: VERSION,
      outRoot,
      packages: DEFAULT_PACKAGES,
      root
    })

    expect(await readFile(join(outRoot, 'scene-graph/dist/index.js'), 'utf8')).toBe(
      "import '@open-pencil-lowcode/core/motion'\nexport const yoga = '@open-pencil/yoga-layout'\n"
    )
    expect(
      await readJSON<{ sources: string[]; sourcesContent: string[] }>(
        join(outRoot, 'scene-graph/dist/index.js.map')
      )
    ).toEqual({
      sources: ['../src/index.ts'],
      sourcesContent: ["export * from '@open-pencil-lowcode/motion'\n"]
    })
    expect(await readFile(join(outRoot, 'scene-graph/README.md'), 'utf8')).toBe(
      '# @open-pencil-lowcode/scene-graph\n\nWorks with @open-pencil/yoga-layout.\n'
    )
    const coreManifest = await readJSON<Record<string, unknown>>(join(outRoot, 'core/package.json'))
    expect(coreManifest.name).toBe('@open-pencil-lowcode/core')
    expect(coreManifest.imports).toBeUndefined()
    expect(JSON.stringify(coreManifest.exports)).not.toContain('"bun"')
    expect(coreManifest.repository).toEqual({
      directory: 'packages/core',
      type: 'git',
      url: PUBLISH_REPOSITORY_URL
    })
    expect(await readJSON<PreparedPublishPlan>(join(outRoot, PREPARED_PUBLISH_PLAN))).toEqual({
      packages: DEFAULT_PACKAGES.map((pkg) => ({
        dir: basename(pkg.dir),
        name: `@open-pencil-lowcode/${basename(pkg.dir)}`,
        version: VERSION
      })),
      repository: PUBLISH_REPOSITORY_URL,
      version: VERSION
    })
    for (const pkg of DEFAULT_PACKAGES) {
      expect(await readFile(join(outRoot, basename(pkg.dir), 'LICENSE'))).toEqual(LICENSE_BYTES)
    }
  })

  test('rejects a public manifest dependency on a private workspace', async () => {
    const root = await fixtureRoot()
    const manifestPath = join(root, 'packages/cli/package.json')
    const manifest = await readJSON<Record<string, unknown>>(manifestPath)
    manifest.dependencies = { '@open-pencil/compiler': 'workspace:*' }
    await writeJSON(manifestPath, manifest)

    await expect(
      preparePublishDirectories({ coreVersion: VERSION, packages: DEFAULT_PACKAGES, root })
    ).rejects.toThrow(
      '@open-pencil/cli: dependencies must not reference private workspace @open-pencil/compiler'
    )
  })

  test('rejects a newly added public workspace without an explicit publish mapping', async () => {
    const root = await fixtureRoot()
    const rootManifestPath = join(root, 'package.json')
    const rootManifest = await readJSON<{ version: string; workspaces: string[] }>(rootManifestPath)
    rootManifest.workspaces.push('packages/new-public')
    await writeJSON(rootManifestPath, rootManifest)
    await mkdir(join(root, 'packages/new-public'), { recursive: true })
    await writeJSON(join(root, 'packages/new-public/package.json'), {
      name: '@open-pencil/new-public',
      version: VERSION
    })

    await expect(
      preparePublishDirectories({ coreVersion: VERSION, packages: DEFAULT_PACKAGES, root })
    ).rejects.toThrow('Public workspace has no publish-name mapping: @open-pencil/new-public')
  })

  test('rejects copied output that retains any private workspace specifier', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'packages/cli/dist'), { recursive: true })
    await writeJSON(join(root, 'packages/cli/dist/index.mjs.map'), {
      sources: ['../src/index.ts'],
      sourcesContent: ["export * from '@open-pencil/compiler'\n"]
    })

    await expect(
      preparePublishDirectories({ coreVersion: VERSION, packages: DEFAULT_PACKAGES, root })
    ).rejects.toThrow(
      'Published output contains unreplaced workspace package specifiers:\ncli/dist/index.mjs.map: @open-pencil/compiler'
    )
  })

  test('rejects a prepared worker whose final resource target is missing', async () => {
    const root = await fixtureRoot()
    await rm(join(root, 'packages/core/dist/io/formats/pen/worker.js'))

    await expect(
      preparePublishDirectories({ coreVersion: VERSION, packages: DEFAULT_PACKAGES, root })
    ).rejects.toThrow(
      'dist/io/formats/pen/read.js:1:12: resource target is missing: dist/io/formats/pen/worker.js'
    )
  })

  test('rejects a prepared non-worker URL whose final resource target is missing', async () => {
    const root = await fixtureRoot()
    await rm(join(root, 'packages/motion/dist/runtime/runtime.wasm'))

    await expect(
      preparePublishDirectories({ coreVersion: VERSION, packages: DEFAULT_PACKAGES, root })
    ).rejects.toThrow(
      'dist/runtime/load.js:1:24: resource target is missing: dist/runtime/runtime.wasm'
    )
  })
})
