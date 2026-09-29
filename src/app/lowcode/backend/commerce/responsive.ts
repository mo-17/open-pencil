import type { SceneNode } from '@open-pencil/scene-graph'

import type { NotesTemplateEditor } from '../notes-template'
import { groupTemplateFormFields, groupTemplateSurfaces } from '../responsive/content'
import { applyTemplateMobileLayout } from '../responsive/layout'
import { createTemplateMobileNavigation } from '../responsive/navigation'

function navigationEntry(node: SceneNode) {
  const actions = node.events?.onClick ?? []
  const route = actions.find((action) => action.kind === 'navigate')
  if (node.type !== 'BUTTON' || !route?.to || node.y > 210) return undefined
  // Account visibility and selection-specific actions keep their authored controls.
  if (node.renderCondition) return undefined
  const label = node.interactiveProps?.text
  return { label: typeof label === 'string' ? label : node.name, path: route.to, actions }
}

/** Fresh templates retain their authored desktop canvas and add a semantic compact flow. */
export function adaptCommercePagesToMobile(
  editor: NotesTemplateEditor,
  pageIds: readonly string[],
  locale: string
): void {
  for (const pageId of pageIds) {
    const page = editor.graph.getNode(pageId)
    const frame = editor.graph.getChildren(pageId).find((node) => node.type === 'FRAME')
    if (!page || !frame) continue
    const children = editor.graph.getChildren(frame.id)
    const hidden = new Set<string>()
    const navigation = children.flatMap((node) => {
      const entry = navigationEntry(node)
      if (!entry) return []
      hidden.add(node.id)
      return [entry]
    })
    if (navigation.length) {
      const { nodeId, state } = createTemplateMobileNavigation(
        editor,
        frame.id,
        pageId,
        navigation,
        page.lowcodeRoutePattern ?? '',
        locale.toLowerCase().startsWith('zh') ? '页面导航' : 'Page navigation'
      )
      editor.updateNodeWithUndo(nodeId, { x: 48, y: 148 }, 'Position compact page navigation')
      editor.updateNodeWithUndo(
        pageId,
        { state: [...(page.state ?? []), state] },
        'Configure compact page navigation'
      )
    }
    const surfaces = children.filter(
      (node) => node.type === 'FRAME' && !node.childIds.length && node.width >= 300
    )
    const groups = groupTemplateSurfaces(
      editor,
      frame.id,
      surfaces.map((node) => node.id)
    )
    for (const surface of surfaces)
      if (surface.name === 'Shopping illustration') hidden.add(groups.get(surface.id) ?? surface.id)
    groupTemplateFormFields(editor, frame.id)
    applyTemplateMobileLayout(editor, frame.id, { hidden })
  }
}
