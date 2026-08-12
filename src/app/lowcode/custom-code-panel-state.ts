import {
  compactLowcodeHeadMetadata,
  unsafeLowcodeCustomCSSURLs,
  unsafeLowcodeHeadMetaRefreshURL,
  validateLowcodeCustomCSS
} from '@open-pencil/core/lowcode-validation'
import type {
  LowcodeHeadLink,
  LowcodeHeadLinkCrossOrigin,
  LowcodeHeadMeta,
  LowcodeHeadMetaKind,
  LowcodeHeadMetadata
} from '@open-pencil/scene-graph'

export const LOWCODE_HEAD_META_KINDS: LowcodeHeadMetaKind[] = ['name', 'property', 'httpEquiv']

export const LOWCODE_HEAD_LINK_CROSS_ORIGINS: LowcodeHeadLinkCrossOrigin[] = [
  'anonymous',
  'use-credentials'
]

export interface CustomCodeDraft {
  meta: LowcodeHeadMeta[]
  link: LowcodeHeadLink[]
  stylesText: string
  customCss: string
}

export interface CustomCodePatch {
  lowcodeHeadMetadata?: LowcodeHeadMetadata
  lowcodeCustomCss?: string
}

export interface CustomCodeCspRisk {
  id: string
  kind:
    | 'inlineHeadStyle'
    | 'headStyleUnsafeUrl'
    | 'metaRefreshUnsafeUrl'
    | 'externalStylesheet'
    | 'externalLink'
    | 'customCssExternalResource'
    | 'customCssUnsafeUrl'
  url?: string
  rel?: string
  directive?: string
  title: string
  detail: string
}

export function emptyHeadMeta(): LowcodeHeadMeta {
  return { kind: 'name', key: '', content: '' }
}

export function emptyHeadLink(): LowcodeHeadLink {
  return { rel: '', href: '' }
}

export function draftFromCustomCode(
  head: LowcodeHeadMetadata | undefined,
  customCSS: string | undefined
): CustomCodeDraft {
  return {
    meta: head?.meta?.length ? head.meta.map((entry) => ({ ...entry })) : [],
    link: head?.link?.length ? head.link.map((entry) => ({ ...entry })) : [],
    stylesText: head?.styles?.join('\n\n') ?? '',
    customCss: customCSS ?? ''
  }
}

export function buildCustomCodePatch(draft: CustomCodeDraft): CustomCodePatch {
  const head = compactLowcodeHeadMetadata({
    meta: draft.meta,
    link: draft.link,
    styles: draft.stylesText.split(/\n{2,}/)
  })
  const customCSS = draft.customCss.trim()
  return {
    lowcodeHeadMetadata: head,
    lowcodeCustomCss: customCSS && validateLowcodeCustomCSS(customCSS).ok ? customCSS : undefined
  }
}

export function hasIncompleteCustomCodeRows(draft: CustomCodeDraft): boolean {
  return (
    draft.meta.some((entry) => {
      const key = entry.key.trim()
      const content = entry.content.trim()
      return (key || content) && (!key || !content)
    }) ||
    draft.link.some((entry) => {
      const rel = entry.rel.trim()
      const href = entry.href.trim()
      return (rel || href) && (!rel || !href)
    })
  )
}

export function hasUnsafeCustomCodeUrls(draft: CustomCodeDraft): boolean {
  return (
    unsafeLowcodeCustomCSSURLs(`${draft.stylesText}\n${draft.customCss}`).length > 0 ||
    draft.meta.some(
      (entry) => unsafeLowcodeHeadMetaRefreshURL(entry.kind, entry.key, entry.content) !== undefined
    )
  )
}

export function analyzeCustomCodeCspRisks(draft: CustomCodeDraft): CustomCodeCspRisk[] {
  const risks: CustomCodeCspRisk[] = []
  const styles = draft.stylesText.trim()
  const customCSS = draft.customCss.trim()
  if (styles) {
    risks.push({
      id: 'inline-head-style',
      kind: 'inlineHeadStyle',
      title: 'Inline head styles may require CSP allowance',
      detail:
        'Hosts with strict CSP must allow inline styles by nonce/hash or style-src unsafe-inline.'
    })
  }
  for (const url of unsafeLowcodeCustomCSSURLs(styles)) {
    risks.push({
      id: `head-style-unsafe-url:${url}`,
      kind: 'headStyleUnsafeUrl',
      url,
      title: 'Head style URL protocol will not be persisted',
      detail: `${url} uses a protocol outside the allowed http(s), protocol-relative, or relative URL set.`
    })
  }
  for (const meta of draft.meta) {
    const url = unsafeLowcodeHeadMetaRefreshURL(meta.kind, meta.key, meta.content)
    if (!url) continue
    risks.push({
      id: `head-meta-refresh-unsafe-url:${url}`,
      kind: 'metaRefreshUnsafeUrl',
      url,
      title: 'Meta refresh URL protocol will not be persisted',
      detail: `${url} uses a protocol outside the allowed http(s) or relative URL set.`
    })
  }

  for (const link of draft.link) {
    const rel = link.rel.trim().toLowerCase()
    const href = link.href.trim()
    if (!href || !isExternalURL(href)) continue
    if (rel === 'stylesheet') {
      risks.push({
        id: `external-stylesheet:${href}`,
        kind: 'externalStylesheet',
        url: href,
        title: 'External stylesheet needs style-src allowlist',
        detail: `${href} must be allowed by the deployed host CSP.`
      })
      continue
    }
    if (rel === 'preload' || rel === 'preconnect') {
      const directive = cspDirectiveForLink(link)
      risks.push({
        id: `external-${rel}:${href}`,
        kind: 'externalLink',
        url: href,
        rel,
        directive,
        title: `External ${rel} may need ${directive} allowlist`,
        detail: `${href} must be allowed by ${directive} or the matching resource directive.`
      })
    }
  }

  for (const url of cssExternalUrls(customCSS)) {
    risks.push({
      id: `custom-css-url:${url}`,
      kind: 'customCssExternalResource',
      url,
      title: 'Custom CSS references an external resource',
      detail: `${url} must be allowed by the deployed host CSP resource directives.`
    })
  }
  for (const url of unsafeLowcodeCustomCSSURLs(customCSS)) {
    risks.push({
      id: `custom-css-unsafe-url:${url}`,
      kind: 'customCssUnsafeUrl',
      url,
      title: 'Custom CSS URL protocol will not be persisted',
      detail: `${url} uses a protocol outside the allowed http(s), protocol-relative, or relative URL set.`
    })
  }

  return dedupeRisks(risks)
}

function isExternalURL(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('//')
}

function cspDirectiveForLink(link: LowcodeHeadLink): string {
  const asValue = link.as?.trim().toLowerCase()
  if (asValue === 'style') return 'style-src'
  if (asValue === 'font') return 'font-src'
  if (asValue === 'image') return 'img-src'
  if (asValue === 'script') return 'script-src'
  return 'connect-src'
}

function cssExternalUrls(css: string): string[] {
  const urls = new Set<string>()
  for (const match of css.matchAll(/@import\s+(?:url\()?["']?([^"')\s]+)["']?\)?/gi)) {
    const value = match[1]?.trim()
    if (value && isExternalURL(value)) urls.add(value)
  }
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const value = match[1]?.trim()
    if (value && isExternalURL(value)) urls.add(value)
  }
  return [...urls]
}

function dedupeRisks(risks: CustomCodeCspRisk[]): CustomCodeCspRisk[] {
  const seen = new Set<string>()
  return risks.filter((risk) => {
    if (seen.has(risk.id)) return false
    seen.add(risk.id)
    return true
  })
}
