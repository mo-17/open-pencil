import {
  applyRenderPlacement,
  renderPlacementSiblings,
  renderTreeNode,
  resolveRenderPlacement,
  type AppliedRenderPlacement
} from '@open-pencil/core/design-jsx'
import type { Editor } from '@open-pencil/core/editor'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { computeAllLayoutsAsync } from '@open-pencil/core/layout'
import { ALL_TOOLS, registerComponentCatalog, serializeToolMutation } from '@open-pencil/core/tools'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { AutomationRequestContext } from '@/app/automation/bridge/request-context'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { pageIdForNode, resolveEditorMutationScope } from '@/app/editor/mutation-scope'
import { useLibraryService } from '@/app/libraries'
import { canCreatePluginModule } from '@/app/plugins'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

/** Phase 3 §3.v2: tools that opt into editor-backed undo (push UndoEntry +
 *  participate in `runBatch`). All tools receive request cancellation /
 *  progress context, while only this allowlist receives the editor context. */
const EDITOR_UNDO_TOOLS = new Set<string>([
  'create_module',
  'update_module',
  'update_lowcode_node',
  'update_lowcode_nodes',
  'ensure_form_value_bindings',
  'update_page_route',
  'reparent_nodes',
  'set_doc_states',
  'set_supabase_config',
  'apply_motion_preset',
  'apply_motion_spec',
  'update_motion',
  'clear_motion'
])
const DOCUMENT_SCOPE_TOOLS = new Set([
  'eval',
  'create_page',
  'create_variable',
  'set_variable',
  'delete_variable',
  'bind_variable',
  'unbind_variable',
  'create_collection',
  'delete_collection'
])
const NON_GRAPH_MUTATION_TOOLS = new Set([
  'viewport_zoom_to_fit',
  'viewport_set',
  'select_nodes',
  'switch_page'
])
const MODULE_CREATION_POLICY_TOOLS = new Set(['list_modules', 'create_module'])
const COMPONENT_CATALOG_TOOLS = new Set([
  'get_components',
  'list_libraries',
  'insert_library_component'
])
type AutomationMutationSnapshot =
  | { scope: 'document'; snapshot: ReturnType<Editor['snapshotDocument']> }
  | { scope: 'page'; snapshot: ReturnType<Editor['snapshotPage']> }
type AutomationRenderTree = Parameters<typeof renderTreeNode>[1]
type AutomationRenderResult = Awaited<ReturnType<typeof renderTreeNode>>
type AutomationRenderResults = [AutomationRenderResult, ...AutomationRenderResult[]]

function automationRenderRoots(tree: AutomationRenderTree): AutomationRenderTree[] {
  if (tree.type !== '' && tree.type !== 'fragment') return [tree]
  return tree.children.filter((child): child is AutomationRenderTree => typeof child !== 'string')
}

async function renderAutomationRoots(
  target: AutomationTarget,
  tree: AutomationRenderTree,
  parentId: string,
  toolArgs: Record<string, unknown>,
  context?: AutomationRequestContext
): Promise<AutomationRenderResults> {
  const roots = automationRenderRoots(tree)
  if (roots.length === 0) throw new Error('Render tree must contain at least one root node')
  const results: AutomationRenderResult[] = []
  for (const root of roots) {
    results.push(
      await renderTreeNode(target.store.graph, root, {
        parentId,
        x: toolArgs.x as number | undefined,
        y: toolArgs.y as number | undefined,
        signal: context?.signal,
        layout: false
      })
    )
  }
  return results as AutomationRenderResults
}

function automationRenderResult(
  results: AutomationRenderResults,
  placement: AppliedRenderPlacement
): Record<string, unknown> {
  const result = results[0]
  const siblings = renderPlacementSiblings(results, placement)
  return {
    id: result.id,
    name: result.name,
    type: result.type,
    children: result.childIds,
    parent_id: placement.parentId,
    index: placement.index,
    ...(placement.replacedId ? { replaced_id: placement.replacedId } : {}),
    ...(siblings.length > 0 ? { siblings } : {})
  }
}

export function createAutomationToolHandler(
  makeFigma: FigmaFactory,
  canCreateModule: (pluginId: string, moduleType: string) => boolean = canCreatePluginModule
) {
  async function handleToolRender(
    target: AutomationTarget,
    toolArgs: Record<string, unknown>,
    context?: AutomationRequestContext
  ): Promise<unknown> {
    throwIfAborted(context?.signal)
    const store = target.store
    const targetPage = store.graph.getNode(target.pageId)
    if (targetPage?.type !== 'CANVAS') throw new Error('Automation target page is no longer open')
    const sceneVersionBefore = store.state.sceneVersion
    const tree = toolArgs.tree as Parameters<typeof renderTreeNode>[1]
    const placement = resolveRenderPlacement(store.graph, {
      defaultParentId: target.pageId,
      parentId: toolArgs.parent_id as string | undefined,
      replaceId: toolArgs.replace_id as string | undefined,
      insertIndex: toolArgs.insert_index as number | undefined
    })
    const parentId = placement.parentId
    if (!store.graph.getNode(parentId)) throw new Error(`Automation parent "${parentId}" not found`)
    const parentPageId = pageIdForNode(store, parentId)
    if (!parentPageId) {
      throw new Error(`Automation parent "${parentId}" does not belong to a page`)
    }
    const before = store.snapshotPage(parentPageId)
    try {
      const results = await renderAutomationRoots(target, tree, parentId, toolArgs, context)
      const rootIds = results.map((node) => node.id)
      const appliedPlacement = applyRenderPlacement(store.graph, rootIds, placement)
      throwIfAborted(context?.signal)
      await ensureGraphFonts(store.graph, rootIds, store.renderer, context?.signal)
      throwIfAborted(context?.signal)
      await yieldToHost()
      throwIfAborted(context?.signal)
      await computeAllLayoutsAsync(store.graph, parentPageId, context?.signal)
      await yieldToHost()
      throwIfAborted(context?.signal)
      store.requestRender()
      store.flashNodes(rootIds)
      return {
        ok: true,
        result: automationRenderResult(results, appliedPlacement),
        meta: {
          sceneVersionBefore,
          sceneVersionAfter: store.state.sceneVersion,
          mutationScope: 'page',
          targetPageId: parentPageId,
          mutatedIds: rootIds,
          ...(appliedPlacement.replacedId ? { deletedIds: [appliedPlacement.replacedId] } : {})
        }
      }
    } catch (error) {
      store.restorePageFromSnapshot(before, parentPageId)
      throw error
    }
  }

  return async function handleTool(
    target: AutomationTarget,
    args: unknown,
    context?: AutomationRequestContext
  ): Promise<unknown> {
    const toolName = (args as { name?: string }).name
    const toolArgs = (args as { args?: Record<string, unknown> }).args ?? {}
    if (!toolName) throw new Error('Missing "name" in args')
    throwIfAborted(context?.signal)

    if (toolName === 'render' && toolArgs.tree) {
      return serializeToolMutation(target.store, () => handleToolRender(target, toolArgs, context))
    }

    const def = ALL_TOOLS.find((t) => t.name === toolName)
    if (!def) throw new Error(`Unknown tool: ${toolName}`)
    const store = target.store
    if (COMPONENT_CATALOG_TOOLS.has(def.name)) {
      const libraryService = useLibraryService()
      libraryService.bindEditor(store)
      registerComponentCatalog(store.graph, libraryService)
    }
    const execute = async () => {
      throwIfAborted(context?.signal)
      const targetPage = store.graph.getNode(target.pageId)
      if (targetPage?.type !== 'CANVAS') throw new Error('Automation target page is no longer open')
      const figma = makeFigma(store, target.pageId)
      const { pageId, scope } = resolveEditorMutationScope(store, toolArgs, {
        forceDocument: DOCUMENT_SCOPE_TOOLS.has(def.name) || def.name === 'batch_update'
      })
      const sceneVersionBefore = store.state.sceneVersion
      const tracksGraph = def.mutates && !NON_GRAPH_MUTATION_TOOLS.has(def.name)
      const before = tracksGraph ? snapshotMutationScope(store, pageId, scope) : undefined
      try {
        return await runWithUndoBatch(
          store,
          def.name,
          async () => {
            const result = await def.execute(figma, toolArgs, {
              ...(EDITOR_UNDO_TOOLS.has(def.name) ? { editor: store } : {}),
              ...(MODULE_CREATION_POLICY_TOOLS.has(def.name)
                ? { canCreateModule }
                : {}),
              signal: context?.signal,
              onProgress: context?.onProgress,
              deferLayout: def.name === 'render'
            })
            throwIfAborted(context?.signal)
            if (tracksGraph && store.state.sceneVersion !== sceneVersionBefore) {
              const pageNode = store.graph.getNode(pageId)
              if (pageNode) {
                await ensureGraphFonts(
                  store.graph,
                  pageNode.childIds,
                  store.renderer,
                  context?.signal
                )
              }
              throwIfAborted(context?.signal)
              await yieldToHost()
              throwIfAborted(context?.signal)
              await computeAllLayoutsAsync(store.graph, pageId, context?.signal)
              await yieldToHost()
              throwIfAborted(context?.signal)
              store.requestRender()
              store.flashNodes(extractNodeIds(result))
            }
            return {
              ok: true,
              result,
              meta: {
                sceneVersionBefore,
                sceneVersionAfter: store.state.sceneVersion,
                mutationScope: scope,
                targetPageId: pageId,
                ...(def.mutates ? { mutatedIds: extractNodeIds(result) } : {})
              }
            }
          },
          context?.signal
        )
      } catch (error) {
        const mutationChanged =
          before?.scope === 'document'
            ? store.state.sceneVersion !== sceneVersionBefore ||
              store.documentSnapshotChanged(before.snapshot)
            : store.state.sceneVersion !== sceneVersionBefore
        if (before && mutationChanged) {
          if (before.scope === 'document') store.restoreDocumentFromSnapshot(before.snapshot)
          else store.restorePageFromSnapshot(before.snapshot, pageId)
        }
        throw error
      }
    }

    return def.mutates ? serializeToolMutation(store, execute) : execute()
  }
}

function snapshotMutationScope(
  store: Editor,
  pageId: string,
  scope: 'document' | 'page'
): AutomationMutationSnapshot {
  if (scope === 'document') {
    return { scope: 'document' as const, snapshot: store.snapshotDocument() }
  }
  return { scope: 'page' as const, snapshot: store.snapshotPage(pageId) }
}

/** §3.v2 decision d: opt-in tools wrap their dispatch in
 *  `editor.undo.runBatch` so the data mutation plus any selection /
 *  flash side-effect collapses into a single Cmd+Z entry. Tools not
 *  in `EDITOR_UNDO_TOOLS` keep the legacy no-batch path. */
async function runWithUndoBatch<T>(
  store: Editor,
  toolName: string,
  fn: () => T | Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!EDITOR_UNDO_TOOLS.has(toolName)) {
    const result = await fn()
    throwIfAborted(signal)
    return result
  }
  store.undo.beginBatch(`AI: ${toolName}`)
  try {
    const result = await fn()
    throwIfAborted(signal)
    store.undo.commitBatch()
    return result
  } catch (err) {
    store.undo.rollbackBatch()
    throw err
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Automation request cancelled')
  error.name = 'AbortError'
  throw error
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function addResultItemIds(value: unknown, ids: Set<string>): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const id = (item as JSONObject).id
    if (typeof id === 'string') ids.add(id)
  }
}

function extractNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as JSONObject
  if (obj.ok === false) return []
  if (typeof obj.deleted === 'string') return []
  const ids = new Set<string>()
  if (typeof obj.id === 'string') ids.add(obj.id)
  if (typeof obj.nodeId === 'string') ids.add(obj.nodeId)
  if (typeof obj.pageId === 'string') ids.add(obj.pageId)
  if (Array.isArray(obj.nodeIds)) {
    for (const nodeId of obj.nodeIds) if (typeof nodeId === 'string') ids.add(nodeId)
  }
  for (const key of ['results', 'moved'] as const) {
    addResultItemIds(obj[key], ids)
  }
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    for (const nodeId of extractNodeIds(obj.data)) ids.add(nodeId)
  }
  return [...ids]
}
