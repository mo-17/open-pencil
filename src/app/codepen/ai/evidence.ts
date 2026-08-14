import {
  CODEPEN_SOURCE_KINDS,
  type CodePenSourceKind,
  type CodePenStaticEvidence
} from '../contracts'
import { createCodePenStaticEvidence, verifyCodePenStaticEvidenceIntegrity } from '../evidence'
import { CODEPEN_AI_LIMITS, type CodePenAIEvidenceSummary } from './contracts'
import { deriveCodePenAIVisualOutline, type CodePenAIVisualOutline } from './visual-outline'

const DERIVED_HTML_TAGS = Object.freeze([
  'header',
  'nav',
  'main',
  'section',
  'article',
  'aside',
  'footer',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'button',
  'input',
  'form',
  'img',
  'svg'
] as const)

function countMatches(value: string, pattern: RegExp): number {
  let count = 0
  for (const _ of value.matchAll(pattern)) count++
  return count
}

function deriveTagCounts(html: string): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const tag of DERIVED_HTML_TAGS) {
    const count = countMatches(html, new RegExp(`<${tag}\\b`, 'gi'))
    if (count > 0) counts[tag] = count
  }
  return Object.freeze(counts)
}

function deriveColors(html: string, css: string): readonly string[] {
  const colors = new Map<string, number>()
  for (const source of [html, css]) {
    for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const color = match[0].toUpperCase()
      colors.set(color, (colors.get(color) ?? 0) + 1)
    }
  }
  return Object.freeze(
    [...colors]
      .sort(
        ([left, leftCount], [right, rightCount]) =>
          rightCount - leftCount || left.localeCompare(right)
      )
      .slice(0, CODEPEN_AI_LIMITS.maxDerivedColors)
      .map(([color]) => color)
  )
}

function deriveBreakpoints(css: string): readonly number[] {
  const breakpoints = new Set<number>()
  for (const match of css.matchAll(/@media[^{}]{0,512}(?:min|max)-width\s*:\s*(\d{1,5})px/gi)) {
    const width = Number(match[1])
    if (width > 0 && width <= 100_000) breakpoints.add(width)
    if (breakpoints.size >= CODEPEN_AI_LIMITS.maxDerivedBreakpoints) break
  }
  return Object.freeze([...breakpoints].sort((left, right) => left - right))
}

function deriveVisualFacts(
  evidence: CodePenStaticEvidence
): CodePenAIEvidenceSummary['derivedVisualFacts'] {
  const html = evidence.payload.sources.html.text
  const css = evidence.payload.sources.css.text
  return Object.freeze({
    htmlTagCounts: deriveTagCounts(html),
    colors: deriveColors(html, css),
    mediaBreakpointsPx: deriveBreakpoints(css),
    flexDeclarationCount: countMatches(css, /\bdisplay\s*:\s*(?:inline-)?flex\b/gi),
    gridDeclarationCount: countMatches(css, /\bdisplay\s*:\s*(?:inline-)?grid\b/gi),
    absolutePositionDeclarationCount: countMatches(css, /\bposition\s*:\s*(?:absolute|fixed)\b/gi),
    animationDeclarationCount: countMatches(css, /(?:@keyframes\b|\banimation(?:-name)?\s*:)/gi)
  })
}

function resourceCounts(
  evidence: CodePenStaticEvidence
): CodePenAIEvidenceSummary['resourceCounts'] {
  const byScheme: Record<string, number> = {}
  const byKind: Record<string, number> = {}
  for (const resource of evidence.payload.resources) {
    byScheme[resource.scheme] = (byScheme[resource.scheme] ?? 0) + 1
    for (const kind of resource.kinds) byKind[kind] = (byKind[kind] ?? 0) + 1
  }
  return Object.freeze({
    total: evidence.payload.resources.length,
    byScheme: Object.freeze(byScheme),
    byKind: Object.freeze(byKind)
  })
}

function sourceMetadata(evidence: CodePenStaticEvidence): Readonly<{
  bytes: Readonly<Record<CodePenSourceKind, number>>
  digests: Readonly<Record<CodePenSourceKind, string>>
}> {
  const bytes = {} as Record<CodePenSourceKind, number>
  const digests = {} as Record<CodePenSourceKind, string>
  for (const kind of CODEPEN_SOURCE_KINDS) {
    bytes[kind] = evidence.payload.sources[kind].byteLength
    digests[kind] = evidence.payload.sources[kind].digest
  }
  return Object.freeze({ bytes: Object.freeze(bytes), digests: Object.freeze(digests) })
}

/**
 * Convert normalized untrusted evidence to a bounded allowlist of numeric
 * facts and literal visual structure. Raw source, comments, executable syntax,
 * risk messages, and resource URLs never cross this boundary into the AI result.
 */
export function summarizeCodePenEvidence(
  evidence: CodePenStaticEvidence,
  visualOutline: CodePenAIVisualOutline = deriveCodePenAIVisualOutline({
    html: evidence.payload.sources.html.text,
    css: evidence.payload.sources.css.text,
    js: evidence.payload.sources.js.text
  })
): CodePenAIEvidenceSummary {
  const source = sourceMetadata(evidence)
  return Object.freeze({
    evidenceDigest: evidence.integrity.digest,
    pen: Object.freeze({
      url: evidence.payload.pen.url,
      owner: evidence.payload.pen.owner,
      slug: evidence.payload.pen.slug
    }),
    sourceBytes: source.bytes,
    sourceDigests: source.digests,
    riskCounts: Object.freeze({
      blockers: evidence.payload.summary.blockers,
      warnings: evidence.payload.summary.warnings,
      infos: evidence.payload.summary.infos
    }),
    risks: Object.freeze(
      evidence.payload.risks.map((risk) =>
        Object.freeze({
          code: risk.code,
          severity: risk.severity,
          source: risk.source,
          count: risk.count
        })
      )
    ),
    resourceCounts: resourceCounts(evidence),
    derivedVisualFacts: deriveVisualFacts(evidence),
    visualOutline,
    policy: Object.freeze({
      sourceInstructions: 'ignored-as-untrusted-data',
      rawSourceReturnedToAI: false,
      sourceCodeExecution: 'blocked',
      externalResourceFetching: 'blocked',
      liveGraphMutation: 'blocked'
    })
  })
}

/** Re-run the complete bounded analyzer rather than trusting imported fields. */
export async function normalizeCodePenAIEvidence(
  evidence: CodePenStaticEvidence
): Promise<CodePenStaticEvidence> {
  const suppliedDigest = await verifyCodePenStaticEvidenceIntegrity(evidence)
  const normalized = await createCodePenStaticEvidence({
    penURL: evidence.payload.pen.url,
    sources: {
      html: {
        text: evidence.payload.sources.html.text,
        mediaType: evidence.payload.sources.html.mediaType
      },
      css: {
        text: evidence.payload.sources.css.text,
        mediaType: evidence.payload.sources.css.mediaType
      },
      js: {
        text: evidence.payload.sources.js.text,
        mediaType: evidence.payload.sources.js.mediaType
      }
    }
  })
  if (normalized.integrity.digest !== suppliedDigest) {
    throw new Error('CodePen evidence does not match normalized static analysis')
  }
  if (!normalized.payload.summary.safeForStaticAIAnalysis) {
    throw new Error('CodePen evidence contains secret-like material and is blocked from AI')
  }
  return normalized
}
