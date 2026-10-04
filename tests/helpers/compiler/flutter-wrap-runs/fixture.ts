import { viewportFixture } from '#tests/helpers/compiler/flutter-viewport'

/** Authored scenes for real generated-widget run distribution acceptance. */
export function flutterWrapRunsFixture() {
  const fixture = viewportFixture('responsive')
  const { graph, frame } = fixture
  graph.updateNode(fixture.title.id, { text: 'Flutter run distribution' })
  graph.updateNode(fixture.detail.id, {
    text: 'Auto keeps the minimum row gap. Space between shares the available height between rows.'
  })
  graph.deleteNode(fixture.row.id)
  const runCases = []
  for (const direction of ['HORIZONTAL', 'VERTICAL'] as const) {
    const horizontal = direction === 'HORIZONTAL'
    const kinds = horizontal
      ? (['two', 'three', 'single', 'hug', 'overflow'] as const)
      : (['two', 'three', 'single'] as const)
    for (const kind of kinds) {
      for (const alignment of ['AUTO', 'SPACE_BETWEEN'] as const) {
        graph.createNode('TEXT', frame.id, {
          name: 'Run group label',
          text: `${horizontal ? 'Rows' : 'Columns'} · ${kind} · ${alignment}`,
          width: 312,
          height: 24,
          fontSize: 14,
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'FILL'
        })
        let height = horizontal ? 180 : 120
        if (kind === 'three') height = horizontal ? 220 : 72
        if (kind === 'single') height = horizontal ? 120 : 200
        if (kind === 'overflow') height = 40
        let itemWidth = 140
        if (kind === 'three') itemWidth = 220
        if (kind === 'single') itemWidth = 60
        const container = graph.createNode('FRAME', frame.id, {
          name: `Run distribution ${direction} ${kind} ${alignment}`,
          width: 312,
          height,
          layoutMode: direction,
          layoutWrap: 'WRAP',
          primaryAxisSizing: horizontal ? 'FILL' : 'FIXED',
          counterAxisSizing: horizontal ? (kind === 'hug' ? 'HUG' : 'FIXED') : 'FILL',
          itemSpacing: 12,
          counterAxisSpacing: 16,
          primaryAxisAlign: 'MIN',
          counterAxisAlign: 'MIN',
          counterAxisAlignContent: alignment,
          fills: [
            {
              type: 'SOLID',
              color: { r: 0.93, g: 0.95, b: 0.99, a: 1 },
              opacity: 1,
              visible: true
            }
          ]
        })
        const children = [24, 40, 32].map((size, index) =>
          graph.createNode('RECTANGLE', container.id, {
            name: `Run child ${index + 1}`,
            width: horizontal ? itemWidth : size,
            height: horizontal ? size : 48,
            primaryAxisSizing: 'FIXED',
            counterAxisSizing: 'FIXED',
            cornerRadius: 6,
            fills: [
              {
                type: 'SOLID',
                color: { r: 0.1 + index * 0.12, g: 0.35 + index * 0.12, b: 0.9, a: 1 },
                opacity: 1,
                visible: true
              }
            ]
          })
        )
        runCases.push({
          direction,
          alignment,
          kind,
          containerId: container.id,
          childIds: children.map((child) => child.id),
          mainSpacing: 12,
          runSpacing: 16
        })
      }
    }
  }
  graph.reorderChild(fixture.detail.id, frame.id, frame.childIds.length - 1)
  graph.reorderChild(fixture.footer.id, frame.id, frame.childIds.length - 1)
  return { ...fixture, runCases }
}
