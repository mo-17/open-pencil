import { describe, expect, test } from 'bun:test'

import {
  captureFlutterPreviewSnapshot,
  compileFlutterPreviewSnapshot,
  validateFlutterPreviewSnapshot
} from '@open-pencil/compiler/flutter-preview'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { editSnapshotNode } from './helpers'

function nodeNamed(graph: SceneGraph, name: string) {
  const node = [...graph.getAllNodes()].find((entry) => entry.name === name)
  if (!node) throw new Error(`Missing saved FIG node: ${name}`)
  return node
}

async function importedPreview() {
  const graph = await parseFigFile(
    await Bun.file(new URL('./fixtures/flutter-sync-acceptance.fig', import.meta.url)).arrayBuffer()
  )
  return {
    graph,
    page: nodeNamed(graph, 'Flutter Preview'),
    title: nodeNamed(graph, 'Page title'),
    button: nodeNamed(graph, 'Increment count')
  }
}

function dartSources(files: ReturnType<typeof compileFlutterPreviewSnapshot>['files']): string {
  return [...files]
    .filter(([path]) => path.endsWith('.dart'))
    .map(([, source]) => source)
    .join('\n')
}

describe('Flutter preview snapshot from saved FIG data', () => {
  test('captures and compiles the actual native acceptance FIG through public IO', async () => {
    const { graph, page, title, button } = await importedPreview()
    const emptyReferences = [...graph.nodes.values()].filter((node) => node.componentId === '')
    expect(emptyReferences).toHaveLength(9)
    expect(page.type).toBe('CANVAS')
    expect(page.state?.some((entry) => entry.name === 'count')).toBe(true)
    expect(button.interactiveProps?.ariaLabel).toBe('Increment count')

    const snapshot = captureFlutterPreviewSnapshot(graph, [page.id])
    const wireJSON = JSON.stringify(snapshot)
    const wire = validateFlutterPreviewSnapshot(JSON.parse(wireJSON))
    for (const node of emptyReferences) {
      expect(editSnapshotNode(wire, node.id).componentId).toBeNull()
      expect(node.componentId).toBe('')
    }
    const compiled = compileFlutterPreviewSnapshot(wire)
    expect(compiled.files.get('pubspec.yaml')).toContain('name: openpencil_flutter_preview')
    expect(dartSources(compiled.files)).toContain('Increment count')
    expect(dartSources(compiled.files)).toContain(`ValueKey("openpencil-node-${button.id}")`)

    graph.updateNode(title.id, { text: 'Saved FIG latest title' })
    const savedFig = await exportFigFile(graph)
    const reopened = await parseFigFile(Uint8Array.from(savedFig).buffer)
    const reopenedPage = nodeNamed(reopened, 'Flutter Preview')
    const reopenedButton = nodeNamed(reopened, 'Increment count')
    const updated = compileFlutterPreviewSnapshot(
      captureFlutterPreviewSnapshot(reopened, [reopenedPage.id])
    )
    expect(dartSources(updated.files)).toContain('Saved FIG latest title')
    expect(dartSources(updated.files)).toContain(`ValueKey("openpencil-node-${reopenedButton.id}")`)
  })

  test('still rejects empty wire references and malformed nonempty FIG references', async () => {
    const { graph, page, title } = await importedPreview()
    const snapshot = captureFlutterPreviewSnapshot(graph, [page.id])
    editSnapshotNode(snapshot, title.id).componentId = ''
    expect(() => validateFlutterPreviewSnapshot(snapshot)).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    for (const componentId of ['missing-component', page.id, 'x'.repeat(257)]) {
      graph.updateNode(title.id, { componentId })
      expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
        'Invalid Flutter preview snapshot.'
      )
    }
    graph.updateNode(title.id, { componentId: '' })
    expect(() => captureFlutterPreviewSnapshot(graph, [title.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
    graph.updateNode(title.id, { type: 'INSTANCE', componentId: '' })
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot.'
    )
  })
})
