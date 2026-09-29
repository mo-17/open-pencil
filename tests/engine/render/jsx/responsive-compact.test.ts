import { describe, expect, test } from 'bun:test'

import {
  collectResponsiveTailwindClasses,
  collectTailwindClasses
} from '@open-pencil/core/io/formats/jsx'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('responsive desktop canvas to compact flow', () => {
  test('GRID to vertical flow retains row spacing instead of cancelling it with a gap reset', () => {
    const graph = new SceneGraph()
    const list = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'GRID',
      gridRowGap: 16,
      gridColumnGap: 16,
      responsiveOverrides: { compact: { layoutMode: 'VERTICAL', itemSpacing: 16 } }
    })
    const base = collectTailwindClasses(list, graph)
    const compact = collectResponsiveTailwindClasses(list, graph)
    expect(base).toContain('gap-4')
    expect(compact).toContain('max-xl:flex-col')
    expect(compact).not.toContain('max-xl:gap-0')
    expect(compact).not.toContain('max-xl:gap-x-0')
    expect(compact).not.toContain('max-xl:gap-y-0')
    graph.updateNode(list.id, {
      responsiveOverrides: {
        compact: { layoutMode: 'VERTICAL', itemSpacing: 24 }
      }
    })
    expect(collectResponsiveTailwindClasses(list, graph)).toContain('max-xl:gap-6')
  })

  test('responsive auto-layout HUG retains its content minimum and respects explicit size limits', () => {
    const graph = new SceneGraph()
    const card = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'FREE',
      height: 220,
      clipsContent: true,
      responsiveOverrides: { compact: { layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG' } }
    })
    expect(collectTailwindClasses(card, graph)).not.toContain('min-h-min')
    expect(collectResponsiveTailwindClasses(card, graph)).toEqual(
      expect.arrayContaining(['max-xl:h-auto', 'max-xl:min-h-min'])
    )
    for (const minimum of [null, 44]) {
      graph.updateNode(card.id, {
        responsiveOverrides: {
          compact: { layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', minHeight: minimum }
        }
      })
      const classes = collectResponsiveTailwindClasses(card, graph)
      expect(classes).not.toContain('max-xl:min-h-min')
      expect(classes).toContain(minimum === null ? 'max-xl:min-h-0' : 'max-xl:min-h-11')
    }
  })

  test.each([
    ['MIN', '[align-content:start]'],
    ['CENTER', 'content-center'],
    ['MAX', '[align-content:end]'],
    ['SPACE_BETWEEN', 'content-between']
  ] as const)(
    'GRID %s packs responsive rows without changing desktop alignment',
    (alignment, utility) => {
      const graph = new SceneGraph()
      const grid = graph.createNode('FRAME', graph.getPages()[0].id, {
        layoutMode: 'GRID',
        width: 900,
        height: 520,
        gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
        primaryAxisAlign: alignment,
        responsiveOverrides: { compact: { primaryAxisAlign: alignment } }
      })
      expect(
        collectTailwindClasses(grid, graph).some((value) => /content-|align-content/.test(value))
      ).toBe(false)
      expect(collectResponsiveTailwindClasses(grid, graph)).toContain(`max-xl:${utility}`)
    }
  )

  test('GRID alignment requires an explicit override and resets when a later breakpoint becomes flex', () => {
    const graph = new SceneGraph()
    const grid = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'GRID',
      primaryAxisAlign: 'MIN',
      height: 520,
      responsiveOverrides: {
        compact: { width: 300 },
        md: { primaryAxisAlign: 'MIN' },
        lg: { layoutMode: 'VERTICAL' }
      }
    })
    const classes = collectResponsiveTailwindClasses(grid, graph)
    expect(classes).toContain('md:[align-content:start]')
    expect(classes).toContain('lg:content-normal')
    expect(classes.some((value) => /^max-xl:.*(?:content-|align-content)/.test(value))).toBe(false)
  })

  test('root flow preserves base geometry and children follow the effective parent without own overrides', () => {
    const graph = new SceneGraph()
    const root = graph.createNode('FRAME', graph.getPages()[0].id, {
      width: 1200,
      height: 800,
      x: 32,
      y: 48,
      layoutMode: 'FREE',
      responsiveOverrides: {
        compact: {
          layoutMode: 'VERTICAL',
          layoutPositioning: 'AUTO',
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'FILL'
        }
      }
    })
    const child = graph.createNode('TEXT', root.id, {
      x: 64,
      y: 96,
      width: 240,
      height: 32,
      text: 'Flow child'
    })
    const snapshot = JSON.stringify([...graph.getAllNodes()])
    expect(collectTailwindClasses(root, graph)).toContain('absolute')
    expect(collectResponsiveTailwindClasses(root, graph)).toEqual(
      expect.arrayContaining([
        'max-xl:relative',
        'max-xl:left-[auto]',
        'max-xl:top-[auto]',
        'max-xl:flex',
        'max-xl:flex-col',
        'max-xl:w-full',
        'max-xl:h-auto'
      ])
    )
    expect(collectResponsiveTailwindClasses(child, graph)).toEqual(
      expect.arrayContaining(['max-xl:static', 'max-xl:left-[auto]', 'max-xl:top-[auto]'])
    )
    expect(JSON.stringify([...graph.getAllNodes()])).toBe(snapshot)
  })

  test('an explicit absolute child keeps its own compact offsets in a flowing parent', () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'FREE',
      responsiveOverrides: { compact: { layoutMode: 'VERTICAL' } }
    })
    const child = graph.createNode('RECTANGLE', parent.id, {
      layoutPositioning: 'ABSOLUTE',
      x: 40,
      y: 80,
      responsiveOverrides: { compact: { x: 12, y: 20 } }
    })
    const classes = collectResponsiveTailwindClasses(child, graph)
    expect(classes).toEqual(expect.arrayContaining(['max-xl:left-3', 'max-xl:top-5']))
    expect(classes).not.toContain('max-xl:static')
    expect(classes).not.toContain('max-xl:left-[auto]')
  })

  test('native sizing enables text wrapping and exact typography / clipping resets', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, {
      width: 640,
      height: 40,
      text: 'A heading that wraps on mobile',
      fontSize: 32,
      lineHeight: 40,
      clipsContent: true,
      responsiveOverrides: {
        compact: {
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'FILL',
          fontSize: 20,
          lineHeight: null,
          minWidth: 0,
          maxWidth: null,
          minHeight: 44,
          maxHeight: null,
          clipsContent: false
        }
      }
    })
    expect(collectResponsiveTailwindClasses(text, graph)).toEqual(
      expect.arrayContaining([
        'max-xl:w-full',
        'max-xl:h-auto',
        'max-xl:text-xl',
        'max-xl:leading-[normal]',
        'max-xl:min-w-0',
        'max-xl:max-w-none',
        'max-xl:min-h-11',
        'max-xl:max-h-none',
        'max-xl:overflow-visible'
      ])
    )
  })

  test('grid tracks and gaps are responsive CSS, including returning to ordinary flow', () => {
    const graph = new SceneGraph()
    const grid = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'GRID',
      width: 900,
      height: 400,
      gridTemplateColumns: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridTemplateRows: [{ sizing: 'FIXED', value: 200 }],
      gridColumnGap: 24,
      gridRowGap: 24,
      responsiveOverrides: {
        compact: {
          gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
          gridTemplateRows: [{ sizing: 'AUTO', value: 0 }],
          gridColumnGap: 0,
          gridRowGap: 12,
          primaryAxisSizing: 'HUG'
        },
        xl: { layoutMode: 'VERTICAL' }
      }
    })
    expect(collectResponsiveTailwindClasses(grid, graph)).toEqual(
      expect.arrayContaining([
        'max-xl:grid-cols-1',
        'max-xl:grid-rows-[auto]',
        'max-xl:gap-x-0',
        'max-xl:gap-y-3',
        'max-xl:h-auto',
        'xl:flex',
        'xl:grid-cols-none',
        'xl:grid-rows-none'
      ])
    )
  })

  test('min-width breakpoints cascade and can restore base values or re-show a node', () => {
    const graph = new SceneGraph()
    const root = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      responsiveOverrides: {
        sm: { layoutMode: 'HORIZONTAL' },
        md: { itemSpacing: 24 },
        lg: { visible: false },
        xl: { itemSpacing: 8, visible: true }
      }
    })
    const classes = collectResponsiveTailwindClasses(root, graph)
    expect(classes).toEqual(
      expect.arrayContaining(['sm:flex-row', 'md:gap-6', 'lg:hidden', 'xl:flex', 'xl:gap-2'])
    )
    expect(classes).not.toContain('md:flex-col')
    expect(classes).not.toContain('xl:flex-col')
  })
})
