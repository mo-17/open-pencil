import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { VR_TOUR_DEPENDENCIES } from '#compiler/adapters/vr-tour/source'
import { compileScript, parse } from 'vue/compiler-sfc'

import { buildBrowserPreview } from '@open-pencil/compiler/browser-preview'
import { previewOptimizeDeps } from '@open-pencil/compiler/dev-server'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'

import { browserPreviewInput } from '../browser-preview/helpers'
import { compileTour, tourFixture } from './helpers'

describe('VR tour compiler integration', () => {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} exports a pinned local sphere renderer and a live selected-property binding`, () => {
      const { graph, pageId } = tourFixture({ kind: 'expr', expr: 'selectedProperty.panorama_url' })
      const ir = collectTree(graph, pageId)
      expect(ir.docStateReads).toContain('selectedProperty')
      expect((ir.children[0] as IRElement).module?.panoramaUrlExpr?.kind).toBe('member')
      const output = compileTour(target, { kind: 'expr', expr: 'selectedProperty.panorama_url' })
      expect(output.warnings.filter((warning) => warning.code.startsWith('vr-tour-'))).toEqual([])
      const manifest = JSON.parse(String(output.files.get('package.json')))
      for (const [name, version] of Object.entries(VR_TOUR_DEPENDENCIES))
        expect(manifest.dependencies[name]).toBe(version)
      expect(previewOptimizeDeps(output.files, target)).toEqual(
        expect.arrayContaining(Object.keys(VR_TOUR_DEPENDENCIES))
      )
      const extension = target === 'react' ? 'tsx' : 'vue'
      const runtime = String(output.files.get(`src/__openpencil_vr_tour.${extension}`))
      expect(runtime).toContain('new Viewer(')
      expect(runtime).toContain('previous?.destroy()')
      const page = String(
        output.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
      )
      expect(page).toContain(
        target === 'react' ? 'panoramaBound panoramaUrl=' : ':panorama-bound="true"'
      )
      expect(page).toContain('selectedProperty')
      if (target === 'vue') {
        const sfc = parse(runtime)
        expect(sfc.errors).toEqual([])
        expect(() => compileScript(sfc.descriptor, { id: 'vr-tour' })).not.toThrow()
      }
      const base = process.env.OPENPENCIL_VR_TOUR_VERIFY_DIR
      if (base)
        for (const [path, content] of output.files) {
          const destination = join(base, target, path)
          mkdirSync(dirname(destination), { recursive: true })
          writeFileSync(destination, content)
        }
    })
  }

  test('invalid or write-only bindings remain explicitly bound and never revert to static panoramas', () => {
    for (const expr of ['unknown.panorama_url', '$prev', 'fetch("https://example.com")']) {
      const { graph, pageId } = tourFixture({ kind: 'expr', expr })
      const ir = collectTree(graph, pageId)
      expect((ir.children[0] as IRElement).module?.panoramaUrlExpr).toEqual({
        kind: 'ident',
        name: 'undefined'
      })
      expect(ir.warnings.some((warning) => warning.code.startsWith('vr-tour-binding-'))).toBe(true)
    }
  })

  test('browser sandbox rejects the sphere runtime without weakening network policy', async () => {
    const result = await buildBrowserPreview(
      await browserPreviewInput(compileTour('react', undefined, true).files)
    )
    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).toContain('browser-preview-vr-tour-runtime-unsupported')
  })
})
