import {
  captureFlutterPreviewSnapshot,
  type FlutterPreviewSnapshot
} from '@open-pencil/compiler/flutter-preview'
import { SceneGraph } from '@open-pencil/scene-graph'

export function previewFixture() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    name: 'Preview screen',
    width: 240,
    height: 320,
    fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, opacity: 1, visible: true }]
  })
  const text = graph.createNode('TEXT', frame.id, {
    name: 'Title',
    text: 'Native preview 中文',
    width: 180,
    height: 32,
    x: 12,
    y: 16
  })
  return { graph, page, frame, text }
}

export function snapshotFixture(): FlutterPreviewSnapshot {
  const { graph, page } = previewFixture()
  return captureFlutterPreviewSnapshot(graph, [page.id])
}

export function editSnapshotNode(snapshot: FlutterPreviewSnapshot, id: string) {
  const node = snapshot.graph.nodes.find(([key]) => key === id)?.[1]
  if (!node) throw new Error('Fixture node is missing')
  return node
}
