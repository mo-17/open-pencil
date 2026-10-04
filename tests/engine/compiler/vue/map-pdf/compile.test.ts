import { expect, test } from 'bun:test'

import { MAP_VUE_MODULE_ADAPTER } from '#compiler/adapters/vue/modules/map'
import { buildOpenPencilVuePDFViewer } from '#compiler/adapters/vue/modules/pdf-viewer'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createMapModuleFrameOverrides,
  createPDFViewerModuleFrameOverrides
} from '@open-pencil/core/plugins'

import { mapPDFFixture } from '#tests/helpers/compiler/modules/map-pdf/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

test.each(['map', 'pdf'] as const)(
  'Vue %s production output and development SFCs typecheck against installed dependencies',
  (kind) => {
    for (const devMode of [false, true]) {
      // Keep unrelated preview bridge diagnostics outside this module type fixture.
      // Both runtime variants are the exact adapter output, with a real Vue entry app.
      const output = mapPDFFixture(kind, false, true)
      if (devMode)
        output.files.set(
          kind === 'map' ? 'src/__openpencil_map.vue' : 'src/__openpencil_pdf_viewer.vue',
          kind === 'map'
            ? MAP_VUE_MODULE_ADAPTER.buildRuntime({ devMode })
            : buildOpenPencilVuePDFViewer({ devMode })
        )
      expect(output.warnings).toEqual([])
      const files = new Map<string, string>()
      for (const [path, value] of output.files)
        if (typeof value === 'string') files.set(path, value)
      expect(() => typeCheckCompilerFiles(files, 'vue')).not.toThrow()
    }
  },
  40000
)

test('React Map public generated API still typechecks after the shared kernel extraction', () => {
  const graph = makeSceneGraph(),
    pageId = firstPageId(graph)
  graph.createNode('FRAME', pageId, createMapModuleFrameOverrides({ interactive: false }))
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target: 'react', devMode: false })
  })
  expect(output.warnings).toEqual([])
  const files = new Map<string, string>()
  for (const [path, value] of output.files) if (typeof value === 'string') files.set(path, value)
  expect(() => typeCheckCompilerFiles(files, 'react')).not.toThrow()
}, 35000)

test('PDF unsafe source validation stays at the reviewed module boundary', () => {
  for (const sourceURL of [
    ['java', 'script:alert(1)'].join(''),
    '//assets.example.com/document.pdf',
    'https://localhost/document.pdf',
    '/encoded/%252e%252e/private.pdf',
    'https://user:secret@assets.example.com/document.pdf',
    'https://assets.example.com/document.pdf#page=2'
  ]) {
    expect(() => createPDFViewerModuleFrameOverrides({ sourceUrl: sourceURL })).toThrow()
  }
  expect(() =>
    createPDFViewerModuleFrameOverrides({ sourceUrl: '/fixtures/local.pdf' })
  ).not.toThrow()
})

test('Vue Map/PDF retain authored children and appear only when their validated modules are reachable', () => {
  const map = mapPDFFixture('map'),
    pdf = mapPDFFixture('pdf')
  const mapPackage = JSON.parse(String(map.files.get('package.json'))) as {
    dependencies: Record<string, string>
  }
  const pdfPackage = JSON.parse(String(pdf.files.get('package.json'))) as {
    dependencies: Record<string, string>
  }
  expect(mapPackage.dependencies['maplibre-gl']).toBe('6.4.1')
  expect(pdfPackage.dependencies['maplibre-gl']).toBeUndefined()
  expect(map.files.has('src/__openpencil_map.vue')).toBe(true)
  expect(map.files.has('src/__openpencil_pdf_viewer.vue')).toBe(false)
  expect(pdf.files.has('src/__openpencil_pdf_viewer.vue')).toBe(true)
  const graph = makeSceneGraph(),
    pageId = firstPageId(graph)
  const empty = compile({ graph, pageIds: [pageId], options: withDefaults({ target: 'vue' }) })
  expect(empty.files.has('src/__openpencil_map.vue')).toBe(false)
  expect(empty.files.has('src/__openpencil_pdf_viewer.vue')).toBe(false)
})
