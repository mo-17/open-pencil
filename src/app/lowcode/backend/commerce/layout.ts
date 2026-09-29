import type {
  ActionDef,
  BackendResourceDataSource,
  SceneNode,
  StateDef
} from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'
import { backendTemplateListProps } from '../notes-template-style'
import type { commerceCopy } from './copy'
import {
  COMMERCE_PALETTE,
  commerceSecondaryButton,
  commerceSurface,
  createCommercePresentation
} from './presentation'

export function createCommerceLayout(
  editor: NotesTemplateEditor,
  copy: ReturnType<typeof commerceCopy>,
  errorTarget: string
) {
  const createShape = createCommercePresentation(editor)
  const pagePaths = new Map<string, string>()
  const shape: typeof createShape = (type, name, parent, x, y, width, height, props) => {
    if (type === 'FORM' && pagePaths.has(parent) && width >= 800 && height >= 130)
      createShape('FRAME', name + ' surface', parent, x - 20, y - 8, width + 40, height + 16, {
        ...commerceSurface(COMMERCE_PALETTE.surface, true),
        ...(props?.renderCondition ? { renderCondition: props.renderCondition } : {})
      })
    return createShape(type, name, parent, x, y, width, height, props)
  }
  const pageIds: string[] = []
  const text = (
    parent: string,
    value: string,
    x: number,
    y: number,
    width = 850,
    props: Partial<SceneNode> = {}
  ) =>
    shape('TEXT', value, parent, x, y, width, 32, {
      text: value,
      fontSize: 16,
      ...((props.fontSize ?? 16) >= 20 ? { fontWeight: 600 } : {}),
      ...(props.bindings?.text
        ? {
            interactiveProps: {
              layout: { overflowY: 'auto' as const, whiteSpace: 'pre-wrap' as const }
            }
          }
        : {}),
      ...props
    })
  const button = (
    parent: string,
    label: string,
    x: number,
    y: number,
    actions: ActionDef[],
    props: Partial<SceneNode> = {}
  ) => {
    const navigation = actions.find((action) => action.kind === 'navigate')
    const secondary =
      navigation ||
      actions.some(
        (action) =>
          action.kind === 'setState' ||
          action.kind === 'setVariable' ||
          (action.kind === 'backendAuth' && action.operation === 'signOut')
      )
    const style = secondary
      ? commerceSecondaryButton(Boolean(navigation && navigation.to === pagePaths.get(parent)))
      : {}
    return shape('BUTTON', label, parent, x, y, 190, 44, {
      ...style,
      events: { onClick: actions },
      ...props,
      interactiveProps: { ...style.interactiveProps, ...props.interactiveProps, text: label }
    })
  }
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
    const frame = shape('FRAME', name, id, 0, 0, 1000, height, {
      ...commerceSurface(COMMERCE_PALETTE.background),
      cornerRadius: 0
    })
    pagePaths.set(frame, path)
    shape('RECTANGLE', 'Page accent', frame, 24, 28, 4, 38, {
      ...commerceSurface(COMMERCE_PALETTE.primary),
      cornerRadius: 2
    })
    return frame
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
      fills: [],
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
  const section = (parent: string, name: string, y: number, height: number, condition?: string) =>
    shape('FRAME', name, parent, 28, y, 940, height, {
      ...commerceSurface(COMMERCE_PALETTE.surface, true),
      ...(condition ? { renderCondition: condition } : {})
    })
  return { shape, text, button, navigate, page, error, listing, pagination, pageIds, section }
}

export type CommerceLayout = ReturnType<typeof createCommerceLayout>
