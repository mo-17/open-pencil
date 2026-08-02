import { describe, expect, test } from 'bun:test'

import { compile, withDefaults, type CompilerFontManifest } from '@open-pencil/compiler'

import { fontBytesWithFsType } from '#tests/helpers/font-fixtures'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function compileFontFixture(manifest: CompilerFontManifest) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('TEXT', pageId, {
    text: 'WELCOME 惊悚乐园',
    fontFamily: 'Bebas Neue',
    fontWeight: 700,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: 1
  })
  return compile({
    graph,
    pageIds: [pageId],
    fontManifest: manifest,
    options: withDefaults({ packageName: 'font-fixture' })
  })
}

describe('compiler font manifest', () => {
  test('emits actual Regular bytes and keeps requested Bold for browser synthesis', () => {
    const bytes = new Uint8Array([0, 1, 0, 0, 0, 12])
    const out = compileFontFixture({
      faces: [
        {
          family: 'Bebas Neue',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'src/assets/fonts/bebas-neue-400-normal.ttf',
          content: bytes
        }
      ],
      fallbackFamilies: ['Noto Sans SC']
    })

    expect(out.files.get('src/assets/fonts/bebas-neue-400-normal.ttf')).toBe(bytes)
    const css = out.files.get('src/index.css') as string
    expect(css).toContain('@font-face{font-family:"Bebas Neue"')
    expect(css).toContain('url("./assets/fonts/bebas-neue-400-normal.ttf")')
    expect(css).toContain('font-weight:400')
    expect(css).toContain(
      '.font-\\[Bebas_Neue\\]{font-family:"Bebas Neue","Inter","Noto Sans SC",sans-serif}'
    )
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('font-bold')
    expect(app).toContain('font-[Bebas_Neue]')
    expect(app).toContain('leading-10')
    expect(app).toContain('tracking-px')
    expect(out.warnings.map((warning) => warning.code)).toContain('font-face-synthesized')
    expect(out.warnings.map((warning) => warning.code)).toContain('font-license-unverified')
  })

  test('keeps catalog policy distinct from an exact redistribution license', () => {
    const out = compileFontFixture({
      faces: [
        {
          family: 'Bebas Neue',
          weight: 400,
          style: 'normal',
          format: 'woff2',
          path: 'src/assets/fonts/bebas-neue-400-normal.woff2',
          content: new Uint8Array([1, 2, 3]),
          sourceProvider: 'google',
          licenseEvidence: {
            kind: 'provider_policy',
            policyUrl: 'https://developers.google.com/fonts/faq',
            policyCheckedAt: '2026-07-31'
          }
        }
      ]
    })
    expect(out.warnings.map((warning) => warning.code)).toContain('font-license-review-required')
    expect(out.warnings.map((warning) => warning.code)).not.toContain('font-license-unverified')
  })

  test('omits restricted embedding bytes even when caller evidence is missing', async () => {
    const path = 'src/assets/fonts/bebas-neue-700-normal.ttf'
    const source = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const out = compileFontFixture({
      faces: [
        {
          family: 'Bebas Neue',
          weight: 700,
          style: 'normal',
          format: 'truetype',
          path,
          content: new Uint8Array(fontBytesWithFsType(source, 0x0002))
        }
      ]
    })

    expect(out.files.has(path)).toBe(false)
    expect(out.files.get('src/index.css')).not.toContain(path)
    expect(out.warnings).toContainEqual(
      expect.objectContaining({
        code: 'font-license-embedding-restricted',
        message: expect.stringContaining('OS/2 fsType 0x0002')
      })
    )
    expect(out.warnings.map((warning) => warning.code)).toContain('font-face-unavailable')
    expect(out.warnings.map((warning) => warning.code)).not.toContain('font-license-unverified')
  })

  test('warns instead of silently claiming an unavailable face', () => {
    const out = compileFontFixture({ faces: [] })
    expect(out.warnings.map((warning) => warning.code)).toContain('font-face-unavailable')
    expect(out.files.has('src/assets/fonts/bebas-neue-700-normal.woff2')).toBe(false)
  })

  test('rejects caller paths that escape the generated font asset directory', () => {
    const out = compileFontFixture({
      faces: [
        {
          family: 'Bebas Neue',
          weight: 700,
          style: 'normal',
          format: 'woff2',
          path: '../outside.woff2',
          content: new Uint8Array([1])
        }
      ]
    })
    expect(out.files.has('../outside.woff2')).toBe(false)
    expect(out.warnings.map((warning) => warning.code)).toContain('font-asset-path-invalid')
    expect(out.warnings.map((warning) => warning.code)).toContain('font-face-unavailable')
  })

  test('projects BUTTON label typography into generated control classes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const button = graph.createNode('BUTTON', pageId, {
      fontSize: 18,
      fontWeight: 700,
      italic: true,
      interactiveProps: { text: 'Continue' }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults() })
    const line = (out.files.get('src/App.tsx') as string)
      .split('\n')
      .find((value) => value.includes(`data-node-id="${button.id}"`))
    expect(line).toContain('text-lg')
    expect(line).toContain('font-bold')
    expect(line).toContain('italic')
  })

  test('uses the normalized family in both emitted classes and font-face CSS', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('TEXT', pageId, {
      text: 'Variable family',
      fontFamily: 'Compiler Fixture Variable'
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      fontManifest: {
        faces: [
          {
            family: 'Compiler Fixture',
            weight: 400,
            style: 'normal',
            format: 'truetype',
            path: 'src/assets/fonts/compiler-fixture.ttf',
            content: new Uint8Array([0, 1, 0, 0])
          }
        ]
      },
      options: withDefaults()
    })
    const app = out.files.get('src/App.tsx') as string
    const css = out.files.get('src/index.css') as string

    expect(app).toContain('font-[Compiler_Fixture]')
    expect(app).not.toContain('font-[Compiler_Fixture_Variable]')
    expect(css).toContain('@font-face{font-family:"Compiler Fixture"')
    expect(css).toContain(
      '.font-\\[Compiler_Fixture\\]{font-family:"Compiler Fixture","Inter",sans-serif}'
    )
  })
})
