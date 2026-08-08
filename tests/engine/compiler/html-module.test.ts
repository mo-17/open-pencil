import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { HTML_MODULE_SANDBOX_CSP } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const AUTHORED_HTML = `<style>
  body { margin: 0; color: #172554; font: 18px system-ui; }
  strong { color: #dc2626; }
</style>
<main><strong>Edited HTML</strong><p>Rendered in a sandbox.</p></main>`

function htmlFrameOverrides(html: string) {
  return {
    width: 480,
    height: 280,
    interactiveProps: {
      module: {
        version: 1 as const,
        pluginId: 'open-pencil.html',
        moduleType: 'html',
        configVersion: 1,
        config: { html }
      }
    }
  }
}

describe('compiler trusted HTML module adapter', () => {
  test('lowers only bounded HTML and emits a dependency-free sandbox runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, htmlFrameOverrides(AUTHORED_HTML))
    graph.createNode('TEXT', frame.id, { text: 'Authored overlay' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.html',
      moduleType: 'html',
      configVersion: 1,
      payload: { html: AUTHORED_HTML }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'html-module-demo' })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_html.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilHtml from './__openpencil_html'")
    expect(app).toContain('<OpenPencilHtml config={{')
    expect(app).toContain('Authored overlay')
    expect(app).toContain('</OpenPencilHtml>')
    expect(runtime).toContain(
      `OPENPENCIL_HTML_SANDBOX_CSP = ${JSON.stringify(HTML_MODULE_SANDBOX_CSP)}`
    )
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "style-src 'unsafe-inline'",
      'img-src data: blob:',
      'font-src data: blob:'
    ]) {
      expect(runtime).toContain(directive)
    }
    expect(runtime).toContain('http-equiv="Content-Security-Policy"')
    expect(runtime).toContain('sandbox=""')
    expect(runtime).toContain('referrerPolicy="no-referrer"')
    expect(runtime).toContain("pointerEvents: 'none'")
    expect(runtime).toContain('tabIndex={-1}')
    expect(runtime).not.toContain('allow-scripts')
    expect(runtime).not.toContain('allow-same-origin')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(pkg.dependencies['html-react-parser']).toBeUndefined()
    expect(pkg.dependencies['dompurify']).toBeUndefined()
    expect(out.warnings).toEqual([])
  })

  test('keeps the authored FRAME fallback when the HTML exceeds its bound', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, htmlFrameOverrides('x'.repeat(2_000_000)))
    graph.createNode('TEXT', frame.id, { text: 'HTML unavailable' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('HTML unavailable')
    expect(ir.warnings.map((warning) => warning.code)).toContain('html-module-invalid')
  })

  test('bundles the generated runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, htmlFrameOverrides(AUTHORED_HTML))
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'html-module-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-html-module-build-'))

    try {
      const built = await buildPreviewProject({ files: out.files, outDir: buildDirectory })
      expect(built.files).toContain('index.html')
      expect(built.files.some((path) => path.endsWith('.js'))).toBe(true)
      expect(out.warnings).toEqual([])
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 15_000)
})
