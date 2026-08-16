import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

const CORE_ROOT = fileURLToPath(new URL('../../../../packages/core/', import.meta.url))
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

  test('wires the fail-closed rewrite into the unbundled core build without publishing src', async () => {
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

    const packageJSON = JSON.parse(await readFile(join(CORE_ROOT, 'package.json'), 'utf8')) as {
      files?: string[]
    }
    expect(packageJSON.files).toContain('dist')
    expect(packageJSON.files).not.toContain('src')
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
