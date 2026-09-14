import type {
  ActionDef,
  BackendResourceDataSource,
  SceneNode,
  StateDef
} from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'
import { backendTemplateListProps, backendTemplateShape } from '../notes-template-style'
import type { commerceCopy } from './copy'

export function createCommerceLayout(
  editor: NotesTemplateEditor,
  copy: ReturnType<typeof commerceCopy>,
  errorTarget: string
) {
  const shape = backendTemplateShape(editor)
  const pageIds: string[] = []
  const text = (
    parent: string,
    value: string,
    x: number,
    y: number,
    width = 850,
    props: Partial<SceneNode> = {}
  ) => shape('TEXT', value, parent, x, y, width, 32, { text: value, fontSize: 16, ...props })
  const button = (
    parent: string,
    label: string,
    x: number,
    y: number,
    actions: ActionDef[],
    props: Partial<SceneNode> = {}
  ) =>
    shape('BUTTON', label, parent, x, y, 190, 42, {
      interactiveProps: { text: label },
      events: { onClick: actions },
      ...props
    })
  const navigate = (to: string): ActionDef => ({ id: crypto.randomUUID(), kind: 'navigate', to })
  const page = (
    name: string,
    path: string,
    states: StateDef[],
    requiresAuth = false,
    height = 1100
  ) => {
    const id = shape('CANVAS', name, editor.graph.rootId, 0, 0, 1000, height, {
      lowcodeRoutePattern: path,
      lowcodeRequiresAuth: requiresAuth,
      state: states
    })
    pageIds.push(id)
    return shape('FRAME', name, id, 0, 0, 1000, height)
  }
  const error = (parent: string, y: number) =>
    text(parent, '', 48, y, 890, {
      bindings: { text: { kind: 'docState', docStateName: errorTarget } },
      height: 48
    })
  const listing = (
    parent: string,
    name: string,
    y: number,
    source: BackendResourceDataSource,
    cardHeight = 180,
    props: Partial<SceneNode> = {}
  ) => {
    const list = shape('LIST', name, parent, 48, y, 900, 290, {
      ...backendTemplateListProps(source, cardHeight),
      ...props
    })
    return shape('FRAME', name + ' card', list, 0, 0, 870, cardHeight)
  }
  const pagination = (
    parent: string,
    after: StateDef,
    cursor: string,
    y: number,
    condition?: string
  ) => {
    const set = (valueExpr: string): ActionDef => ({
      id: crypto.randomUUID(),
      kind: 'setState',
      targetStateId: after.id,
      valueExpr
    })
    button(parent, copy.first, 48, y, [set('""')], condition ? { renderCondition: condition } : {})
    button(parent, copy.next, 252, y, [set(cursor)], {
      renderCondition: `${condition ? '(' + condition + ') && ' : ''}${cursor} !== ""`
    })
  }
  return { shape, text, button, navigate, page, error, listing, pagination, pageIds }
}

export type CommerceLayout = ReturnType<typeof createCommerceLayout>
