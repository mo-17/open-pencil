import type { Editor } from '@open-pencil/core/editor'
import { resolveTabsModule } from '@open-pencil/core/plugins'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export interface TabsContentItemState {
  mode: 'text' | 'mapped' | 'invalid'
  contentChildName?: string
  childId?: string
  canView: boolean
  canEdit: boolean
}

export type TabsContentStates = Partial<Record<string, TabsContentItemState>>

export interface TabsContentRequest {
  tabId: string
  contentChildName?: string
  owner: SceneNode | undefined
}

export interface TabsContentCanvas {
  owner?: SceneNode
  states: TabsContentStates
  hasPreview: boolean
  currentTabId?: string
}

/** Read the same unique direct-child mapping contract as Tabs rendering, without
 * replacing missing, ambiguous or shared mappings with their legacy text. */
export function inspectTabsContent(
  graph: SceneGraph,
  node: SceneNode,
  canEdit: (childId: string) => boolean
): TabsContentStates {
  const resolved = resolveTabsModule(node.interactiveProps?.module)
  if (node.type !== 'FRAME' || !resolved?.ok) return {}
  const children = graph.getChildren(node.id)
  return Object.fromEntries(
    resolved.config.tabs.map((tab) => {
      const name = tab.contentChildName
      if (!name) return [tab.id, { mode: 'text', canView: true, canEdit: false }]
      const matches = children.filter((child) => child.name === name)
      const reused =
        resolved.config.tabs.filter((item) => item.contentChildName === name).length !== 1
      if (reused || matches.length !== 1 || matches[0].internalOnly) {
        return [tab.id, { mode: 'invalid', contentChildName: name, canView: false, canEdit: false }]
      }
      const child = matches[0]
      return [
        tab.id,
        {
          mode: 'mapped',
          contentChildName: name,
          childId: child.id,
          canView: child.visible,
          canEdit: child.visible && canEdit(child.id)
        }
      ]
    })
  )
}

type TabsContentEditor = Pick<
  Editor,
  | 'graph'
  | 'state'
  | 'canEnterContentEdit'
  | 'previewTabsTab'
  | 'clearTabsTabPreview'
  | 'enterContentEdit'
>

export function createTabsContentActions(editor: TabsContentEditor) {
  function currentOwner(owner: SceneNode | undefined): owner is SceneNode {
    return (
      !!owner &&
      editor.graph.getNode(owner.id) === owner &&
      editor.state.selectedIds.size === 1 &&
      editor.state.selectedIds.has(owner.id)
    )
  }

  function currentState(request: TabsContentRequest): TabsContentItemState | undefined {
    const { owner, tabId, contentChildName } = request
    if (!currentOwner(owner)) return undefined
    const state = inspectTabsContent(editor.graph, owner, editor.canEnterContentEdit)[tabId]
    return state && (state.contentChildName ?? '') === (contentChildName ?? '') ? state : undefined
  }

  function viewTabContent(request: TabsContentRequest): boolean {
    const state = currentState(request)
    return Boolean(
      state?.canView && request.owner && editor.previewTabsTab(request.owner.id, request.tabId)
    )
  }

  function editTabContent(request: TabsContentRequest): boolean {
    const state = currentState(request)
    if (!state?.canEdit || !state.childId || !viewTabContent(request)) return false
    return editor.enterContentEdit(state.childId)
  }

  function resetTabsPreview(owner: SceneNode | undefined): void {
    if (currentOwner(owner)) editor.clearTabsTabPreview(owner.id)
  }

  return { viewTabContent, editTabContent, resetTabsPreview }
}
