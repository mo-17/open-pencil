import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as v from 'valibot'

import { parseWorkspacePackageJSON } from '@open-pencil/package-artifacts-tools'
import {
  discoverPublishPackages,
  publishPackageJSON
} from '@open-pencil/release-packages-tools/publish-dirs'

import { repoPath } from '#tests/helpers/paths'

const corePackageSchema = v.looseObject({
  name: v.string(),
  version: v.string(),
  files: v.array(v.string()),
  exports: v.record(v.string(), v.union([v.string(), v.record(v.string(), v.string())])),
  imports: v.optional(v.record(v.string(), v.union([v.string(), v.record(v.string(), v.string())])))
})

type CorePackageJSON = v.InferOutput<typeof corePackageSchema>

interface PublishedWorkerURL {
  ownerEntry: string
  sourceSpecifier: string
  publishedSpecifier: string
  workerEntry: string
}

interface CoreBuildConfigModule {
  CORE_PUBLISHED_WORKER_URLS: readonly PublishedWorkerURL[]
  PUBLISHED_WORKER_URL_PLUGIN_NAME: string
  default: { entry?: unknown; plugins?: unknown }
  rewritePublishedWorkerURL(code: string, id: string): string | undefined
}

const CORE_ROOT = repoPath('packages/core')
const {
  CORE_PUBLISHED_WORKER_URLS,
  PUBLISHED_WORKER_URL_PLUGIN_NAME,
  default: coreBuildConfig,
  rewritePublishedWorkerURL
} = (await import(pathToFileURL(join(CORE_ROOT, 'tsdown.config.ts')).href)) as CoreBuildConfigModule

describe('published core Worker URLs', () => {
  test('keeps Vite source URLs while rewriting published modules to emitted JavaScript', async () => {
    expect(CORE_PUBLISHED_WORKER_URLS).toHaveLength(3)

    for (const target of CORE_PUBLISHED_WORKER_URLS) {
      const ownerPath = join(CORE_ROOT, target.ownerEntry)
      const ownerSource = await readFile(ownerPath, 'utf8')
      const workerSource = await readFile(join(CORE_ROOT, target.workerEntry), 'utf8')

      expect(ownerSource).toContain(`new URL('${target.sourceSpecifier}', import.meta.url)`)
      expect(workerSource.length).toBeGreaterThan(0)

      const published = rewritePublishedWorkerURL(ownerSource, ownerPath)
      expect(published).toContain(`new URL('${target.publishedSpecifier}', import.meta.url)`)
      expect(published).not.toContain(target.sourceSpecifier)
    }
  })

  test('wires the fail-closed rewrite while keeping source and built export conditions distinct', async () => {
    const plugins: readonly unknown[] = Array.isArray(coreBuildConfig.plugins)
      ? coreBuildConfig.plugins
      : []
    expect(
      plugins.some(
        (plugin) =>
          typeof plugin === 'object' &&
          plugin !== null &&
          'name' in plugin &&
          plugin.name === PUBLISHED_WORKER_URL_PLUGIN_NAME
      )
    ).toBe(true)
    const entries: readonly unknown[] = Array.isArray(coreBuildConfig.entry)
      ? coreBuildConfig.entry
      : []
    expect(entries).toContain('src/**/*.ts')

    const packageJSON = v.parse(
      v.pipe(v.string(), v.parseJson(), corePackageSchema),
      await readFile(join(CORE_ROOT, 'package.json'), 'utf8')
    )
    expect(packageJSON.files).toContain('dist')
    expect(packageJSON.files).toContain('src')
    const sourceExports = Object.values(packageJSON.exports).filter(
      (entry): entry is Record<string, string> => typeof entry === 'object'
    )
    expect(sourceExports.some((entry) => entry.bun !== undefined)).toBe(true)
    for (const entry of sourceExports) {
      expect(entry.import).toMatch(/^\.\/dist\/.*\.js$/)
      expect(entry.default).toBe(entry.import)
      if (entry.bun !== undefined) {
        expect(entry.bun).toMatch(/^\.\/src\/.*\.ts$/)
        expect((await readFile(join(CORE_ROOT, entry.bun), 'utf8')).length).toBeGreaterThan(0)
      }
    }
  })

  test('retains runtime source imports and built exports while excluding test-only aliases', async () => {
    const packageJSON = v.parse(
      v.pipe(v.string(), v.parseJson(), corePackageSchema),
      await readFile(join(CORE_ROOT, 'package.json'), 'utf8')
    )
    const prepared = publishPackageJSON(
      parseWorkspacePackageJSON(JSON.stringify(packageJSON), 'core package fixture'),
      packageJSON.version
    )
    expect(prepared.name).toBe('@open-pencil-lowcode/core')
    const runtimeImports = { ...packageJSON.imports }
    expect(runtimeImports['#core/*']).toBe('./src/*.ts')
    delete runtimeImports['#core-tests/*']
    expect(prepared.imports).toEqual(runtimeImports)
    expect(prepared.imports).not.toHaveProperty('#core-tests/*')
    const preparedExports = prepared.exports as CorePackageJSON['exports']
    expect(Object.keys(preparedExports)).toEqual(Object.keys(packageJSON.exports))
    for (const [subpath, entry] of Object.entries(preparedExports)) {
      if (typeof entry === 'string') continue
      expect(entry.bun).toBe((packageJSON.exports[subpath] as Record<string, string>).bun)
      expect(entry.import).toMatch(/^\.\/dist\/.*\.js$/)
      expect(entry.default).toBe(entry.import)
      expect(entry.import).toBe((packageJSON.exports[subpath] as Record<string, string>).import)
    }

    const packages = await discoverPublishPackages(join(CORE_ROOT, '../..'))
    const core = packages.find((entry) => entry.dir === 'packages/core')
    expect(core).toBeDefined()
    expect(core?.include).toContain('dist')
    expect(core?.include).toContain('src')
  })

  test('rejects a missing or duplicated known Worker URL instead of publishing a broken path', () => {
    const target = CORE_PUBLISHED_WORKER_URLS[0]
    const ownerPath = join(CORE_ROOT, target.ownerEntry)
    expect(() => rewritePublishedWorkerURL('export {}', ownerPath)).toThrow('found 0')
    expect(() =>
      rewritePublishedWorkerURL(`${target.sourceSpecifier}\n${target.sourceSpecifier}`, ownerPath)
    ).toThrow('found 2')
    expect(
      rewritePublishedWorkerURL(target.sourceSpecifier, '/outside/core/read.ts')
    ).toBeUndefined()
  })
})
