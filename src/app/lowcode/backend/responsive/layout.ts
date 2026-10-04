import type { ResponsiveOverride, SceneNode } from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'
import { markNewMobileTemplateViewport } from './page-viewport'
import { orderTemplateChildren } from './structure'

interface TemplateMobileOptions {
  readonly hidden?: ReadonlySet<string>
  /** A preserved illustration remains one authored block, including its descendants. */
  readonly preserve?: ReadonlySet<string>
}

const CONTAINERS = new Set<SceneNode['type']>(['FRAME', 'GROUP', 'FORM'])
const CONTROLS = new Set<SceneNode['type']>([
  'INPUT',
  'SELECT',
  'BUTTON',
  'TEXTAREA',
  'DATEPICKER',
  'RADIO'
])

function mobileLayout(node: SceneNode, root: boolean): ResponsiveOverride {
  const fill: ResponsiveOverride = {
    layoutPositioning: 'AUTO',
    counterAxisSizing: 'FILL',
    minWidth: 0,
    layoutGrow: 0
  }
  if (node.type === 'LIST')
    return {
      ...fill,
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      primaryAxisAlign: 'MIN',
      height: 520,
      primaryAxisSizing: 'FIXED'
    }
  if (CONTROLS.has(node.type))
    return {
      ...fill,
      height: node.type === 'TEXTAREA' ? Math.max(120, node.height) : Math.max(44, node.height),
      minHeight: 44,
      fontSize: 16,
      primaryAxisSizing: node.type === 'BUTTON' ? 'HUG' : 'FIXED'
    }
  if (node.type === 'CHECKBOX' || node.type === 'SWITCH')
    return {
      ...fill,
      counterAxisSizing: 'FIXED',
      primaryAxisSizing: 'FIXED',
      width: 44,
      height: 44,
      minHeight: 44
    }
  if (node.type === 'TEXT')
    return {
      ...fill,
      primaryAxisSizing: 'HUG',
      minHeight: 22,
      fontSize: Math.min(28, Math.max(14, node.fontSize)),
      lineHeight: Math.min(38, Math.max(22, node.lineHeight ?? node.fontSize * 1.5))
    }
  if (node.interactiveProps?.image || node.interactiveProps?.module)
    return { ...fill, primaryAxisSizing: 'FIXED', height: Math.min(320, node.height) }
  if (CONTAINERS.has(node.type) && node.childIds.length) {
    const padding = root || (node.cornerRadius > 0 && node.fills.length > 0) ? 16 : 0
    return {
      ...fill,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      primaryAxisAlign: 'MIN',
      counterAxisAlign: 'STRETCH',
      layoutWrap: 'NO_WRAP',
      itemSpacing: root ? 16 : 12,
      paddingTop: padding,
      paddingRight: padding,
      paddingBottom: padding,
      paddingLeft: padding,
      clipsContent: false
    }
  }
  // Empty native shapes are presentation layers. Images and reviewed modules above stay visible.
  return { visible: false }
}

/** Author compact overrides once, while generating new templates; never rewrite an open document. */
export function applyTemplateMobileLayout(
  editor: NotesTemplateEditor,
  rootId: string,
  options: TemplateMobileOptions = {}
): void {
  markNewMobileTemplateViewport(editor, rootId)
  const visit = (id: string) => {
    const node = editor.graph.getNode(id)
    if (!node || options.preserve?.has(id)) return
    const compact = options.hidden?.has(id) ? { visible: false } : mobileLayout(node, id === rootId)
    editor.updateNodeWithUndo(
      id,
      {
        responsiveOverrides: {
          ...node.responsiveOverrides,
          compact: { ...compact, ...node.responsiveOverrides?.compact }
        }
      },
      'Adapt template to compact screens'
    )
    if (compact.visible === false) return
    const children = editor.graph.getChildren(id)
    const listItem = node.parentId && editor.graph.getNode(node.parentId)?.type === 'LIST'
    // Desktop coordinates retain their geometry. Flow follows the authored reading order,
    // including late-created navigation and conditional controls occupying the same position.
    if (node.type !== 'LIST')
      orderTemplateChildren(
        editor,
        id,
        [...children]
          .sort((left, right) => {
            if (listItem && (left.type === 'BUTTON') !== (right.type === 'BUTTON'))
              return left.type === 'BUTTON' ? 1 : -1
            return left.y - right.y || left.x - right.x
          })
          .map((child) => child.id)
      )
    for (const child of children) visit(child.id)
  }
  visit(rootId)
}
