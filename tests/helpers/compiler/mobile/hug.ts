import { readFile } from 'node:fs/promises'

import { compile } from 'tailwindcss'

import { collectResponsiveTailwindClasses, collectTailwindClasses } from '@open-pencil/core/io'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

/** Desktop grid/flex lists become a bounded vertical flow on compact screens. */
export async function compactHugHTML(mode: 'GRID' | 'VERTICAL'): Promise<string> {
  const graph = new SceneGraph()
  const container = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 900,
    height: 520,
    layoutMode: mode,
    gridTemplateColumns: [
      { sizing: 'FR', value: 1 },
      { sizing: 'FR', value: 1 }
    ],
    gridRowGap: 16,
    itemSpacing: 16,
    responsiveOverrides: {
      compact: {
        layoutMode: 'VERTICAL',
        itemSpacing: 16,
        layoutPositioning: 'AUTO',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FILL',
        primaryAxisAlign: 'MIN',
        gridTemplateColumns: [{ sizing: 'FR', value: 1 }]
      }
    }
  })
  const classes = new Set<string>()
  const className = (node: SceneNode) => {
    const values = [
      ...collectTailwindClasses(node, graph),
      ...collectResponsiveTailwindClasses(node, graph)
    ]
    for (const value of values) classes.add(value)
    return values.join(' ')
  }
  const cards: string[] = []
  for (let index = 0; index < 2; index++) {
    const card = graph.createNode('FRAME', container.id, {
      width: 358,
      height: 220,
      layoutMode: 'FREE',
      clipsContent: true,
      responsiveOverrides: {
        compact: {
          layoutMode: 'VERTICAL',
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'FILL',
          itemSpacing: 12,
          paddingTop: 16,
          paddingBottom: 16,
          paddingLeft: 16,
          paddingRight: 16
        }
      }
    })
    const image = graph.createNode('FRAME', card.id, {
      width: 160,
      height: 128,
      responsiveOverrides: {
        compact: { primaryAxisSizing: 'FIXED', counterAxisSizing: 'FILL', minHeight: 128 }
      }
    })
    const plate = graph.createNode('RECTANGLE', image.id, { width: 160, height: 128 })
    const body = graph.createNode('TEXT', card.id, {
      width: 160,
      height: 160,
      text: 'Description and price',
      responsiveOverrides: {
        compact: { primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', minHeight: 160 }
      }
    })
    const action = graph.createNode('BUTTON', card.id, {
      width: 160,
      height: 44,
      responsiveOverrides: {
        compact: { primaryAxisSizing: 'FIXED', counterAxisSizing: 'FILL', minHeight: 44 }
      }
    })
    cards.push(`<article class="${className(card)}" data-card>
      <div class="${className(image)}" data-image><div class="${className(plate)}" data-plate>Image</div></div>
      <p class="${className(body)}">Description and price</p>
      <button class="${className(action)}">Select ${index + 1}</button>
    </article>`)
  }
  const rootClass = className(container)
  const theme = await readFile(new URL(import.meta.resolve('tailwindcss/theme.css')), 'utf8')
  const css = (await compile(`${theme}\n@tailwind utilities;`)).build([...classes])
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${css}
      * { box-sizing: border-box; } body,p { margin: 0; }
      [data-list] { overflow: auto; } [data-image] { background: #e2e8f0; }
    </style></head><body><main class="${rootClass}" data-list>${cards.join('')}</main></body></html>`
}
