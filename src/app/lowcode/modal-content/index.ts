import { parseColor } from '@open-pencil/core/color'
import type { Editor } from '@open-pencil/core/editor'
import {
  createModalModuleInstance,
  resolveModalModule,
  createPopoverModuleInstance,
  resolvePopoverModule,
  POPOVER_PLUGIN_ID
} from '@open-pencil/core/plugins'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

type ContentEditor = Pick<
  Editor,
  'graph' | 'state' | 'createShape' | 'updateNodeWithUndo' | 'runLayoutForNode' | 'undo'
>

/** Editing content never grants access to locked or library/instance-owned subtrees. */
export function canEditModalContent(graph: SceneGraph, node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (
      !current.visible ||
      current.locked ||
      current.internalOnly ||
      current.type === 'INSTANCE' ||
      current.type === 'COMPONENT' ||
      current.type === 'COMPONENT_SET'
    )
      return false
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return true
}

export function modalContentChild(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  const resolved =
    resolveModalModule(node.interactiveProps?.module) ??
    resolvePopoverModule(node.interactiveProps?.module)
  if (!resolved?.ok || !resolved.config.contentChildName) return undefined
  const children = graph
    .getChildren(node.id)
    .filter((child) => child.name === resolved.config.contentChildName)
  const child = children.length === 1 ? children[0] : undefined
  return child?.visible && canEditModalContent(graph, child) ? child : undefined
}

/** Create an ordinary editable frame and bind it in the same undo transaction. */
export function createModalContent(
  editor: ContentEditor,
  nodeId: string,
  baseName: string
): string | null {
  const node = editor.graph.getNode(nodeId)
  if (
    node?.type !== 'FRAME' ||
    editor.state.selectedIds.size !== 1 ||
    !editor.state.selectedIds.has(nodeId) ||
    !canEditModalContent(editor.graph, node)
  )
    return null
  let page: SceneNode | undefined = node
  while (page && page.type !== 'CANVAS')
    page = page.parentId ? editor.graph.getNode(page.parentId) : undefined
  if (page?.id !== editor.state.currentPageId) return null
  const resolved =
    resolveModalModule(node.interactiveProps?.module) ??
    resolvePopoverModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const names = new Set(editor.graph.getChildren(node.id).map((child) => child.name))
  const base = baseName.trim().slice(0, 100) || 'Dialog content'
  let name = base
  for (let suffix = 2; names.has(name); suffix++) name = `${base} ${suffix}`
  const isPopover = resolved.instance.pluginId === POPOVER_PLUGIN_ID
  const createInstance = isPopover ? createPopoverModuleInstance : createModalModuleInstance
  const module = createInstance({ ...resolved.config, contentChildName: name })
  const width = isPopover
    ? Math.max(96, resolved.config.panelWidth - 32)
    : Math.max(232, resolved.config.panelWidth - 48)
  let childId = ''
  editor.undo.runBatch('Create dialog content', () => {
    childId = editor.createShape('FRAME', 0, 0, width, 240, node.id, name, {
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      itemSpacing: 16,
      paddingTop: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      paddingRight: 16,
      fills: [
        {
          type: 'SOLID',
          color: parseColor(resolved.config.panelBackground),
          opacity: 1,
          visible: true
        }
      ]
    })
    if (resolved.config.content)
      editor.createShape('TEXT', 16, 16, width - 32, 48, childId, name, {
        text: resolved.config.content,
        fontSize: 14,
        lineHeight: 21,
        textAutoResize: 'HEIGHT',
        counterAxisSizing: 'FILL',
        primaryAxisSizing: 'HUG',
        fills: [
          { type: 'SOLID', color: parseColor(resolved.config.textColor), opacity: 1, visible: true }
        ]
      })
    editor.updateNodeWithUndo(
      node.id,
      { interactiveProps: { ...node.interactiveProps, module } },
      'Use dialog content'
    )
    editor.undo.apply({
      label: 'Lay out dialog content',
      forward: () => editor.runLayoutForNode(childId),
      inverse: () => undefined
    })
  })
  return childId
}
