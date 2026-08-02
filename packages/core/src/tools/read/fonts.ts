import { uniq } from 'es-toolkit/array'

import { DEFAULT_FONT_FAMILY } from '#core/constants'
import type { FigmaAPI } from '#core/figma-api'
import { parseFontStyle } from '#core/text/face'
import { fontManager, weightToStyle } from '#core/text/fonts'
import { buttonLabelTextNode } from '#core/text/lowcode'
import {
  requiredNodeFontFaceUsages,
  type NodeFontFace,
  type NodeFontScope
} from '#core/text/requirements'
import {
  fontFaceDemand,
  fontResolver,
  type FontCandidateSource,
  type FontResolutionState
} from '#core/text/resolver'
import { defineTool, nodeNotFound } from '#core/tools/schema'

export type FontAssignment = 'match' | 'partial' | 'mismatch' | 'not_checked'
export type FontCheckStatus =
  | 'effective'
  | 'degraded'
  | 'pending'
  | 'failed'
  | 'exhausted'
  | 'unverifiable'
  | 'mismatch'
export type FontFaceMode = 'exact' | 'synthesized' | 'pending' | 'unavailable' | 'unverified'
export type NodeFontReadiness = 'ready' | 'pending' | 'exhausted' | 'unavailable'

export interface FontFaceCheck extends NodeFontFace {
  scopes: NodeFontScope[]
  exactLoaded: boolean
  familyLoaded: boolean
  mode: FontFaceMode
  resolution: {
    state: FontResolutionState
    source?: FontCandidateSource
    candidate?: { family: string; style: string; source: FontCandidateSource }
    error?: string
  }
}

export interface FontRenderingCheckResult {
  id: string
  name: string
  nodeType: 'TEXT' | 'BUTTON'
  contentKind: 'text' | 'button_label'
  textPreview: string
  authored: { family: string; style: string }
  expected: { family?: string; style?: string } | null
  assignment: FontAssignment
  status: FontCheckStatus
  renderStatus: Exclude<FontCheckStatus, 'mismatch'>
  readiness: NodeFontReadiness
  effective: boolean | null
  exactFacesLoaded: boolean
  faces: FontFaceCheck[]
  caveats: string[]
}

function sameFamily(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
}

function canonicalStyle(style: string): string {
  const parsed = parseFontStyle(style)
  return weightToStyle(parsed.weight, parsed.italic)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function faceMode(
  readiness: NodeFontReadiness,
  exactLoaded: boolean,
  familyLoaded: boolean
): FontFaceMode {
  if (exactLoaded) return 'exact'
  if (readiness === 'unavailable') return 'unverified'
  if (readiness === 'pending') return 'pending'
  if (readiness === 'ready' && familyLoaded) return 'synthesized'
  return 'unavailable'
}

function assignmentFor(
  faces: NodeFontFace[],
  expectedFamily?: string,
  expectedStyle?: string
): FontAssignment {
  if (!expectedFamily && !expectedStyle) return 'not_checked'
  const normalizedStyle = expectedStyle ? canonicalStyle(expectedStyle) : undefined
  const matches = faces.map(
    (face) =>
      (!expectedFamily || sameFamily(face.family, expectedFamily)) &&
      (!normalizedStyle || face.style === normalizedStyle)
  )
  if (matches.every(Boolean)) return 'match'
  return matches.some(Boolean) ? 'partial' : 'mismatch'
}

function renderStatus(
  readiness: NodeFontReadiness,
  faces: FontFaceCheck[]
): Exclude<FontCheckStatus, 'mismatch'> {
  if (readiness === 'unavailable') return 'unverifiable'
  if (readiness === 'pending') return 'pending'
  if (readiness === 'exhausted') {
    return faces.some((face) => face.resolution.state === 'failed') ? 'failed' : 'exhausted'
  }
  return faces.every((face) => face.exactLoaded) ? 'effective' : 'degraded'
}

function checkCaveats(
  assignment: FontAssignment,
  status: FontCheckStatus,
  readiness: NodeFontReadiness
): string[] {
  const caveats: string[] = []
  if (assignment === 'partial' || assignment === 'mismatch') {
    caveats.push(
      'The expected font is not assigned to every base/style-run scope in this text node.'
    )
  }
  if (readiness === 'unavailable') {
    caveats.push(
      'No live CanvasKit renderer is attached; run this through a connected OpenPencil app.'
    )
  } else if (readiness === 'pending') {
    caveats.push(
      'Font resolution is still pending; call check_font again after the renderer settles.'
    )
  } else if (status === 'degraded') {
    caveats.push(
      'At least one exact style is unavailable; CanvasKit is synthesizing weight or slant from another loaded face in the same family.'
    )
  } else if (readiness === 'exhausted') {
    caveats.push('The renderer could not resolve every requested face or required glyph.')
  }
  if (readiness === 'ready') {
    caveats.push(
      'Glyph coverage is resolved, but CanvasKit does not expose which fallback family shaped each glyph.'
    )
  }
  return caveats
}

/** Shared single-node inspection used by `check_font` and the bounded
 * document audit. BUTTON labels are projected through the same text model the
 * CanvasKit lowcode renderer uses, while every other non-TEXT node is rejected. */
export function inspectNodeFontRendering(
  figma: FigmaAPI,
  id: string,
  expectedFamily?: string,
  expectedStyle?: string
): FontRenderingCheckResult | { error: string } {
  const rawNode = figma.graph.getNode(id)
  if (!rawNode) return nodeNotFound(id)
  const buttonLabel = buttonLabelTextNode(rawNode)
  const node = buttonLabel ?? rawNode
  if (node.type !== 'TEXT') return { error: `Node "${id}" is not a text node or labelled BUTTON` }

  const readiness = figma.getNodeFontReadiness(rawNode.id)
  const requiredFaceUsages = requiredNodeFontFaceUsages(node)
  const requiredFaces = requiredFaceUsages.map(({ family, style }) => ({ family, style }))
  const faces: FontFaceCheck[] = requiredFaceUsages.map((face) => {
    const exactLoaded = fontManager.isStyleLoaded(face.family, face.style)
    const familyLoaded = fontManager.isLoaded(face.family)
    const snapshot = fontResolver.state(fontFaceDemand(face.family, face.style, node.text))
    let source = snapshot.source
    if (exactLoaded && snapshot.state !== 'loaded') source = 'registered'
    else if (exactLoaded) source ??= 'registered'
    return {
      ...face,
      scopes: face.scopes,
      exactLoaded,
      familyLoaded,
      mode: faceMode(readiness, exactLoaded, familyLoaded),
      resolution: {
        state: exactLoaded ? 'loaded' : snapshot.state,
        ...(source ? { source } : {}),
        ...(snapshot.candidate
          ? {
              candidate: {
                family: snapshot.candidate.family,
                style: snapshot.candidate.style,
                source: snapshot.candidate.source
              }
            }
          : {}),
        ...(snapshot.error === undefined ? {} : { error: errorMessage(snapshot.error) })
      }
    }
  })
  const assignment = assignmentFor(requiredFaces, expectedFamily, expectedStyle)
  const rendererStatus = renderStatus(readiness, faces)
  const status: FontCheckStatus =
    assignment === 'partial' || assignment === 'mismatch' ? 'mismatch' : rendererStatus
  let effective: boolean | null = true
  if (status === 'mismatch' || status === 'failed' || status === 'exhausted') {
    effective = false
  } else if (status === 'pending' || status === 'unverifiable') {
    effective = null
  }
  const expected =
    expectedFamily || expectedStyle
      ? {
          ...(expectedFamily ? { family: expectedFamily } : {}),
          ...(expectedStyle ? { style: canonicalStyle(expectedStyle) } : {})
        }
      : null
  return {
    id: rawNode.id,
    name: rawNode.name,
    nodeType: buttonLabel ? 'BUTTON' : 'TEXT',
    contentKind: buttonLabel ? 'button_label' : 'text',
    textPreview: node.text.length > 80 ? `${node.text.slice(0, 77)}...` : node.text,
    authored: {
      family: node.fontFamily || DEFAULT_FONT_FAMILY,
      style: weightToStyle(node.fontWeight || 400, node.italic)
    },
    expected,
    assignment,
    status,
    renderStatus: rendererStatus,
    readiness,
    effective,
    exactFacesLoaded: faces.every((face) => face.exactLoaded),
    faces,
    caveats: checkCaveats(assignment, status, readiness)
  }
}

export const checkFont = defineTool({
  name: 'check_font',
  description:
    'Verify whether a text node or lowcode BUTTON label font is actually effective in the live CanvasKit renderer. ' +
    'Reports base and style-run assignments, exact face loading, resolver source, synthesized-style ' +
    'degradation, pending/exhausted glyph coverage, and optional expected family/style matching. ' +
    'A pending or renderer-unavailable result is never reported as success; call again when pending.',
  params: {
    id: { type: 'string', description: 'TEXT or labelled lowcode BUTTON node ID', required: true },
    expected_family: {
      type: 'string',
      description: 'Optional font family expected across the node and all styled ranges'
    },
    expected_style: {
      type: 'string',
      description: 'Optional font style expected across the node and all styled ranges'
    }
  },
  execute: (figma, args) =>
    inspectNodeFontRendering(figma, args.id, args.expected_family, args.expected_style)
})

export const listFonts = defineTool({
  name: 'list_fonts',
  description: 'List fonts used in the current page.',
  params: {
    family: { type: 'string', description: 'Filter by family name (substring)' }
  },
  execute: (figma, args) => {
    const fonts = new Map<string, Set<number>>()
    const page = figma.currentPage
    page.findAll((node) => {
      if (node.type === 'TEXT') {
        const raw = figma.graph.getNode(node.id)
        if (raw) {
          const key = raw.fontFamily
          if (!fonts.has(key)) fonts.set(key, new Set())
          fonts.get(key)?.add(raw.fontWeight)
        }
      }
      return false
    })
    let result = [...fonts.entries()].map(([family, weights]) => ({
      family,
      weights: [...weights].sort((a, b) => a - b)
    }))
    if (args.family) {
      const q = args.family.toLowerCase()
      result = result.filter((font) => font.family.toLowerCase().includes(q))
    }
    return { count: result.length, fonts: result }
  }
})

export const listAvailableFonts = defineTool({
  name: 'list_available_fonts',
  description:
    'List font families the host can render (system fonts on desktop plus any bundled fonts). ' +
    'Use this to discover what fonts are available to set on a text node — distinct from list_fonts ' +
    'which only reports families currently used in the page. Use check_font after assignment to ' +
    'verify actual CanvasKit loading and glyph readiness.',
  params: {
    family: { type: 'string', description: 'Filter by family name (substring, case-insensitive)' }
  },
  execute: async (figma, args) => {
    const fonts = await figma.listAvailableFontsAsync()
    let families = uniq(fonts.map((font) => font.fontName.family))
    if (args.family) {
      const q = args.family.toLowerCase()
      families = families.filter((family) => family.toLowerCase().includes(q))
    }
    families.sort((a, b) => a.localeCompare(b))
    return { count: families.length, fonts: families }
  }
})
