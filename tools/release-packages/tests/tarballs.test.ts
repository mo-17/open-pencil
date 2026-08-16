import { afterEach, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import type { PreparedPublishPackage, PreparedPublishPlan } from '../src/publish-dirs'
import { PUBLISH_REPOSITORY_URL } from '../src/publish-dirs'
import {
  packageBinTargets,
  validatePackedTarballs,
  validatePublishedPackageJSON
} from '../src/tarballs'

const expected: PreparedPublishPackage = {
  dir: 'core',
  name: '@open-pencil-lowcode/core',
  version: '0.15.0'
}
const expectedRepository = PUBLISH_REPOSITORY_URL
const LICENSE_BYTES = Buffer.from('OpenPencil fixture license\n\0binary-safe\n')
const execFileAsync = promisify(execFile)
const fixtureRoots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = join(tmpdir(), `open-pencil-tarballs-${crypto.randomUUID()}`)
  fixtureRoots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

function expectedTarballName(pkg: PreparedPublishPackage): string {
  return `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`
}

async function writeTarballFixture(
  root: string,
  packageJSON: Record<string, unknown>,
  files: Record<string, string> = {}
): Promise<void> {
  const stagingRoot = join(root, 'staging')
  const packageRoot = join(stagingRoot, 'package')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(packageJSON, null, 2)}\n`)
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(packageRoot, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents)
  }
  await execFileAsync('tar', [
    '-czf',
    join(root, expectedTarballName(expected)),
    '-C',
    stagingRoot,
    'package'
  ])
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('packageBinTargets', () => {
  test('normalizes string bin fields', () => {
    expect(packageBinTargets({ name: '@open-pencil/cli', bin: './bin/openpencil.js' })).toEqual({
      '@open-pencil/cli': './bin/openpencil.js'
    })
  })

  test('keeps named bin fields', () => {
    expect(
      packageBinTargets({ name: '@open-pencil/cli', bin: { openpencil: './bin/openpencil.js' } })
    ).toEqual({
      openpencil: './bin/openpencil.js'
    })
  })
})

describe('validatePublishedPackageJSON', () => {
  test('accepts mapped release metadata without workspace lifecycle fields', () => {
    expect(() =>
      validatePublishedPackageJSON(
        {
          name: expected.name,
          version: expected.version,
          repository: { url: expectedRepository },
          dependencies: { '@open-pencil-lowcode/motion': '^0.15.0' }
        },
        expected,
        expectedRepository
      )
    ).not.toThrow()
  })

  test('rejects lifecycle fields and source-scope dependencies', () => {
    expect(() =>
      validatePublishedPackageJSON(
        {
          name: expected.name,
          version: expected.version,
          repository: expectedRepository,
          scripts: { postinstall: 'danger' },
          dependencies: { '@open-pencil/compiler': '^0.15.0' }
        },
        expected,
        expectedRepository
      )
    ).toThrow(`${expected.name}: tarball must not contain scripts`)
  })

  test('rejects identity, repository, workspace protocol, and source-scope dependency drift', () => {
    expect(() =>
      validatePublishedPackageJSON(
        { name: expected.name, version: '9.9.9', repository: expectedRepository },
        expected,
        expectedRepository
      )
    ).toThrow('tarball identity mismatch')
    expect(() =>
      validatePublishedPackageJSON(
        { name: expected.name, version: expected.version, repository: 'https://example.com/evil' },
        expected,
        expectedRepository
      )
    ).toThrow('tarball repository does not point to')
    expect(() =>
      validatePublishedPackageJSON(
        {
          name: expected.name,
          version: expected.version,
          repository: expectedRepository,
          dependencies: { '@open-pencil-lowcode/motion': 'workspace:*' }
        },
        expected,
        expectedRepository
      )
    ).toThrow('retains workspace:*')
    expect(() =>
      validatePublishedPackageJSON(
        {
          name: expected.name,
          version: expected.version,
          repository: expectedRepository,
          dependencies: { '@open-pencil/compiler': '^0.15.0' }
        },
        expected,
        expectedRepository
      )
    ).toThrow('retains source scope dependency @open-pencil/compiler')
  })
})

describe('validatePackedTarballs', () => {
  test('rejects release-plan repository and package-version drift before trusting filenames', async () => {
    const root = await fixtureRoot()

    await expect(
      validatePackedTarballs(
        root,
        {
          packages: [expected],
          repository: 'git+https://github.com/example/evil.git',
          version: expected.version
        },
        LICENSE_BYTES
      )
    ).rejects.toThrow(`Release plan repository must be ${PUBLISH_REPOSITORY_URL}`)
    await expect(
      validatePackedTarballs(
        root,
        {
          packages: [{ ...expected, version: '9.9.9' }],
          repository: expectedRepository,
          version: expected.version
        },
        LICENSE_BYTES
      )
    ).rejects.toThrow('release plan package version 9.9.9 does not match 0.15.0')
  })

  test('rejects a missing or incomplete tarball set', async () => {
    const root = await fixtureRoot()
    const plan: PreparedPublishPlan = {
      packages: [expected],
      repository: expectedRepository,
      version: expected.version
    }

    await expect(validatePackedTarballs(root, plan, LICENSE_BYTES)).rejects.toThrow(
      'Packed tarball set mismatch'
    )
  })

  test('accepts an exact audited tarball set and scans every packed file', async () => {
    const root = await fixtureRoot()
    const plan: PreparedPublishPlan = {
      packages: [expected],
      repository: expectedRepository,
      version: expected.version
    }
    await writeTarballFixture(
      root,
      {
        name: expected.name,
        version: expected.version,
        repository: { type: 'git', url: expectedRepository },
        bin: { openpencil: './bin/openpencil.js' },
        dependencies: { '@open-pencil-lowcode/motion': '^0.15.0' }
      },
      {
        LICENSE: LICENSE_BYTES.toString(),
        'bin/openpencil.js': '#!/usr/bin/env node\n',
        'dist/index.js': "export const owner = '@open-pencil-lowcode/core'\n",
        'dist/io/formats/fig/export-worker.js': 'export {}\n',
        'dist/io/formats/fig/export.js':
          "new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' })\n",
        'dist/io/formats/fig/read.js':
          "new Worker(new URL('../../../kiwi/fig/parse/worker.js', import.meta.url), { type: 'module' })\n",
        'dist/io/formats/pen/read.js':
          "new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })\n",
        'dist/io/formats/pen/worker.js': 'export {}\n',
        'dist/kiwi/fig/parse/worker.js': 'export {}\n',
        'dist/runtime/load.js':
          "export const runtime = new URL('./runtime.wasm', import.meta.url)\n",
        'dist/runtime/runtime.wasm': '\0asm'
      }
    )

    await expect(
      validatePackedTarballs(root, plan, LICENSE_BYTES, [
        '@open-pencil/core',
        '@open-pencil/compiler'
      ])
    ).resolves.toBeUndefined()
  })

  test('rejects a missing or byte-different repository license', async () => {
    const plan: PreparedPublishPlan = {
      packages: [expected],
      repository: expectedRepository,
      version: expected.version
    }
    const missingRoot = await fixtureRoot()
    await writeTarballFixture(missingRoot, {
      name: expected.name,
      version: expected.version,
      repository: expectedRepository
    })
    await expect(validatePackedTarballs(missingRoot, plan, LICENSE_BYTES)).rejects.toThrow(
      'package/LICENSE is missing from tarball'
    )

    const changedRoot = await fixtureRoot()
    await writeTarballFixture(
      changedRoot,
      {
        name: expected.name,
        version: expected.version,
        repository: expectedRepository
      },
      { LICENSE: 'different license bytes\n' }
    )
    await expect(validatePackedTarballs(changedRoot, plan, LICENSE_BYTES)).rejects.toThrow(
      'package/LICENSE does not match repository LICENSE'
    )
  })

  test('rejects a forbidden workspace specifier hidden outside package metadata', async () => {
    const root = await fixtureRoot()
    const plan: PreparedPublishPlan = {
      packages: [expected],
      repository: expectedRepository,
      version: expected.version
    }
    await writeTarballFixture(
      root,
      {
        name: expected.name,
        version: expected.version,
        repository: expectedRepository
      },
      {
        LICENSE: LICENSE_BYTES.toString(),
        'dist/index.js': "export * from '@open-pencil/compiler'\n"
      }
    )

    await expect(
      validatePackedTarballs(root, plan, LICENSE_BYTES, ['@open-pencil/compiler'])
    ).rejects.toThrow('retained workspace package specifiers')
  })

  test('rejects a packed worker whose final resource target is missing', async () => {
    const root = await fixtureRoot()
    const plan: PreparedPublishPlan = {
      packages: [expected],
      repository: expectedRepository,
      version: expected.version
    }
    await writeTarballFixture(
      root,
      {
        name: expected.name,
        version: expected.version,
        repository: expectedRepository
      },
      {
        LICENSE: LICENSE_BYTES.toString(),
        'dist/io/formats/pen/read.js':
          "new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })\n"
      }
    )

    await expect(validatePackedTarballs(root, plan, LICENSE_BYTES)).rejects.toThrow(
      'dist/io/formats/pen/read.js:1:12: resource target is missing: dist/io/formats/pen/worker.js'
    )
  })
})
