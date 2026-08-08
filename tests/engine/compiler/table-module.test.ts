import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const TABLE_CONFIG = {
  table: {
    columns: ['Product', 'Status', 'Owner'],
    rows: [
      ['Compiler', 'Ready', 'Lin'],
      ['HTML <script>alert(1)</script>', 'Review', 'Mina']
    ]
  },
  showHeader: true,
  striped: true,
  borderColor: '#CBD5E1',
  headerBackground: '#E2E8F0',
  textColor: '#0F172A',
  fontSize: 15
}

function tableFrameOverrides(config: Record<string, unknown>) {
  return {
    width: 640,
    height: 320,
    interactiveProps: {
      module: {
        version: 1 as const,
        pluginId: 'open-pencil.table',
        moduleType: 'table',
        configVersion: 1,
        config
      }
    }
  }
}

describe('compiler trusted table module adapter', () => {
  test('deep-clones bounded text data and emits semantic React table markup', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, tableFrameOverrides(TABLE_CONFIG))
    graph.createNode('TEXT', frame.id, { text: 'Table overlay' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.table',
      moduleType: 'table',
      configVersion: 1,
      payload: TABLE_CONFIG
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'table-module-demo' })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_table.tsx') as string

    expect(app).toContain("import OpenPencilTable from './__openpencil_table'")
    expect(app).toContain('<OpenPencilTable config={{')
    expect(app).toContain('Table overlay')
    expect(app).toContain('</OpenPencilTable>')
    expect(runtime).toContain('<table')
    expect(runtime).toContain('<thead')
    expect(runtime).toContain('<th key={columnIndex} scope="col"')
    expect(runtime).toContain('<tbody>')
    expect(runtime).toContain('<td key={columnIndex}')
    expect(runtime).toContain("overflow: 'auto'")
    expect(runtime).toContain("position: 'sticky'")
    expect(runtime).toContain("height: 'max(22px, 1.4em)'")
    expect(runtime).toContain('lineHeight: 1.4')
    expect(runtime).toContain("padding: '0 0.7em'")
    expect(runtime).toContain('config.striped && rowIndex % 2 === 1')
    expect(runtime).toContain("? '#F9FAFB'")
    expect(runtime).not.toContain('color-mix')
    expect(runtime).toContain("{row[columnIndex] ?? ''}")
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toContain('<iframe')
    expect(out.warnings).toEqual([])
  })

  test('keeps authored fallback content when a cell is not text', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode(
      'FRAME',
      pageId,
      tableFrameOverrides({
        ...TABLE_CONFIG,
        table: { columns: ['Name'], rows: [[{ unsafe: true }]] }
      })
    )
    graph.createNode('TEXT', frame.id, { text: 'Table unavailable' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('Table unavailable')
    expect(ir.warnings.map((warning) => warning.code)).toContain('table-module-invalid')
  })

  test('bundles the dependency-free table runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, tableFrameOverrides(TABLE_CONFIG))
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'table-module-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-table-module-build-'))

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
