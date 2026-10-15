import * as v from 'valibot'

import {
  computeImageHash,
  OPEN_PENCIL_PLUGIN_ID,
  OPEN_PENCIL_PLUGIN_DATA,
  type PluginDataEntry,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import { REMOTE_FIG_ARCHIVE_LIMITS, type FigArchiveLimits } from '../archive'

/** Document-owned runtime aliases; Figma archive entries and paints remain SHA-1 named. */
const IMAGE_ALIASES_KEY = 'imageAliasesV1'
const ImageAliasesSchema = v.strictObject({
  version: v.literal(1),
  aliases: v.array(
    v.strictObject({
      alias: v.pipe(v.string(), v.minLength(1)),
      hash: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u))
    })
  )
})

/** Plain native paints are rewritten to SHA-1. Opaque or module data may still address their old names. */
function canonicalPaintNames(nodes: Iterable<SceneNode>): ReadonlySet<string> | null {
  const names = new Set<string>()
  for (const node of nodes) {
    if (
      node.interactiveProps ||
      node.motion ||
      node.motionScene ||
      node.motionDrivers ||
      node.generatedEffect ||
      Object.keys(node.source.fig.rawNodeFields).length > 0 ||
      node.pluginData.some(
        (entry) =>
          !isImageAliasesEntry(entry) &&
          !(
            entry.pluginId === OPEN_PENCIL_PLUGIN_ID &&
            entry.key === OPEN_PENCIL_PLUGIN_DATA.shader.key
          )
      )
    )
      return null
    for (const paint of [...node.fills, ...node.strokes])
      if (paint.imageHash) names.add(paint.imageHash)
  }
  return names
}

export function imageAliasesPluginData(
  images: ReadonlyMap<string, Uint8Array>,
  nodes?: Iterable<SceneNode>
): PluginDataEntry | null {
  const canonicalized = nodes ? canonicalPaintNames(nodes) : null
  const hashes = new WeakMap<Uint8Array, string>()
  const aliases: Array<{ alias: string; hash: string }> = []
  for (const [alias, bytes] of images) {
    const hash = hashes.get(bytes) ?? computeImageHash(bytes)
    hashes.set(bytes, hash)
    if (alias !== hash && !canonicalized?.has(alias)) aliases.push({ alias, hash })
  }
  if (aliases.length === 0) return null
  aliases.sort((left, right) => left.alias.localeCompare(right.alias))
  return {
    pluginId: OPEN_PENCIL_PLUGIN_ID,
    key: IMAGE_ALIASES_KEY,
    value: JSON.stringify({ version: 1, aliases })
  }
}

export function imageAliasesChanged(graph: SceneGraph): boolean {
  const current = imageAliasesPluginData(graph.images, graph.getAllNodes())
  const saved = graph.getNode(graph.rootId)?.pluginData.find(isImageAliasesEntry)
  return current?.value !== saved?.value
}

export function isImageAliasesEntry(entry: PluginDataEntry): boolean {
  return entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === IMAGE_ALIASES_KEY
}

function parseImageAliases(text: string, limits?: FigArchiveLimits) {
  const maxMetadataBytes = Math.min(
    limits?.maxDataBytes ?? REMOTE_FIG_ARCHIVE_LIMITS.maxDataBytes,
    limits?.maxEntryBytes ?? REMOTE_FIG_ARCHIVE_LIMITS.maxEntryBytes
  )
  if (new TextEncoder().encode(text).byteLength > maxMetadataBytes)
    throw new RangeError('FIG image alias metadata exceeds the data byte limit.')
  const parsed = v.parse(v.pipe(v.string(), v.parseJson(), ImageAliasesSchema), text)
  if (parsed.aliases.length > (limits?.maxEntries ?? REMOTE_FIG_ARCHIVE_LIMITS.maxEntries))
    throw new RangeError('FIG image aliases exceed the archive entry limit.')
  return parsed.aliases
}

/** Restores shared references only after the complete table and every addressed image validate. */
export function restoreImageAliases(graph: SceneGraph, limits?: FigArchiveLimits): void {
  const entries = graph.getNode(graph.rootId)?.pluginData.filter(isImageAliasesEntry) ?? []
  if (entries.length === 0) return
  if (entries.length !== 1) throw new TypeError('Duplicate FIG image alias metadata.')
  const text = entries[0].value
  const aliases = parseImageAliases(text, limits)
  const resolved = new Map<string, Uint8Array>()
  const hashes = new WeakMap<Uint8Array, string>()
  for (const { alias, hash } of aliases) {
    if (resolved.has(alias)) throw new TypeError('Duplicate FIG image alias.')
    const bytes = graph.images.get(hash)
    if (!bytes) throw new TypeError('FIG image alias addresses a missing image.')
    const actual = hashes.get(bytes) ?? computeImageHash(bytes)
    hashes.set(bytes, actual)
    if (actual !== hash) throw new TypeError('FIG image alias hash does not match its image.')
    const existing = graph.images.get(alias)
    if (existing && existing !== bytes && computeImageHash(existing) !== hash)
      throw new TypeError('FIG image alias collides with another image.')
    resolved.set(alias, bytes)
  }
  for (const [alias, bytes] of resolved) graph.images.set(alias, bytes)
}
