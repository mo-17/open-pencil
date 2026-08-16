import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { withCompilerBuildRoot } from '#cli/compiler-build-root'

async function writeJSON(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writePackage(root: string, name: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeJSON(join(root, 'package.json'), { name, version: '1.0.0', main: './index.js' })
  await writeFile(join(root, 'index.js'), `module.exports = ${JSON.stringify(name)}\n`)
}

async function fixture(dependencies: Record<string, string>): Promise<{
  buildRoots: string
  cliEntryURL: string
  cliRoot: string
  root: string
  userWorkspace: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'openpencil-cli-build-root-test-'))
  const cliRoot = join(root, 'install/node_modules/@open-pencil-lowcode/cli')
  const cliEntry = join(cliRoot, 'dist/index.mjs')
  const buildRoots = join(root, 'build-roots')
  const userWorkspace = join(root, 'user-workspace')
  await mkdir(join(cliRoot, 'dist'), { recursive: true })
  await mkdir(buildRoots, { recursive: true })
  await mkdir(userWorkspace, { recursive: true })
  await writeJSON(join(cliRoot, 'package.json'), {
    name: '@open-pencil-lowcode/cli',
    version: '1.0.0',
    dependencies
  })
  await writeFile(cliEntry, '')
  return { buildRoots, cliEntryURL: pathToFileURL(cliEntry).href, cliRoot, root, userWorkspace }
}

describe('bundled compiler build root', () => {
  test('resolves hoisted and nested CLI dependencies without writing the user workspace', async () => {
    const setup = await fixture({
      '@open-pencil-lowcode/core': '^1.0.0',
      '@scope/nested-runtime': '1.0.0',
      react: '1.0.0'
    })
    const hoistedReact = join(setup.root, 'install/node_modules/react')
    const nestedRuntime = join(setup.cliRoot, 'node_modules/@scope/nested-runtime')
    let temporaryRoot = ''
    try {
      await writePackage(hoistedReact, 'react')
      await writePackage(nestedRuntime, '@scope/nested-runtime')

      const result = await withCompilerBuildRoot(
        async (fsRoot) => {
          temporaryRoot = fsRoot
          expect(fsRoot.startsWith(`${setup.buildRoots}${sep}`)).toBe(true)
          expect(fsRoot.startsWith(`${setup.userWorkspace}${sep}`)).toBe(false)
          expect(JSON.parse(await readFile(join(fsRoot, 'package.json'), 'utf8'))).toEqual({
            name: 'openpencil-cli-compiler-build',
            private: true,
            type: 'module'
          })

          const scanRoot = join(fsRoot, 'packages/compiler/.preview-root/react')
          await mkdir(scanRoot, { recursive: true })
          expect(await realpath(join(fsRoot, 'node_modules/react'))).toBe(
            await realpath(hoistedReact)
          )
          expect(await realpath(join(fsRoot, 'node_modules/@scope/nested-runtime'))).toBe(
            await realpath(nestedRuntime)
          )
          expect(existsSync(join(scanRoot, '../../../..', 'node_modules/react/index.js'))).toBe(
            true
          )
          expect(
            existsSync(join(scanRoot, '../../../..', 'node_modules/@scope/nested-runtime/index.js'))
          ).toBe(true)
          return 'resolved'
        },
        { moduleURL: setup.cliEntryURL, temporaryDirectory: setup.buildRoots }
      )

      expect(result).toBe('resolved')
      expect(temporaryRoot).not.toBe('')
      expect(existsSync(temporaryRoot)).toBe(false)
      expect(await readdir(setup.userWorkspace)).toEqual([])
      expect(await readFile(join(hoistedReact, 'index.js'), 'utf8')).toContain('react')
      expect(await readFile(join(nestedRuntime, 'index.js'), 'utf8')).toContain('nested-runtime')
    } finally {
      await rm(setup.root, { recursive: true, force: true })
    }
  })

  test('cleans the temporary root when the compiler operation rejects', async () => {
    const setup = await fixture({ react: '1.0.0' })
    const hoistedReact = join(setup.root, 'install/node_modules/react')
    let temporaryRoot = ''
    try {
      await writePackage(hoistedReact, 'react')
      await expect(
        withCompilerBuildRoot(
          (fsRoot) => {
            temporaryRoot = fsRoot
            throw new Error('compiler failed')
          },
          { moduleURL: setup.cliEntryURL, temporaryDirectory: setup.buildRoots }
        )
      ).rejects.toThrow('compiler failed')
      expect(temporaryRoot).not.toBe('')
      expect(existsSync(temporaryRoot)).toBe(false)
      expect(existsSync(hoistedReact)).toBe(true)
    } finally {
      await rm(setup.root, { recursive: true, force: true })
    }
  })

  test('cleans a partially prepared root when an installed dependency is missing', async () => {
    const setup = await fixture({ missing: '1.0.0' })
    try {
      await expect(
        withCompilerBuildRoot(() => undefined, {
          moduleURL: setup.cliEntryURL,
          temporaryDirectory: setup.buildRoots
        })
      ).rejects.toThrow('OpenPencil CLI build dependency is not installed: missing')
      expect(await readdir(setup.buildRoots)).toEqual([])
      expect(await readdir(setup.userWorkspace)).toEqual([])
    } finally {
      await rm(setup.root, { recursive: true, force: true })
    }
  })
})
