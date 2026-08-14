import {
  IMAGE_INSPECTION_LIMITS,
  inspectImageBytes,
  type Fill,
  type ImageByteInspection,
  type ImageDimensions,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import { defineTool } from '#core/tools/schema'

const DEFAULT_MAX_ASSET_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_PIXELS = 50_000_000
const DEFAULT_MAX_ASSETS = 200
const DEFAULT_MAX_REFERENCES = 20
const DEFAULT_MAX_TOTAL_REFERENCES = 1_000

type ImageAssetStatus = 'ok' | 'missing' | 'invalid' | 'oversize' | 'orphan'

interface ImageAssetIssue {
  code: string
  message: string
}

interface ImageAssetReference {
  nodeId: string
  nodeName: string
  nodeType: string
  pageId: string
  pageName: string
  path: string
  nodeVisible: boolean
  fillVisible: boolean
}

interface PageInfo {
  id: string
  name: string
}

interface AuditLimits {
  maxAssetBytes: number
  maxPixels: number
  maxAssets: number
  maxReferencesPerAsset: number
  maxTotalReferences: number
}

interface ImageAssetReport {
  hash: string
  hashExists: boolean
  byteLength: number | null
  signature: string | null
  mimeType: string | null
  headerValidation: ImageByteInspection['headerValidation']
  dimensionStatus: ImageByteInspection['dimensionStatus']
  dimensions?: ImageDimensions
  pixelCount?: number
  pixelCountExact?: string
  inspectionReason?: string
  status: ImageAssetStatus
  statuses: ImageAssetStatus[]
  issues: ImageAssetIssue[]
  referenceCount: number
  references: ImageAssetReference[]
  omittedReferenceCount: number
}

function createPageResolver(graph: SceneGraph): (node: SceneNode) => PageInfo | null {
  const cache = new Map<string, PageInfo | null>()
  return (node) => {
    const cached = cache.get(node.id)
    if (cached !== undefined) return cached
    const trail: SceneNode[] = []
    const visited = new Set<string>()
    let current: SceneNode | undefined = node
    let page: PageInfo | null = null
    while (current && !visited.has(current.id)) {
      const known = cache.get(current.id)
      if (known !== undefined) {
        page = known
        break
      }
      trail.push(current)
      visited.add(current.id)
      if (current.type === 'CANVAS') {
        page = { id: current.id, name: current.name }
        break
      }
      current = current.parentId ? graph.getNode(current.parentId) : undefined
    }
    for (const item of trail) cache.set(item.id, page)
    return page
  }
}

function referenceFor(
  node: SceneNode,
  page: PageInfo | null,
  path: string,
  fill: Fill
): ImageAssetReference {
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    pageId: page?.id ?? '',
    pageName: page?.name ?? '',
    path,
    nodeVisible: node.visible,
    fillVisible: fill.visible
  }
}

function collectFillReferences(
  node: SceneNode,
  page: PageInfo | null,
  fills: readonly Fill[] | undefined,
  path: string,
  byHash: Map<string, ImageAssetReference[]>,
  missingHash: ImageAssetReference[]
): void {
  for (let index = 0; index < (fills?.length ?? 0); index++) {
    const fill = fills?.[index]
    if (fill?.type !== 'IMAGE') continue
    const reference = referenceFor(node, page, `${path}[${index}]`, fill)
    const hash = typeof fill.imageHash === 'string' ? fill.imageHash : ''
    if (!hash.trim()) {
      missingHash.push(reference)
      continue
    }
    const references = byHash.get(hash) ?? []
    references.push(reference)
    byHash.set(hash, references)
  }
}

function collectNodeReferences(
  node: SceneNode,
  page: PageInfo | null,
  byHash: Map<string, ImageAssetReference[]>,
  missingHash: ImageAssetReference[]
): void {
  collectFillReferences(node, page, node.fills, 'fills', byHash, missingHash)
  collectFillReferences(
    node,
    page,
    node.textDecorationFills,
    'textDecorationFills',
    byHash,
    missingHash
  )
  for (let index = 0; index < node.styleRuns.length; index++) {
    const style = node.styleRuns[index].style
    collectFillReferences(node, page, style.fills, `styleRuns[${index}].fills`, byHash, missingHash)
    collectFillReferences(
      node,
      page,
      style.textDecorationFills,
      `styleRuns[${index}].textDecorationFills`,
      byHash,
      missingHash
    )
  }
  for (let index = 0; index < node.fillGeometry.length; index++) {
    collectFillReferences(
      node,
      page,
      node.fillGeometry[index]?.fills,
      `fillGeometry[${index}].fills`,
      byHash,
      missingHash
    )
  }
  for (let index = 0; index < node.strokeGeometry.length; index++) {
    collectFillReferences(
      node,
      page,
      node.strokeGeometry[index]?.fills,
      `strokeGeometry[${index}].fills`,
      byHash,
      missingHash
    )
  }
  for (const [state, override] of Object.entries(node.stateOverrides ?? {})) {
    collectFillReferences(
      node,
      page,
      override.fills,
      `stateOverrides.${state}.fills`,
      byHash,
      missingHash
    )
  }
}

function compareReferences(left: ImageAssetReference, right: ImageAssetReference): number {
  return (
    left.pageId.localeCompare(right.pageId) ||
    left.nodeId.localeCompare(right.nodeId) ||
    left.path.localeCompare(right.path)
  )
}

function collectReferences(graph: SceneGraph): {
  byHash: Map<string, ImageAssetReference[]>
  missingHash: ImageAssetReference[]
} {
  const byHash = new Map<string, ImageAssetReference[]>()
  const missingHash: ImageAssetReference[] = []
  const pageFor = createPageResolver(graph)
  for (const node of graph.getAllNodes()) {
    collectNodeReferences(node, pageFor(node), byHash, missingHash)
  }
  missingHash.sort(compareReferences)
  for (const references of byHash.values()) references.sort(compareReferences)
  return { byHash, missingHash }
}

function primaryStatus(statuses: readonly ImageAssetStatus[]): ImageAssetStatus {
  for (const status of ['missing', 'invalid', 'oversize', 'orphan'] as const) {
    if (statuses.includes(status)) return status
  }
  return 'ok'
}

function pixelMetadata(dimensions: ImageDimensions | undefined): {
  pixelCount?: number
  pixelCountExact?: string
} {
  if (!dimensions) return {}
  const exact = BigInt(dimensions.width) * BigInt(dimensions.height)
  return exact <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { pixelCount: Number(exact) }
    : { pixelCountExact: exact.toString() }
}

function missingInspection(): ImageByteInspection {
  return {
    signature: null,
    mimeType: null,
    headerValidation: 'missing',
    dimensionStatus: 'missing',
    reason: 'No stored bytes exist for this referenced hash'
  }
}

function addOversizeIssues(
  stored: Uint8Array,
  inspection: ImageByteInspection,
  limits: AuditLimits,
  statuses: ImageAssetStatus[],
  issues: ImageAssetIssue[]
): void {
  if (stored.byteLength > limits.maxAssetBytes) {
    statuses.push('oversize')
    issues.push({
      code: 'image-bytes-oversize',
      message: `${stored.byteLength} bytes exceeds the ${limits.maxAssetBytes} byte limit`
    })
  }
  if (!inspection.dimensions) return
  const pixels = BigInt(inspection.dimensions.width) * BigInt(inspection.dimensions.height)
  if (pixels <= BigInt(limits.maxPixels)) return
  if (!statuses.includes('oversize')) statuses.push('oversize')
  issues.push({
    code: 'image-pixels-oversize',
    message: `${pixels.toString()} pixels exceeds the ${limits.maxPixels} pixel limit`
  })
}

function assetReport(
  graph: SceneGraph,
  hash: string,
  references: ImageAssetReference[],
  limits: AuditLimits
): ImageAssetReport {
  const hashExists = graph.images.has(hash)
  const stored = graph.images.get(hash)
  const issues: ImageAssetIssue[] = []
  const statuses: ImageAssetStatus[] = []
  let inspection = missingInspection()

  if (!hashExists) {
    statuses.push('missing')
    issues.push({
      code: 'missing-image-bytes',
      message: inspection.reason ?? 'No stored bytes exist for this referenced hash'
    })
  } else if (!(stored instanceof Uint8Array)) {
    statuses.push('invalid')
    inspection = {
      signature: null,
      mimeType: null,
      headerValidation: 'invalid',
      dimensionStatus: 'invalid',
      reason: 'Graph image value is not a Uint8Array'
    }
    issues.push({
      code: 'invalid-image-storage',
      message: inspection.reason ?? 'Graph image value is not a Uint8Array'
    })
  } else {
    inspection = inspectImageBytes(stored)
    if (inspection.headerValidation === 'invalid') {
      statuses.push('invalid')
      issues.push({
        code: 'invalid-image-header',
        message: inspection.reason ?? 'Image header is invalid'
      })
    }
    addOversizeIssues(stored, inspection, limits, statuses, issues)
  }
  if (references.length === 0) statuses.push('orphan')
  if (hash.length === 0) {
    if (!statuses.includes('invalid')) statuses.push('invalid')
    issues.push({ code: 'empty-image-hash', message: 'Stored graph image has an empty hash key' })
  }
  if (statuses.length === 0) statuses.push('ok')

  return {
    hash,
    hashExists,
    byteLength: stored instanceof Uint8Array ? stored.byteLength : null,
    signature: inspection.signature,
    mimeType: inspection.mimeType,
    headerValidation: inspection.headerValidation,
    dimensionStatus: inspection.dimensionStatus,
    ...(inspection.dimensions ? { dimensions: inspection.dimensions } : {}),
    ...pixelMetadata(inspection.dimensions),
    ...(inspection.reason ? { inspectionReason: inspection.reason } : {}),
    status: primaryStatus(statuses),
    statuses,
    issues,
    referenceCount: references.length,
    references: references.slice(0, limits.maxReferencesPerAsset),
    omittedReferenceCount: Math.max(0, references.length - limits.maxReferencesPerAsset)
  }
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  return Math.min(maximum, Math.max(1, Math.floor(value ?? fallback)))
}

function summary(
  graph: SceneGraph,
  allAssets: readonly ImageAssetReport[],
  matchedAssets: readonly ImageAssetReport[],
  returnedAssets: readonly ImageAssetReport[],
  byHash: ReadonlyMap<string, ImageAssetReference[]>,
  missingHash: readonly ImageAssetReference[],
  returnedMissingHash: readonly ImageAssetReference[],
  includeHealthy: boolean
) {
  const returnedAssetReferences = returnedAssets.reduce(
    (sum, asset) => sum + asset.references.length,
    0
  )
  const totalReferences =
    missingHash.length + [...byHash.values()].reduce((sum, refs) => sum + refs.length, 0)
  return {
    imageFillReferences: totalReferences,
    referencedHashes: byHash.size,
    storedImages: graph.images.size,
    assets: allAssets.length,
    matchedAssets: matchedAssets.length,
    returnedAssets: returnedAssets.length,
    omittedAssets: Math.max(0, matchedAssets.length - returnedAssets.length),
    filteredHealthy: includeHealthy ? 0 : allAssets.length - matchedAssets.length,
    healthy: allAssets.filter((asset) => asset.statuses.length === 1 && asset.status === 'ok')
      .length,
    missing: allAssets.filter((asset) => asset.statuses.includes('missing')).length,
    missingHashFills: missingHash.length,
    invalid: allAssets.filter((asset) => asset.statuses.includes('invalid')).length,
    oversize: allAssets.filter((asset) => asset.statuses.includes('oversize')).length,
    orphan: allAssets.filter((asset) => asset.statuses.includes('orphan')).length,
    totalStoredBytes: allAssets.reduce((sum, asset) => sum + (asset.byteLength ?? 0), 0),
    returnedReferences: returnedAssetReferences + returnedMissingHash.length,
    omittedReferences: Math.max(
      0,
      totalReferences - returnedAssetReferences - returnedMissingHash.length
    ),
    returnedMissingHashReferences: returnedMissingHash.length,
    omittedMissingHashReferences: missingHash.length - returnedMissingHash.length
  }
}

function statusRank(asset: ImageAssetReport): number {
  return ['missing', 'invalid', 'oversize', 'orphan', 'ok'].indexOf(asset.status)
}

function prioritizeAssets(assets: readonly ImageAssetReport[]): ImageAssetReport[] {
  return [...assets].sort(
    (left, right) => statusRank(left) - statusRank(right) || left.hash.localeCompare(right.hash)
  )
}

function capReturnedReferences(
  assets: readonly ImageAssetReport[],
  maxTotalReferences: number
): ImageAssetReport[] {
  let remaining = maxTotalReferences
  return assets.map((asset) => {
    const references = asset.references.slice(0, remaining)
    remaining -= references.length
    return {
      ...asset,
      references,
      omittedReferenceCount: asset.referenceCount - references.length
    }
  })
}

export const auditImageAssets = defineTool({
  name: 'audit_image_assets',
  description:
    'Audit every IMAGE fill and stored graph image in the document. Summary counts cover the full document; bounded, problem-first records report lookup-hash presence, bytes, MIME/signature inspection, safely parsed dimensions, reference paths, and missing/invalid/oversize/orphan status. Header parsing is bounded and failures are explicit.',
  params: {
    max_asset_bytes: {
      type: 'number',
      description: 'Byte threshold for oversize status (default: 20971520 / 20 MiB)',
      min: 1,
      max: 1024 * 1024 * 1024
    },
    max_pixels: {
      type: 'number',
      description: 'Decoded-dimension pixel threshold for oversize status (default: 50000000)',
      min: 1,
      max: 1_000_000_000
    },
    max_assets: {
      type: 'number',
      description: 'Maximum asset records returned after filtering (default: 200, range: 1-1000)',
      min: 1,
      max: 1_000
    },
    max_references_per_asset: {
      type: 'number',
      description: 'Maximum reference records returned per hash (default: 20, range: 1-500)',
      min: 1,
      max: 500
    },
    max_total_references: {
      type: 'number',
      description:
        'Maximum reference records returned across all assets (default: 1000, range: 1-5000)',
      min: 1,
      max: 5_000
    },
    include_healthy: {
      type: 'boolean',
      description: 'Include healthy assets in records (default: true); summary always counts them'
    }
  },
  execute: (figma, args) => {
    const limits: AuditLimits = {
      maxAssetBytes: boundedInteger(args.max_asset_bytes, DEFAULT_MAX_ASSET_BYTES, 1024 ** 3),
      maxPixels: boundedInteger(args.max_pixels, DEFAULT_MAX_PIXELS, 1_000_000_000),
      maxAssets: boundedInteger(args.max_assets, DEFAULT_MAX_ASSETS, 1_000),
      maxReferencesPerAsset: boundedInteger(
        args.max_references_per_asset,
        DEFAULT_MAX_REFERENCES,
        500
      ),
      maxTotalReferences: boundedInteger(
        args.max_total_references,
        DEFAULT_MAX_TOTAL_REFERENCES,
        5_000
      )
    }
    const { byHash, missingHash } = collectReferences(figma.graph)
    const hashes = new Set([...figma.graph.images.keys(), ...byHash.keys()])
    const allAssets = [...hashes]
      .sort((left, right) => left.localeCompare(right))
      .map((hash) => assetReport(figma.graph, hash, byHash.get(hash) ?? [], limits))
    const includeHealthy = args.include_healthy ?? true
    const matchedAssets = prioritizeAssets(
      includeHealthy
        ? allAssets
        : allAssets.filter((asset) => !(asset.statuses.length === 1 && asset.status === 'ok'))
    )
    const assets = capReturnedReferences(
      matchedAssets.slice(0, limits.maxAssets),
      limits.maxTotalReferences
    )
    const returnedAssetReferences = assets.reduce((sum, asset) => sum + asset.references.length, 0)
    const missingHashReferences = missingHash.slice(
      0,
      Math.max(0, limits.maxTotalReferences - returnedAssetReferences)
    )

    return {
      scope: { kind: 'document', rootId: figma.graph.rootId },
      limits: { ...limits, ...IMAGE_INSPECTION_LIMITS },
      summary: summary(
        figma.graph,
        allAssets,
        matchedAssets,
        assets,
        byHash,
        missingHash,
        missingHashReferences,
        includeHealthy
      ),
      assets,
      missingHashReferences,
      limitations: [
        'Hash values are graph lookup keys and are not assumed to be cryptographic digests.',
        'Validation is bounded structural header inspection, not a full pixel decode.',
        'AVIF, HEIC, and TIFF signatures are reported, but dimensions are left unavailable instead of guessed.',
        'Hidden nodes and fills are included so missing and orphan resources are not suppressed.',
        'Asset and reference records are bounded; summary returned/omitted counts disclose truncation.'
      ]
    }
  }
})
