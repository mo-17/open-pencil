import { describe, expect, test } from 'bun:test'

import {
  BUNDLED_FONT_LICENSE_MANIFEST,
  buildBundledFontRedistributionNotice,
  fontManager
} from '@open-pencil/core/text'

import { getTool, setupToolTest } from '#tests/helpers/tools'

interface FontLicenseAuditResult {
  error?: string
  decision?: string
  intendedUse?: string
  summary?: {
    textNodes: number
    families: number
    faces: number
    verifiedOpen: number
    restricted: number
    unknown: number
    pass: number
    review: number
    block: number
  }
  fonts?: Array<{
    family: string
    style: string
    classification: string
    decision: string
    loaded: boolean
    license: { id: string } | null
    embeddedMetadata: { candidateLicenseId?: string } | null
    usages: Array<{
      nodeId: string
      pageId: string
      scope: { kind: string; start?: number; end?: number }
    }>
    review: { required: boolean; reasons: string[]; obligations: string[] }
  }>
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('')
}

describe('bundled font license manifest', () => {
  test('matches every shipped font artifact and the shipped OFL text', async () => {
    for (const face of BUNDLED_FONT_LICENSE_MANIFEST.fonts) {
      const bytes = await Bun.file(`packages/core/assets${face.assetPath}`).arrayBuffer()
      expect(await digest(bytes)).toBe(face.sha256)
      expect(BUNDLED_FONT_LICENSE_MANIFEST.licenses[face.licenseId]).toBeDefined()
    }

    for (const license of Object.values(BUNDLED_FONT_LICENSE_MANIFEST.licenses)) {
      const bytes = await Bun.file(`packages/core/assets/${license.textPath}`).arrayBuffer()
      expect(await digest(bytes)).toBe(license.textSha256)
    }

    const webNotice = await Bun.file('public/FONT-LICENSES.txt').text()
    expect(webNotice).toContain('SIL OPEN FONT LICENSE Version 1.1')
    for (const copyright of new Set(
      BUNDLED_FONT_LICENSE_MANIFEST.fonts.map((face) => face.copyright)
    )) {
      expect(webNotice).toContain(copyright)
    }

    const generatedNotice = buildBundledFontRedistributionNotice(
      BUNDLED_FONT_LICENSE_MANIFEST.fonts.map(({ family, style }) => ({ family, style }))
    )
    expect(generatedNotice).toContain('SIL OPEN FONT LICENSE Version 1.1')
    for (const copyright of new Set(
      BUNDLED_FONT_LICENSE_MANIFEST.fonts.map((face) => face.copyright)
    )) {
      expect(generatedNotice).toContain(copyright)
    }
  })
})

describe('audit_font_licenses', () => {
  test('passes an exact loaded bundled font digest with OFL obligations', async () => {
    const { graph, figma } = setupToolTest()
    const bytes = await fontManager.fetchBundledFont('/Inter-Regular.ttf')
    expect(bytes).toBeTruthy()
    if (!bytes) return
    fontManager.markLoaded('Inter', 'Regular', bytes)
    const node = graph.createNode('TEXT', figma.currentPageId, {
      name: 'Licensed text',
      text: 'Verified',
      fontFamily: 'Inter',
      fontWeight: 400
    })

    const result = (await getTool('audit_font_licenses').execute(figma, {
      intended_use: 'redistribution'
    })) as FontLicenseAuditResult

    expect(result.decision).toBe('pass')
    expect(result.intendedUse).toBe('redistribution')
    expect(result.summary).toMatchObject({
      textNodes: 1,
      families: 1,
      faces: 1,
      verifiedOpen: 1,
      unknown: 0,
      pass: 1
    })
    expect(result.fonts?.[0]).toMatchObject({
      family: 'Inter',
      style: 'Regular',
      classification: 'verified_open',
      decision: 'pass',
      loaded: true,
      license: { id: 'OFL-1.1' },
      usages: [{ nodeId: node.id, scope: { kind: 'base' } }],
      review: { required: false }
    })
    expect(result.fonts?.[0]?.review.obligations.length).toBeGreaterThan(0)
  })

  test('keeps self-reported OFL and unloaded style-run fonts in manual review', async () => {
    const { graph, figma } = setupToolTest()
    const bytes = await fontManager.fetchBundledFont('/Inter-Regular.ttf')
    expect(bytes).toBeTruthy()
    if (!bytes) return
    const renamedFamily = 'OpenPencil Self Reported OFL'
    fontManager.markLoaded(renamedFamily, 'Regular', bytes)
    const missingFamily = 'OpenPencil Unknown Range Font'
    const node = graph.createNode('TEXT', figma.currentPageId, {
      name: 'Mixed license evidence',
      text: 'HelloWorld',
      fontFamily: renamedFamily,
      fontWeight: 400,
      styleRuns: [
        {
          start: 5,
          length: 5,
          style: { fontFamily: missingFamily, fontWeight: 700 }
        }
      ]
    })

    const result = (await getTool('audit_font_licenses').execute(
      figma,
      {}
    )) as FontLicenseAuditResult

    expect(result.decision).toBe('review')
    expect(result.summary).toMatchObject({
      textNodes: 1,
      families: 2,
      faces: 2,
      verifiedOpen: 0,
      unknown: 2,
      review: 2
    })
    expect(result.fonts?.[0]?.classification).toBe('unknown')
    expect(result.fonts?.find((font) => font.family === renamedFamily)).toMatchObject({
      loaded: true,
      embeddedMetadata: { candidateLicenseId: 'OFL-1.1' },
      review: { required: true }
    })
    expect(result.fonts?.find((font) => font.family === missingFamily)).toMatchObject({
      style: 'Bold',
      loaded: false,
      usages: [{ nodeId: node.id, scope: { kind: 'style_run', start: 5, end: 10 } }]
    })
  })

  test('supports a subtree including low-code labels and validates scope arguments', async () => {
    const { graph, figma } = setupToolTest()
    const frame = graph.createNode('FRAME', figma.currentPageId, { name: 'Audit root' })
    const button = graph.createNode('BUTTON', frame.id, {
      name: 'Submit button',
      fontFamily: 'OpenPencil Button License Unknown',
      fontWeight: 600,
      interactiveProps: { text: 'Submit' }
    })
    graph.createNode('TEXT', figma.currentPageId, {
      text: 'Outside subtree',
      fontFamily: 'Outside Font'
    })
    const tool = getTool('audit_font_licenses')

    const result = (await tool.execute(figma, {
      id: frame.id,
      max_usages_per_face: 1
    })) as FontLicenseAuditResult
    const invalid = (await tool.execute(figma, {
      id: frame.id,
      all_pages: true
    })) as FontLicenseAuditResult
    const missing = (await tool.execute(figma, {
      id: 'missing-license-root'
    })) as FontLicenseAuditResult

    expect(result.summary).toMatchObject({ textNodes: 1, families: 1, faces: 1, unknown: 1 })
    expect(result.fonts?.[0]).toMatchObject({
      style: 'SemiBold',
      usages: [{ nodeId: button.id, scope: { kind: 'base' } }]
    })
    expect(invalid.error).toContain('cannot be used together')
    expect(missing.error).toContain('not found')
  })

  test('includes INPUT placeholders and TEXTAREA values in scoped license usage', async () => {
    const { graph, figma } = setupToolTest()
    const frame = graph.createNode('FRAME', figma.currentPageId, { name: 'Form fields' })
    const inputFamily = 'OpenPencil Input License Unknown'
    const textareaFamily = 'OpenPencil Textarea License Unknown'
    const input = graph.createNode('INPUT', frame.id, {
      name: 'Email input',
      fontFamily: inputFamily,
      fontWeight: 400,
      interactiveProps: { placeholder: 'Email address', value: '' }
    })
    const textarea = graph.createNode('TEXTAREA', frame.id, {
      name: 'Notes textarea',
      fontFamily: textareaFamily,
      fontWeight: 700,
      interactiveProps: { placeholder: 'Ignored placeholder', value: 'Saved note' }
    })

    const result = (await getTool('audit_font_licenses').execute(figma, {
      id: frame.id
    })) as FontLicenseAuditResult

    expect(result.summary).toMatchObject({
      textNodes: 2,
      families: 2,
      faces: 2,
      unknown: 2,
      review: 2
    })
    expect(result.fonts?.find((font) => font.family === inputFamily)).toMatchObject({
      style: 'Regular',
      usages: [{ nodeId: input.id, scope: { kind: 'base' } }]
    })
    expect(result.fonts?.find((font) => font.family === textareaFamily)).toMatchObject({
      style: 'Bold',
      usages: [{ nodeId: textarea.id, scope: { kind: 'base' } }]
    })
  })

  test('expands from the current page to every page only when requested', async () => {
    const { graph, figma } = setupToolTest()
    const family = 'OpenPencil Cross Page License Unknown'
    graph.createNode('TEXT', figma.currentPageId, { text: 'First', fontFamily: family })
    const secondPage = graph.addPage('Second page')
    graph.createNode('TEXT', secondPage.id, { text: 'Second', fontFamily: family })
    const tool = getTool('audit_font_licenses')

    const currentPage = (await tool.execute(figma, {})) as FontLicenseAuditResult
    const allPages = (await tool.execute(figma, { all_pages: true })) as FontLicenseAuditResult

    expect(currentPage.summary).toMatchObject({ textNodes: 1, faces: 1 })
    expect(currentPage.fonts?.[0]?.usages).toHaveLength(1)
    expect(allPages.summary).toMatchObject({ textNodes: 2, faces: 1 })
    expect(allPages.fonts?.[0]?.usages).toHaveLength(2)
  })
})
