import { createHash } from 'node:crypto'
import { createReadStream, type Dirent } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SitePartition {
  locale: string
  outputDir: string
}

export interface PartitionMergeResult {
  copiedFiles: number
  reusedFiles: number
  hashmapEntries: number
  sitemapUrls: number
}

interface SitemapFragment {
  prefix: string
  suffix: string
  urlsetTag: string
  urls: Array<{ location: string; source: string }>
}

const PARTITION_METADATA = new Set(['hashmap.json', 'sitemap.xml'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseHashmap(source: string, label: string): Record<string, string> {
  const parsed: unknown = JSON.parse(source)
  if (!isRecord(parsed)) throw new Error(`${label} must contain a JSON object`)

  const entries: Array<[string, string]> = []
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`${label} contains a non-string hash for ${JSON.stringify(key)}`)
    }
    entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

export function mergeHashmaps(
  hashmaps: ReadonlyArray<{ label: string; value: Record<string, string> }>
): Record<string, string> {
  const merged = new Map<string, string>()

  for (const hashmap of hashmaps) {
    for (const [key, value] of Object.entries(hashmap.value)) {
      const existing = merged.get(key)
      if (existing !== undefined && existing !== value) {
        throw new Error(
          `Hashmap key ${JSON.stringify(key)} differs in ${hashmap.label}: ${existing} != ${value}`
        )
      }
      merged.set(key, value)
    }
  }

  return Object.fromEntries(
    [...merged.entries()].sort(([left], [right]) => left.localeCompare(right))
  )
}

function parseSitemap(source: string, label: string): SitemapFragment {
  const match = source.match(/^([\s\S]*?<urlset\b[^>]*>)([\s\S]*)(<\/urlset>\s*)$/)
  if (!match) throw new Error(`${label} is not a complete sitemap urlset`)

  const [, prefix, body, suffix] = match
  const tagStart = prefix.lastIndexOf('<urlset')
  if (tagStart < 0) throw new Error(`${label} is missing its urlset opening tag`)

  const urlPattern = /<url\b[^>]*>[\s\S]*?<\/url>/g
  const urlSources = body.match(urlPattern) ?? []
  if (body.replace(urlPattern, '').trim() !== '') {
    throw new Error(`${label} contains content outside its url entries`)
  }

  const urls = urlSources.map((urlSource) => {
    const location = urlSource.match(/<loc>([\s\S]*?)<\/loc>/)?.[1]
    if (!location) throw new Error(`${label} contains a url entry without a location`)
    return { location, source: urlSource }
  })

  return {
    prefix,
    suffix,
    urlsetTag: prefix.slice(tagStart),
    urls
  }
}

export function countSitemapUrls(source: string): number {
  return source.match(/<url(?:\s[^>]*)?>/g)?.length ?? 0
}

export function mergeSitemaps(sitemaps: ReadonlyArray<{ label: string; source: string }>): string {
  if (sitemaps.length === 0) throw new Error('At least one sitemap is required')

  const fragments = sitemaps.map(({ label, source }) => parseSitemap(source, label))
  const [first] = fragments
  for (let index = 1; index < fragments.length; index += 1) {
    const fragment = fragments[index]
    if (fragment.urlsetTag !== first.urlsetTag) {
      throw new Error(`${sitemaps[index].label} uses a different sitemap urlset declaration`)
    }
  }

  const urls = new Map<string, string>()
  for (const [index, fragment] of fragments.entries()) {
    for (const url of fragment.urls) {
      const existing = urls.get(url.location)
      if (existing !== undefined && existing !== url.source) {
        throw new Error(
          `${sitemaps[index].label} defines ${url.location} differently from another partition`
        )
      }
      urls.set(url.location, url.source)
    }
  }

  const body = [...urls.values()].join('\n')
  return `${first.prefix}${body ? `\n${body}\n` : ''}${first.suffix}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function digestFile(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function filesAreEqual(left: string, right: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([lstat(left), lstat(right)])
  if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false

  const [leftDigest, rightDigest] = await Promise.all([digestFile(left), digestFile(right)])
  return leftDigest === rightDigest
}

function sortEntries(entries: Dirent[]): Dirent[] {
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

async function copyPartitionTree(
  sourceDir: string,
  destinationDir: string,
  locale: string,
  relativeDir = ''
): Promise<{ copiedFiles: number; reusedFiles: number }> {
  await mkdir(destinationDir, { recursive: true })
  let copiedFiles = 0
  let reusedFiles = 0

  for (const entry of sortEntries(await readdir(sourceDir, { withFileTypes: true }))) {
    const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name
    if (relativeDir === '' && PARTITION_METADATA.has(entry.name)) continue
    if (relativeDir === '' && locale !== 'en' && entry.name === '404.html') continue

    const sourcePath = join(sourceDir, entry.name)
    const destinationPath = join(destinationDir, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Partition ${locale} contains unsupported symlink ${relativePath}`)
    }
    if (entry.isDirectory()) {
      const nested = await copyPartitionTree(sourcePath, destinationPath, locale, relativePath)
      copiedFiles += nested.copiedFiles
      reusedFiles += nested.reusedFiles
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Partition ${locale} contains unsupported entry ${relativePath}`)
    }

    if (await pathExists(destinationPath)) {
      if (!(await filesAreEqual(sourcePath, destinationPath))) {
        throw new Error(`Partition ${locale} conflicts with an existing file at ${relativePath}`)
      }
      reusedFiles += 1
      continue
    }

    await mkdir(dirname(destinationPath), { recursive: true })
    await copyFile(sourcePath, destinationPath)
    copiedFiles += 1
  }

  return { copiedFiles, reusedFiles }
}

export async function mergePartitionOutputs(
  partitions: readonly SitePartition[],
  stagingDir: string
): Promise<PartitionMergeResult> {
  if (partitions.length === 0) throw new Error('At least one site partition is required')

  const hashmaps: Array<{ label: string; value: Record<string, string> }> = []
  const sitemaps: Array<{ label: string; source: string }> = []
  let copiedFiles = 0
  let reusedFiles = 0

  await mkdir(stagingDir, { recursive: true })
  const localizedPrefixes = partitions
    .map((partition) => partition.locale)
    .filter((locale) => locale !== 'en')
  for (const partition of partitions) {
    const outputStat = await lstat(partition.outputDir)
    if (!outputStat.isDirectory()) {
      throw new Error(`Partition ${partition.locale} output is not a directory`)
    }

    const copied = await copyPartitionTree(partition.outputDir, stagingDir, partition.locale)
    copiedFiles += copied.copiedFiles
    reusedFiles += copied.reusedFiles

    const hashmapPath = join(partition.outputDir, 'hashmap.json')
    const sitemapPath = join(partition.outputDir, 'sitemap.xml')
    const partitionHashmap = parseHashmap(await readFile(hashmapPath, 'utf8'), hashmapPath)
    for (const key of Object.keys(partitionHashmap)) {
      if (partition.locale === 'en') {
        const localizedPrefix = localizedPrefixes.find((locale) => key.startsWith(`${locale}_`))
        if (localizedPrefix) {
          throw new Error(
            `English hashmap key ${JSON.stringify(key)} unexpectedly uses the ${localizedPrefix} prefix`
          )
        }
      } else if (!key.startsWith(`${partition.locale}_`)) {
        throw new Error(
          `${partition.locale} hashmap key ${JSON.stringify(key)} is missing its locale prefix`
        )
      }
    }

    hashmaps.push({
      label: `${partition.locale}/hashmap.json`,
      value: partitionHashmap
    })
    sitemaps.push({
      label: `${partition.locale}/sitemap.xml`,
      source: await readFile(sitemapPath, 'utf8')
    })
  }

  const hashmap = mergeHashmaps(hashmaps)
  const sitemap = mergeSitemaps(sitemaps)
  await writeFile(join(stagingDir, 'hashmap.json'), `${JSON.stringify(hashmap)}\n`)
  await writeFile(join(stagingDir, 'sitemap.xml'), sitemap)

  return {
    copiedFiles,
    reusedFiles,
    hashmapEntries: Object.keys(hashmap).length,
    sitemapUrls: countSitemapUrls(sitemap)
  }
}
