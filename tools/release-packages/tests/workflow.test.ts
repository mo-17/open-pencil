import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildReleasePackages,
  createPublicationPlan,
  prepareReleasePackages,
  releasePaths,
  validatePublicationArtifacts
} from '../src/workflow'

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
