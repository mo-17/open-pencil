import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

export const SWITCH_VISUAL_CASES: Partial<SceneNode>[] = [
  { name: 'Default off', x: 24, y: 36, width: 44, height: 24 },
  { name: 'Resized on', x: 116, y: 26, width: 84, height: 44, interactiveProps: { checked: true } },
  {
    name: 'Disabled on',
    x: 256,
    y: 26,
    width: 84,
    height: 44,
    interactiveProps: { checked: true, disabled: true }
  },
  { name: 'Wide off', x: 24, y: 124, width: 320, height: 44 },
  {
    name: 'Padded on',
    x: 24,
    y: 222,
    width: 120,
    height: 44,
    paddingLeft: 12,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 2,
    interactiveProps: { checked: true }
  },
  { name: 'Narrow', x: 196, y: 222, width: 18, height: 40, interactiveProps: { checked: true } },
  {
    name: 'Bordered on',
    x: 256,
    y: 222,
    width: 84,
    height: 44,
    strokes: [
      {
        color: { r: 0.09, g: 0.17, b: 0.3, a: 1 },
        weight: 2,
        opacity: 1,
        visible: true,
        align: 'CENTER'
      }
    ],
    interactiveProps: { checked: true }
  }
]

export function switchAppearanceFixture(target: 'react' | 'vue' = 'react', kit = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const root = graph.createNode('FRAME', pageId, {
    name: 'Switch appearances',
    width: 380,
    height: 300,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }]
  })
  const nodes = SWITCH_VISUAL_CASES.map((item) => {
    const node = graph.createNode('SWITCH', root.id, {
      cornerRadius: 8,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }],
      ...item,
      interactiveProps: { checked: false, ...item.interactiveProps, ariaLabel: item.name }
    })
    graph.createNode('TEXT', root.id, {
      text: item.name,
      x: item.x,
      y: (item.y ?? 0) - 22,
      width: 114,
      height: 18,
      fontFamily: 'Inter',
      fontSize: 12,
      fills: [
        { type: 'SOLID', color: { r: 0.09, g: 0.17, b: 0.3, a: 1 }, visible: true, opacity: 1 }
      ]
    })
    return node
  })
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      ...(kit ? { uiKit: 'shadcn' as const } : {}),
      devMode: false,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
    })
  })
  return { files: [...output.files], warnings: output.warnings, root, nodes }
}
