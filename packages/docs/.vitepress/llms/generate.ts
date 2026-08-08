import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'

import matter from 'gray-matter'
import { remark } from 'remark'
import remarkFrontmatter from 'remark-frontmatter'
import { remove } from 'unist-util-remove'

export interface LlmSidebarItem {
  text?: string
  link?: string
  base?: string
  items?: LlmSidebarItem[]
}

export type LlmSidebar = LlmSidebarItem[] | Record<string, LlmSidebarItem[]>

export interface GenerateLlmArtifactsOptions {
  docsDir: string
  outDir: string
  repoRoot: string
  domain: string
  localePrefixes: readonly string[]
  sidebar?: LlmSidebar
  title: string
  description: string
  details: string
  concurrency?: number
}

export interface GenerateLlmArtifactsResult {
  pages: number
  llmsTxtPath: string
  llmsFullTxtPath: string
  llmsFullTxtBytes: number
}

interface PreparedPage {
  description?: string
  outputPath: string
  route: string
  title: string
}

const INCLUDE_DIRECTIVE = /<!--\s*@include:\s*(.+?)\s*-->/g
const INCLUDE_RANGE = /^(.*?)(?:\{(\d*),(\d*)\})$/
const EXCLUDED_DIRECTORIES = new Set(['.vitepress', 'node_modules', 'public'])

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function parseIncludeSpec(spec: string): { file: string; start?: number; end?: number } {
  const range = INCLUDE_RANGE.exec(spec.trim())
  const rawFile = (range?.[1] ?? spec).trim()
  const file = rawFile.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
  const start = range?.[2] ? Number(range[2]) : undefined
  const end = range?.[3] ? Number(range[3]) : undefined
  return { file, start, end }
}

function selectIncludedLines(content: string, start?: number, end?: number): string {
  if (start === undefined && end === undefined) return content
  const lines = content.split(/\r?\n/)
  const first = Math.max((start ?? 1) - 1, 0)
  const last = end === undefined ? lines.length : Math.max(end, first)
  return lines.slice(first, last).join('\n')
}

async function expandIncludes(
  content: string,
  sourcePath: string,
  repoRoot: string,
  stack: readonly string[] = []
): Promise<string> {
  const matches = [...content.matchAll(INCLUDE_DIRECTIVE)]
  if (matches.length === 0) return content

  let expanded = ''
  let offset = 0
  for (const match of matches) {
    const matchIndex = match.index
    if (matchIndex === undefined) continue
    expanded += content.slice(offset, matchIndex)

    const include = parseIncludeSpec(match[1] ?? '')
    const includePath = path.resolve(path.dirname(sourcePath), include.file)
    if (!isInside(repoRoot, includePath)) {
      throw new Error(`Refusing to include a file outside the repository: ${include.file}`)
    }
    if (stack.includes(includePath)) {
      const cycle = [...stack, includePath]
        .map((file) => path.relative(repoRoot, file))
        .join(' -> ')
      throw new Error(`Circular Markdown include detected: ${cycle}`)
    }

    const included = await readFile(includePath, 'utf8')
    const selected = selectIncludedLines(included, include.start, include.end)
    expanded += await expandIncludes(selected, includePath, repoRoot, [...stack, includePath])
    offset = matchIndex + match[0].length
  }
  return expanded + content.slice(offset)
}

function prepareLlmTags(content: string): string {
  return content
    .replace(/<llm-only(?:\s[^>]*)?>([\s\S]*?)<\/llm-only>/gi, '$1')
    .replace(/<llm-exclude(?:\s[^>]*)?>[\s\S]*?<\/llm-exclude>/gi, '')
}

function extractMarkdownTitle(content: string): string | undefined {
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(content)?.[1]
  return heading
    ?.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()
}

async function normalizeMarkdown(content: string): Promise<ReturnType<typeof matter>> {
  const processor = remark()
    .use(remarkFrontmatter)
    .use(() => (tree) => {
      remove(tree, { type: 'html' })
      return tree
    })
  const normalized = String(await processor.process(prepareLlmTags(content)))
  return matter(normalized)
}

function outputPathFor(sourcePath: string): string {
  const normalized = sourcePath.split(path.sep).join(path.posix.sep)
  if (path.posix.basename(normalized) !== 'index.md') return normalized
  const directory = path.posix.dirname(normalized)
  return directory === '.' ? 'index.md' : `${directory}.md`
}

function normalizeRoute(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value
  let route = withoutQuery.replaceAll('\\', '/').replace(/\.(?:md|html)$/, '')
  if (!route.startsWith('/')) route = `/${route}`
  route = route.replace(/\/index$/, '').replace(/\/+$/, '')
  return route || '/'
}

function linkForPage(page: PreparedPage, domain: string): string {
  const pathWithoutExtension = page.outputPath.replace(/\.md$/, '')
  return `${domain.replace(/\/$/, '')}/${pathWithoutExtension}.md`
}

function markdownLink(page: PreparedPage, domain: string): string {
  const description = page.description?.trim()
  return `- [${page.title}](${linkForPage(page, domain)})${description ? `: ${description}` : ''}\n`
}

async function* markdownFiles(directory: string, relativeDirectory = ''): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((one, another) => one.name.localeCompare(another.name, 'en'))
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* markdownFiles(absolutePath, relativePath)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield relativePath
    }
  }
}

function shouldIncludeSource(relativePath: string, localePrefixes: readonly string[]): boolean {
  const normalized = relativePath.split(path.sep).join(path.posix.sep)
  const firstSegment = normalized.split('/', 1)[0]
  if (firstSegment && localePrefixes.includes(firstSegment)) return false
  return !(
    normalized === 'index.md' ||
    normalized === 'README.md' ||
    normalized === 'team.md' ||
    normalized === 'blog.md' ||
    normalized.startsWith('blog/')
  )
}

async function preparePage(
  relativePath: string,
  options: GenerateLlmArtifactsOptions
): Promise<PreparedPage> {
  const sourcePath = path.resolve(options.docsDir, relativePath)
  const source = await readFile(sourcePath, 'utf8')
  const expanded = await expandIncludes(source, sourcePath, options.repoRoot, [sourcePath])
  const markdown = await normalizeMarkdown(expanded)
  const outputPath = outputPathFor(relativePath)
  const title = String(
    markdown.data.title ??
      markdown.data.titleTemplate ??
      extractMarkdownTitle(markdown.content) ??
      'Untitled'
  ).trim()
  const description =
    typeof markdown.data.description === 'string' ? markdown.data.description : undefined
  const metadata = {
    url: `${options.domain.replace(/\/$/, '')}/${outputPath.replace(/\.md$/, '')}.md`,
    ...(description ? { description } : {})
  }
  const targetPath = path.resolve(options.outDir, outputPath)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, matter.stringify(markdown.content, metadata), 'utf8')
  ;(matter as typeof matter & { clearCache(): void }).clearCache()

  return {
    description,
    outputPath: outputPath.split(path.sep).join(path.posix.sep),
    route: normalizeRoute(outputPath),
    title: title || 'Untitled'
  }
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: Array<{ index: number; value: R }> = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results.push({ index, value: await mapper(values[index] as T) })
    }
  })
  await Promise.all(workers)
  results.sort((one, another) => one.index - another.index)
  return results.map(({ value }) => value)
}

function sidebarArrays(sidebar?: LlmSidebar): LlmSidebarItem[][] {
  if (!sidebar) return []
  return Array.isArray(sidebar) ? [sidebar] : Object.values(sidebar)
}

function resolveSidebarLink(item: LlmSidebarItem, inheritedBase = ''): string | undefined {
  if (!item.link) return undefined
  if (item.link.startsWith('/')) return normalizeRoute(item.link)
  const base = item.base ?? inheritedBase
  return normalizeRoute(path.posix.join('/', base, item.link))
}

function collectSidebarRoutes(items: readonly LlmSidebarItem[], inheritedBase = ''): string[] {
  const routes: string[] = []
  for (const item of items) {
    const base = item.base ?? inheritedBase
    const route = resolveSidebarLink(item, inheritedBase)
    if (route) routes.push(route)
    if (item.items) routes.push(...collectSidebarRoutes(item.items, base))
  }
  return routes
}

function orderPages(pages: readonly PreparedPage[], sidebar?: LlmSidebar): PreparedPage[] {
  const byRoute = new Map(pages.map((page) => [page.route, page]))
  const ordered: PreparedPage[] = []
  const seen = new Set<string>()
  const routes = sidebarArrays(sidebar).flatMap((items) => collectSidebarRoutes(items))
  for (const route of routes) {
    const page = byRoute.get(route)
    if (page && !seen.has(page.outputPath)) {
      seen.add(page.outputPath)
      ordered.push(page)
    }
  }
  for (const page of pages) {
    if (!seen.has(page.outputPath)) ordered.push(page)
  }
  return ordered
}

function renderSidebarSection(
  item: LlmSidebarItem,
  pageByRoute: ReadonlyMap<string, PreparedPage>,
  domain: string,
  depth = 3,
  inheritedBase = ''
): string {
  const base = item.base ?? inheritedBase
  const parts: string[] = []
  const route = resolveSidebarLink(item, inheritedBase)
  const page = route ? pageByRoute.get(route) : undefined
  if (page) parts.push(markdownLink(page, domain))
  for (const child of item.items ?? []) {
    const childHasSection = Boolean(child.items?.length)
    const rendered = renderSidebarSection(
      child,
      pageByRoute,
      domain,
      childHasSection ? depth + 1 : depth,
      base
    )
    if (rendered) parts.push(rendered)
  }
  if (parts.length === 0) return ''
  const content = parts.join(parts.some((part) => part.startsWith('#')) ? '\n' : '')
  return item.text && item.items?.length
    ? `${'#'.repeat(depth)} ${item.text}\n\n${content}`
    : content
}

function generateTableOfContents(
  pages: readonly PreparedPage[],
  domain: string,
  sidebar?: LlmSidebar
): string {
  const pageByRoute = new Map(pages.map((page) => [page.route, page]))
  const sections = sidebarArrays(sidebar)
    .flat()
    .map((item) => renderSidebarSection(item, pageByRoute, domain))
    .filter(Boolean)
  const sidebarRoutes = new Set(
    sidebarArrays(sidebar).flatMap((items) => collectSidebarRoutes(items))
  )
  const other = pages.filter((page) => !sidebarRoutes.has(page.route))
  if (other.length > 0) {
    sections.push(`### Other\n\n${other.map((page) => markdownLink(page, domain)).join('')}`)
  }
  return sections.join('\n\n').trim()
}

async function writeWithBackpressure(
  stream: ReturnType<typeof createWriteStream>,
  chunk: string | Buffer
): Promise<void> {
  if (stream.write(chunk)) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', handleDrain)
      stream.off('error', handleError)
    }
    const handleDrain = () => {
      cleanup()
      resolve()
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }
    stream.once('drain', handleDrain)
    stream.once('error', handleError)
  })
}

async function streamFullDocumentation(
  pages: readonly PreparedPage[],
  outDir: string,
  destinationPath: string
): Promise<void> {
  const temporaryPath = `${destinationPath}.tmp`
  await rm(temporaryPath, { force: true })
  const destination = createWriteStream(temporaryPath, { encoding: 'utf8' })
  try {
    for (const [index, page] of pages.entries()) {
      if (index > 0) await writeWithBackpressure(destination, '\n---\n\n')
      const source = createReadStream(path.resolve(outDir, page.outputPath))
      for await (const chunk of source) await writeWithBackpressure(destination, chunk)
    }
    destination.end()
    await finished(destination)
    await rename(temporaryPath, destinationPath)
  } catch (error) {
    destination.destroy()
    await rm(temporaryPath, { force: true })
    throw error
  }
}

export async function generateLlmArtifacts(
  options: GenerateLlmArtifactsOptions
): Promise<GenerateLlmArtifactsResult> {
  const concurrency = options.concurrency ?? 2
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error(`LLMS concurrency must be a positive integer; received ${concurrency}`)
  }
  if (!isInside(options.repoRoot, options.docsDir) || !isInside(options.repoRoot, options.outDir)) {
    throw new Error('LLMS source and output directories must stay inside the repository')
  }

  const sourcePaths: string[] = []
  for await (const relativePath of markdownFiles(options.docsDir)) {
    if (shouldIncludeSource(relativePath, options.localePrefixes)) sourcePaths.push(relativePath)
  }
  await mkdir(options.outDir, { recursive: true })
  const prepared = await mapBounded(sourcePaths, concurrency, (relativePath) =>
    preparePage(relativePath, options)
  )
  prepared.sort((one, another) => one.title.localeCompare(another.title, 'en'))

  const llmsTxtPath = path.resolve(options.outDir, 'llms.txt')
  const toc = generateTableOfContents(prepared, options.domain, options.sidebar)
  const llmsTxt = `# ${options.title}\n\n> ${options.description}\n\n${options.details}\n\n## Table of Contents\n\n${toc}`
  await writeFile(llmsTxtPath, llmsTxt, 'utf8')

  const llmsFullTxtPath = path.resolve(options.outDir, 'llms-full.txt')
  await streamFullDocumentation(
    orderPages(prepared, options.sidebar),
    options.outDir,
    llmsFullTxtPath
  )
  const fullStats = await stat(llmsFullTxtPath)

  return {
    pages: prepared.length,
    llmsTxtPath,
    llmsFullTxtPath,
    llmsFullTxtBytes: fullStats.size
  }
}
