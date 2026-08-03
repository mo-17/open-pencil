import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { assessLoadedFontLicense, type FontLicenseAssessment } from '#core/text/font-license'
import { lowcodeTextNode } from '#core/text/lowcode'
import { requiredNodeFontFaceUsages, type NodeFontScope } from '#core/text/requirements'
import { fontFaceDemand, fontResolver } from '#core/text/resolver'
import { defineTool, nodeNotFound } from '#core/tools/schema'

type FontLicenseIntendedUse = 'commercial_use' | 'embedding' | 'redistribution' | 'modification'
type FontLicenseDecision = 'pass' | 'review' | 'block'

interface FontUsage {
  nodeId: string
  nodeName: string
  pageId: string
  scope: NodeFontScope
}

interface CollectedFace {
  family: string
  style: string
  usages: FontUsage[]
}

function faceKey(family: string, style: string): string {
  return `${family.trim().toLocaleLowerCase()}\0${style.toLocaleLowerCase()}`
}

function owningPageId(graph: SceneGraph, node: SceneNode): string {
  let current: SceneNode | undefined = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    if (current.type === 'CANVAS') return current.id
    visited.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return ''
}

function collectFontFaces(
  graph: SceneGraph,
  rootIds: readonly string[]
): {
  faces: CollectedFace[]
  textNodeIds: Set<string>
} {
  const byFace = new Map<string, CollectedFace>()
  const textNodeIds = new Set<string>()
  const visited = new Set<string>()
  const stack = rootIds.map((id) => ({ id, pageId: '' }))

  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry || visited.has(entry.id)) continue
    visited.add(entry.id)
    const node = graph.getNode(entry.id)
    if (!node) continue
    const pageId = node.type === 'CANVAS' ? node.id : entry.pageId || owningPageId(graph, node)
    const textNode = lowcodeTextNode(node) ?? node

    if (textNode.type === 'TEXT') {
      textNodeIds.add(node.id)
      for (const face of requiredNodeFontFaceUsages(textNode)) {
        const key = faceKey(face.family, face.style)
        let collected = byFace.get(key)
        if (!collected) {
          collected = { family: face.family, style: face.style, usages: [] }
          byFace.set(key, collected)
        }
        for (const scope of face.scopes) {
          collected.usages.push({
            nodeId: node.id,
            nodeName: node.name,
            pageId,
            scope
          })
        }
      }
    }

    for (let index = node.childIds.length - 1; index >= 0; index--) {
      stack.push({ id: node.childIds[index], pageId })
    }
  }

  const faces = [...byFace.values()].sort(
    (left, right) =>
      left.family.localeCompare(right.family) || left.style.localeCompare(right.style)
  )
  for (const face of faces) {
    face.usages.sort(
      (left, right) =>
        left.pageId.localeCompare(right.pageId) ||
        left.nodeId.localeCompare(right.nodeId) ||
        left.scope.kind.localeCompare(right.scope.kind) ||
        ('start' in left.scope ? left.scope.start : -1) -
          ('start' in right.scope ? right.scope.start : -1)
    )
  }
  return { faces, textNodeIds }
}

function permissionFor(assessment: FontLicenseAssessment, intendedUse: FontLicenseIntendedUse) {
  const permissions = assessment.license?.permissions
  if (!permissions) return 'unknown'
  if (intendedUse === 'commercial_use') return permissions.commercialUse
  if (intendedUse === 'embedding') return permissions.embedding
  if (intendedUse === 'redistribution') return permissions.redistribution
  return permissions.modification
}

function decisionFor(
  assessment: FontLicenseAssessment,
  intendedUse: FontLicenseIntendedUse
): { decision: FontLicenseDecision; reasons: string[]; obligations: string[] } {
  const reasons = [...assessment.reasons]
  const obligations = assessment.license?.conditions ?? []
  const embedding = assessment.embeddedMetadata?.embedding

  if ((intendedUse === 'embedding' || intendedUse === 'redistribution') && embedding?.restricted) {
    return {
      decision: 'block',
      reasons: [...reasons, 'The OpenType OS/2 table marks embedding as restricted.'],
      obligations
    }
  }
  if (assessment.classification === 'restricted') {
    return { decision: 'block', reasons, obligations }
  }
  if (assessment.classification !== 'verified_open') {
    return { decision: 'review', reasons, obligations }
  }

  const permission = permissionFor(assessment, intendedUse)
  if (permission === 'restricted') return { decision: 'block', reasons, obligations }
  if (permission === 'unknown') return { decision: 'review', reasons, obligations }
  return { decision: 'pass', reasons, obligations }
}

export const auditFontLicenses = defineTool({
  name: 'audit_font_licenses',
  description:
    'Audit font-license evidence for TEXT and visible lowcode BUTTON/INPUT/TEXTAREA text in the current page, a node subtree, or all pages. ' +
    'Only an exact loaded-byte SHA-256 match against the reviewed bundled-font manifest is classified as verified_open. ' +
    'OpenType license fields are returned as self-reported hints; local, system, cached, remote, unavailable, or mismatched fonts remain unknown. ' +
    'Results include intended-use permissions, obligations, and pass/review/block decisions and are not legal advice.',
  params: {
    id: {
      type: 'string',
      description: 'Optional root node ID; audits that node and its descendants'
    },
    all_pages: {
      type: 'boolean',
      description: 'Audit every page instead of the current page (cannot be combined with id)'
    },
    family: {
      type: 'string',
      description: 'Optional font-family substring filter (case-insensitive)'
    },
    intended_use: {
      type: 'string',
      description: 'Permission to evaluate (default: commercial_use)',
      enum: ['commercial_use', 'embedding', 'redistribution', 'modification']
    },
    max_usages_per_face: {
      type: 'number',
      description: 'Maximum usage locations returned per font face (default: 50, range: 1-100)'
    }
  },
  execute: async (figma, args) => {
    if (args.id && args.all_pages) {
      return { error: 'id and all_pages cannot be used together' }
    }

    let rootNodes: Array<SceneNode | undefined>
    if (args.id) {
      rootNodes = [figma.graph.getNode(args.id)]
    } else if (args.all_pages) {
      rootNodes = figma.graph.getPages()
    } else {
      rootNodes = [figma.graph.getNode(figma.currentPageId)]
    }
    if (args.id && !rootNodes[0]) return nodeNotFound(args.id)
    const roots = rootNodes.filter((node): node is SceneNode => !!node)
    const intendedUse = (args.intended_use ?? 'commercial_use') as FontLicenseIntendedUse
    const maxUsages = Math.min(100, Math.max(1, Math.floor(args.max_usages_per_face ?? 50)))
    const collected = collectFontFaces(
      figma.graph,
      roots.map((node) => node.id)
    )
    const familyFilter = args.family?.trim().toLocaleLowerCase()
    const selectedFaces = familyFilter
      ? collected.faces.filter((face) => face.family.toLocaleLowerCase().includes(familyFilter))
      : collected.faces

    const fonts = await Promise.all(
      selectedFaces.map(async (face) => {
        const assessment = await assessLoadedFontLicense(face.family, face.style)
        const review = decisionFor(assessment, intendedUse)
        const resolution = fontResolver.state(fontFaceDemand(face.family, face.style))
        return {
          family: face.family,
          style: face.style,
          classification: assessment.classification,
          decision: review.decision,
          loaded: assessment.loaded,
          runtimeChannel: resolution.source ?? (assessment.loaded ? 'registered' : 'unknown'),
          license: assessment.license,
          embeddedMetadata: assessment.embeddedMetadata,
          evidence: assessment.evidence,
          usages: face.usages.slice(0, maxUsages),
          omittedUsageCount: Math.max(0, face.usages.length - maxUsages),
          review: {
            required: review.decision !== 'pass',
            reasons: review.reasons,
            obligations: review.obligations
          }
        }
      })
    )

    const decisions = new Set(fonts.map((font) => font.decision))
    let decision: FontLicenseDecision = 'pass'
    if (decisions.has('block')) decision = 'block'
    else if (decisions.has('review')) decision = 'review'
    const familyCount = new Set(fonts.map((font) => font.family.toLocaleLowerCase())).size
    let scopeKind = 'current_page'
    if (args.id) scopeKind = 'node_subtree'
    else if (args.all_pages) scopeKind = 'all_pages'

    return {
      scope: {
        kind: scopeKind,
        roots: roots.map((node) => ({ id: node.id, name: node.name, type: node.type }))
      },
      intendedUse,
      decision,
      summary: {
        textNodes: collected.textNodeIds.size,
        families: familyCount,
        faces: fonts.length,
        verifiedOpen: fonts.filter((font) => font.classification === 'verified_open').length,
        restricted: fonts.filter((font) => font.classification === 'restricted').length,
        unknown: fonts.filter((font) => font.classification === 'unknown').length,
        pass: fonts.filter((font) => font.decision === 'pass').length,
        review: fonts.filter((font) => font.decision === 'review').length,
        block: fonts.filter((font) => font.decision === 'block').length
      },
      fonts,
      limitations: [
        'This evidence-based audit is not legal advice.',
        'Installed, downloadable, renderable, or provider-listed fonts are not assumed to be free.',
        'OpenType name-table license text is self-reported and never upgrades a font to verified_open.',
        'runtimeChannel describes the renderer resolution channel, not authoritative font provenance.',
        'Hidden text is included so compliance findings are not suppressed by visibility.'
      ]
    }
  }
})
