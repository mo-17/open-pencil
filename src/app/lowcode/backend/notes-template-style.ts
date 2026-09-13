import { parseColor } from '@open-pencil/core/color'
import type { Editor } from '@open-pencil/core/editor'
import type { BackendResourceDataSource, SceneNode } from '@open-pencil/scene-graph'

/** Native scene properties keep the starter editable by the same design tools as other pages. */
export function notesTemplateStyle(
  type: SceneNode['type'],
  props: Partial<SceneNode>
): Partial<SceneNode> {
  let background = '#FFFFFF'
  if (type === 'TEXT') background = '#182339'
  if (type === 'BUTTON') background = '#3158C9'
  const styled = ['TEXT', 'BUTTON', 'INPUT', 'TEXTAREA', 'FRAME'].includes(type)
  return {
    ...(styled
      ? { fills: [{ type: 'SOLID', color: parseColor(background), opacity: 1, visible: true }] }
      : {}),
    ...(['BUTTON', 'INPUT', 'TEXTAREA', 'FRAME'].includes(type) ? { cornerRadius: 10 } : {}),
    ...(['INPUT', 'TEXTAREA'].includes(type)
      ? {
          strokes: [
            { color: parseColor('#CED6E3'), weight: 1, opacity: 1, visible: true, align: 'INSIDE' }
          ]
        }
      : {}),
    ...props,
    ...(['BUTTON', 'INPUT', 'TEXTAREA'].includes(type)
      ? {
          interactiveProps: {
            textColor: type === 'BUTTON' ? '#FFFFFF' : '#182339',
            ...props.interactiveProps
          }
        }
      : {})
  }
}

/** Shared node creation keeps exported starter forms editable with native editor controls. */
export function backendTemplateShape(editor: Pick<Editor, 'createShape'>) {
  return (
    type: SceneNode['type'],
    name: string,
    parent: string,
    x: number,
    y: number,
    width: number,
    height: number,
    props: Partial<SceneNode> = {}
  ) => editor.createShape(type, x, y, width, height, parent, name, notesTemplateStyle(type, props))
}

/** Fixed grid rows preserve authored card controls inside a scrollable resource list. */
export function backendTemplateListProps(
  source: BackendResourceDataSource,
  cardHeight: number
): Partial<SceneNode> {
  return {
    layoutMode: 'GRID',
    gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
    gridTemplateRows: [{ sizing: 'FIXED', value: cardHeight }],
    gridRowGap: 12,
    clipsContent: false,
    interactiveProps: {
      layout: { overflowX: 'hidden', overflowY: 'auto' },
      dataSourceRef: source,
      itemName: 'item',
      indexName: 'index'
    }
  }
}
