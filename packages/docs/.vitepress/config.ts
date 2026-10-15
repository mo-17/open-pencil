import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { transformerTwoslash } from '@shikijs/vitepress-twoslash'
import { createFileSystemTypesCache } from '@shikijs/vitepress-twoslash/cache-fs'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitepress'

import { ensureBrandAssets } from '@open-pencil/brand-tools'
import { ensureDemoDocument } from '@open-pencil/demo-tools'
import { landingPosterFingerprint } from '@open-pencil/landing-posters-tools/fingerprint'
import { appSourceConfig } from '@open-pencil/vite-config/app-source'

import { createCrossPartitionLinkFilter } from './build/partition-links'
import { landingPreloads } from './landing-head'
import {
  LOCALE_PREFIXES,
  isLocalizedDocsLocale,
  resolveDocsBuildLocales,
  type DocsLocale
} from './locale-constants'
import { docsLocalesFor } from './locales'
import { rootThemeConfig } from './root-theme'
import { BASE, applyPageSeo, siteHead, withAlternateSitemapLinks } from './seo'

await Promise.all([ensureBrandAssets(['docs']), ensureDemoDocument()])

const configDir = dirname(fileURLToPath(import.meta.url))
const docsRoot = dirname(configDir)
const packagesRoot = dirname(docsRoot)
const repoRoot = dirname(packagesRoot)
// The landing page mounts the app's own components, compiled from source.
const appSource = appSourceConfig()
const fastBuild = process.env.OPENPENCIL_DOCS_FAST_BUILD === '1'
// Production builds show stills of the landing's stages until they are live. The build names
// the stills by this fingerprint, and `tools/generate/landing-posters` captures them afterwards.
const posterFingerprint =
  process.env.OPENPENCIL_LANDING_POSTERS === '1' ? await landingPosterFingerprint(repoRoot) : null

function positiveIntegerEnvironmentValue(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer; received ${JSON.stringify(raw)}`)
  }
  return value
}

function sourceExcludesForPartition(): string[] | undefined {
  const partition = process.env.DOCS_BUILD_LOCALE
  if (partition === undefined) {
    return LOCALE_PREFIXES.filter((locale) => !enabledLocalePrefixSet.has(locale)).map(
      (locale) => `${locale}/**`
    )
  }
  if (partition !== 'en' && !isLocalizedDocsLocale(partition)) {
    throw new Error(`DOCS_BUILD_LOCALE must be en or one of ${LOCALE_PREFIXES.join(', ')}`)
  }
  if (!docsBuildLocales.includes(partition as DocsLocale)) {
    throw new Error(`DOCS_BUILD_LOCALE ${partition} must also be enabled by DOCS_LOCALES`)
  }
  if (partition === 'en') return LOCALE_PREFIXES.map((locale) => `${locale}/**`)

  return readdirSync(docsRoot, { withFileTypes: true })
    .filter((entry) => entry.name !== partition && entry.name !== '.vitepress')
    .map((entry) => (entry.isDirectory() ? `${entry.name}/**` : entry.name))
}

const enableTwoslash = process.env.DOCS_TWOSLASH !== '0'
const docsBuildLocales = resolveDocsBuildLocales(process.env.DOCS_LOCALES)
const docsBuildLocale = process.env.DOCS_BUILD_LOCALE
const enabledLocalePrefixSet = new Set(docsBuildLocales.filter(isLocalizedDocsLocale))
const themeConfig = rootThemeConfig()
if (process.env.DOCS_LOCAL_SEARCH === '0') themeConfig.search = undefined

export default defineConfig({
  title: 'OpenPencil',
  description:
    'Open-source, AI-native design editor. Figma alternative built from scratch with full .fig file compatibility.',
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',
  // VitePress defaults to 64 concurrent page renders. Keep the locale working
  // set deterministic and bounded unless the operator has measured more headroom.
  buildConcurrency: positiveIntegerEnvironmentValue('DOCS_BUILD_CONCURRENCY', 1),
  srcExclude: sourceExcludesForPartition(),
  ignoreDeadLinks: docsBuildLocale
    ? [
        createCrossPartitionLinkFilter({
          docsRoot,
          partition: docsBuildLocale,
          localePrefixes: LOCALE_PREFIXES,
          enabledPartitions: docsBuildLocales
        })
      ]
    : undefined,
  outDir: process.env.DOCS_OUT_DIR,
  cacheDir: process.env.DOCS_CACHE_DIR,

  sitemap: {
    hostname: BASE,
    transformItems: (items) => withAlternateSitemapLinks(items, docsBuildLocales)
  },

  head: siteHead,

  transformPageData(pageData) {
    applyPageSeo(pageData, docsBuildLocales)
    if (posterFingerprint && pageData.frontmatter.landing === true) {
      pageData.frontmatter.posters = posterFingerprint
    }
  },
  transformHead: landingPreloads,

  markdown: {
    config(md) {
      const renderInlineCode = md.renderer.rules.code_inline
      if (!renderInlineCode) throw new Error('Markdown inline code renderer is unavailable')
      md.renderer.rules.code_inline = (tokens, index, options, env: unknown, renderer) => {
        if (
          typeof env === 'object' &&
          env !== null &&
          'relativePath' in env &&
          env.relativePath === 'reference/design-authoring.md'
        ) {
          tokens[index]?.attrSet('v-pre', '')
        }
        return renderInlineCode(tokens, index, options, env, renderer)
      }
    },
    codeTransformers: enableTwoslash
      ? [
          transformerTwoslash({
            typesCache: createFileSystemTypesCache({
              dir: resolve(configDir, 'cache/twoslash')
            }),
            twoslashOptions: {
              compilerOptions: {
                baseUrl: repoRoot,
                paths: {
                  '@open-pencil/vue': ['packages/vue/src/index.ts'],
                  '#vue/*': ['packages/vue/src/*']
                }
              }
            }
          })
        ]
      : []
  },

  vite: {
    resolve: {
      alias: [
        { find: '#docs-api', replacement: resolve(docsRoot, 'programmable/sdk/api') },
        { find: '#docs', replacement: configDir },
        { find: '#docs-examples', replacement: resolve(repoRoot, 'examples') },
        ...appSource.alias
      ]
    },
    define: appSource.define,
    build: { minify: fastBuild ? false : 'esbuild' },
    worker: { format: 'es' },
    plugins: [...appSource.plugins, tailwindcss()]
  },

  locales: docsLocalesFor(docsBuildLocales),

  themeConfig
})
