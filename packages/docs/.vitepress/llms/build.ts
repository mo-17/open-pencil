import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { LOCALE_PREFIXES } from '../locale-constants'
import { rootThemeConfig } from '../root-theme'
import { BASE } from '../seo'
import { generateLlmArtifacts, type LlmSidebar } from './generate'

function positiveIntegerEnvironmentValue(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer; received ${JSON.stringify(raw)}`)
  }
  return value
}

const docsDir = fileURLToPath(new URL('../..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const outDir = process.env.DOCS_OUT_DIR
  ? path.resolve(process.cwd(), process.env.DOCS_OUT_DIR)
  : path.resolve(docsDir, '.vitepress/dist')
const concurrency = positiveIntegerEnvironmentValue('DOCS_LLMS_CONCURRENCY', 2)

const result = await generateLlmArtifacts({
  docsDir,
  outDir,
  repoRoot,
  domain: BASE,
  localePrefixes: LOCALE_PREFIXES,
  sidebar: rootThemeConfig().sidebar as LlmSidebar,
  title: 'OpenPencil',
  description:
    'Open-source, AI-native design editor and toolkit. Opens Figma .fig files, provides a programmable scene graph, CLI, MCP server, and Vue SDK for custom editor shells.',
  details:
    'Use this file as the compact map for agents. For complete Markdown content, fetch https://openpencil.dev/llms-full.txt.',
  concurrency
})

process.stdout.write(
  `[docs:llms] Generated ${result.pages} pages and streamed ${(result.llmsFullTxtBytes / 1024 / 1024).toFixed(2)} MiB to llms-full.txt (concurrency=${concurrency})\n`
)
