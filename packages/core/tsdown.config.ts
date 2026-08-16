import { readFileSync } from 'node:fs'

import { defineConfig } from 'tsdown'
import type { Rolldown } from 'tsdown'

const packageJSON = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as {
  dependencies?: Record<string, string>
}

interface PublishedWorkerURL {
  ownerEntry: string
  sourceSpecifier: string
  publishedSpecifier: string
  workerEntry: string
}

export const CORE_PUBLISHED_WORKER_URLS = Object.freeze([
  {
    ownerEntry: 'src/io/formats/pen/read.ts',
    sourceSpecifier: './worker.ts',
    publishedSpecifier: './worker.js',
    workerEntry: 'src/io/formats/pen/worker.ts'
  },
  {
    ownerEntry: 'src/io/formats/fig/export.ts',
    sourceSpecifier: './export-worker.ts',
    publishedSpecifier: './export-worker.js',
    workerEntry: 'src/io/formats/fig/export-worker.ts'
  },
  {
    ownerEntry: 'src/io/formats/fig/read.ts',
    sourceSpecifier: '../../../kiwi/fig/parse/worker.ts',
    publishedSpecifier: '../../../kiwi/fig/parse/worker.js',
    workerEntry: 'src/kiwi/fig/parse/worker.ts'
  }
] as const satisfies readonly PublishedWorkerURL[])

export const PUBLISHED_WORKER_URL_PLUGIN_NAME = 'published-worker-urls'

function normalizedModuleID(id: string): string {
  return (id.split('?')[0] ?? id).replaceAll('\\', '/')
}

export function rewritePublishedWorkerURL(code: string, id: string): string | undefined {
  const normalizedID = normalizedModuleID(id)
  const target = CORE_PUBLISHED_WORKER_URLS.find(({ ownerEntry }) =>
    normalizedID.endsWith(`/${ownerEntry}`)
  )
  if (!target) return

  const occurrences = code.split(target.sourceSpecifier).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `Expected one ${target.sourceSpecifier} Worker URL in ${target.ownerEntry}, found ${occurrences}`
    )
  }
  // The extensions have equal length, so existing source-map offsets stay valid.
  return code.replace(target.sourceSpecifier, target.publishedSpecifier)
}

function publishedWorkerURLs(): Rolldown.Plugin {
  return {
    name: PUBLISHED_WORKER_URL_PLUGIN_NAME,
    transform(code, id) {
      const rewritten = rewritePublishedWorkerURL(code, id)
      return rewritten === undefined ? undefined : { code: rewritten, map: null }
    }
  }
}

function fontLicenseManifest(): Rolldown.Plugin {
  return {
    name: 'font-license-manifest',
    load(id) {
      if (!id.endsWith('/assets/font-licenses.json')) return
      const manifest = JSON.parse(readFileSync(id, 'utf8')) as unknown
      // Rolldown's unbundled JSON output currently emits dangling named exports for object keys.
      // This manifest is intentionally consumed through its default export only.
      return {
        code: `export default ${JSON.stringify(manifest)}`,
        moduleType: 'js'
      }
    }
  }
}

function rawText(): Rolldown.Plugin {
  return {
    name: 'raw-text',
    load(id) {
      if (id.endsWith('?raw')) {
        const path = id.slice(0, -'?raw'.length)
        return `export default ${JSON.stringify(readFileSync(path, 'utf8'))}`
      }
    },
    transform(code, id) {
      if (id.endsWith('.md')) {
        return { code: `export default ${JSON.stringify(code)}`, map: null }
      }
    }
  }
}

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.d.ts'],
  plugins: [fontLicenseManifest(), rawText(), publishedWorkerURLs()],
  unbundle: true,
  platform: 'neutral',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: './dist',
  deps: {
    neverBundle: [...Object.keys(packageJSON.dependencies ?? {}), /^node:/],
    onlyBundle: false
  }
})
