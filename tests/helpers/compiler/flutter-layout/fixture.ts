import { viewportFixture } from '#tests/helpers/compiler/flutter-viewport'

/** Real scene nodes shared by compiler contracts and generated Flutter acceptance. */
export function flutterLayoutFixture() {
  const fixture = viewportFixture('responsive')
  const { graph, frame } = fixture
  graph.updateNode(fixture.title.id, { text: 'Flutter layout preview' })
  graph.updateNode(fixture.detail.id, {
    text: 'Wrapping honors the authored main and cross axis alignment. Resize the page and the counter stays live.'
  })
  graph.deleteNode(fixture.row.id)
  const wrapCases = []
  for (const direction of ['HORIZONTAL', 'VERTICAL'] as const) {
    for (const main of ['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN'] as const) {
      for (const cross of ['MIN', 'MAX', 'CENTER'] as const) {
        const horizontal = direction === 'HORIZONTAL'
        graph.createNode('TEXT', frame.id, {
          name: 'Wrap case label',
          text: `${horizontal ? 'Row' : 'Column'} · ${main} / ${cross}`,
          width: 312,
          height: 24,
          fontSize: 14,
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'FILL'
        })
        const container = graph.createNode('FRAME', frame.id, {
          name: `Wrap ${direction} ${main} ${cross}`,
          width: 312,
          height: horizontal ? 100 : 120,
          layoutMode: direction,
          layoutWrap: 'WRAP',
          primaryAxisSizing: horizontal ? 'FILL' : 'FIXED',
          counterAxisSizing: horizontal ? 'FIXED' : 'FILL',
          itemSpacing: 12,
          counterAxisSpacing: 16,
          primaryAxisAlign: main,
          counterAxisAlign: cross
        })
        const children = [24, 40, 32].map((size, index) =>
          graph.createNode('RECTANGLE', container.id, {
            name: `Wrap item ${index + 1}`,
            width: horizontal ? 140 : size,
            height: horizontal ? size : 48,
            primaryAxisSizing: 'FIXED',
            counterAxisSizing: 'FIXED',
            cornerRadius: 6,
            fills: [
              {
                type: 'SOLID',
                color: {
                  r: 0.1 + index * 0.12,
                  g: 0.35 + index * 0.12,
                  b: 0.9,
                  a: 1
                },
                opacity: 1,
                visible: true
              }
            ]
          })
        )
        wrapCases.push({
          direction,
          main,
          cross,
          containerId: container.id,
          childIds: children.map((child) => child.id)
        })
      }
    }
  }
  const constraints = graph.createNode('TEXT', frame.id, {
    name: 'Conflicting limits',
    text: 'Normalized limits',
    width: 150,
    height: 48,
    fontSize: 16,
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    minWidth: 160,
    maxWidth: 80,
    minHeight: 40,
    maxHeight: 20
  })
  const cleared = graph.createNode('TEXT', frame.id, {
    name: 'Cleared limits',
    text: 'Compact clears inherited limits',
    width: 150,
    height: 48,
    fontSize: 16,
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    minWidth: 160,
    maxWidth: 160,
    minHeight: 48,
    maxHeight: 48,
    responsiveOverrides: {
      compact: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
    }
  })
  graph.reorderChild(fixture.detail.id, frame.id, frame.childIds.length - 1)
  graph.reorderChild(fixture.footer.id, frame.id, frame.childIds.length - 1)
  return { ...fixture, constraints, cleared, wrapCases }
}
