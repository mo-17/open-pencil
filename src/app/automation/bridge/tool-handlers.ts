import { renderTreeNode } from '@open-pencil/core/design-jsx'
import type { Editor } from '@open-pencil/core/editor'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import type { AutomationTarget } from '@/app/automation/bridge/target'
import { ensureGraphFonts } from '@/app/editor/fonts'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

/** Phase 3 §3.v2: tools that opt into editor-backed undo (push UndoEntry +
 *  participate in `runBatch`). Anything not listed here calls
 *  `def.execute(figma, args)` without ctx, preserving the legacy
 *  no-undo path for tools that haven't migrated yet. */
const EDITOR_UNDO_TOOLS = new Set<string>([
  'update_lowcode_node',
  'set_doc_states',
  'set_supabase_config'
])

export function createAutomationToolHandler(makeFigma: FigmaFactory) {
  async function handleToolRender(
    target: AutomationTarget,
    toolArgs: Record<string, unknown>
  ): Promise<unknown> {
    const store = target.store
    const tree = toolArgs.tree as Parameters<typeof renderTreeNode>[1]
    const result = await renderTreeNode(store.graph, tree, {
      parentId: (toolArgs.parent_id as string | undefined) ?? target.pageId,
      x: toolArgs.x as number | undefined,
      y: toolArgs.y as number | undefined
    })
    await ensureGraphFonts(store.graph, [result.id], store.renderer)
    computeAllLayouts(store.graph, target.pageId)
    store.requestRender()
    store.flashNodes([result.id])
    return {
      ok: true,
      result: { id: result.id, name: result.name, type: result.type, children: result.childIds }
    }
  }

  return async function handleTool(target: AutomationTarget, args: unknown): Promise<unknown> {
    const toolName = (args as { name?: string }).name
    const toolArgs = (args as { args?: Record<string, unknown> }).args ?? {}
    if (!toolName) throw new Error('Missing "name" in args')

    if (toolName === 'render' && toolArgs.tree) {
      return handleToolRender(target, toolArgs)
    }

    const def = ALL_TOOLS.find((t) => t.name === toolName)
    if (!def) throw new Error(`Unknown tool: ${toolName}`)
    const store = target.store
    const figma = makeFigma(store, target.pageId)
    const result = await runWithUndoBatch(store, def.name, () =>
      EDITOR_UNDO_TOOLS.has(def.name)
        ? def.execute(figma, toolArgs, { editor: store })
        : def.execute(figma, toolArgs)
    )

    if (def.mutates) {
      const pageNode = store.graph.getNode(figma.currentPageId)
      if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds, store.renderer)
      computeAllLayouts(store.graph, figma.currentPageId)
      store.requestRender()
      store.flashNodes(extractNodeIds(result))
    }
    return { ok: true, result }
  }
}

/** §3.v2 decision d: opt-in tools wrap their dispatch in
 *  `editor.undo.runBatch` so the data mutation plus any selection /
 *  flash side-effect collapses into a single Cmd+Z entry. Tools not
 *  in `EDITOR_UNDO_TOOLS` keep the legacy no-batch path. */
async function runWithUndoBatch<T>(
  store: Editor,
  toolName: string,
  fn: () => T | Promise<T>
): Promise<T> {
  if (!EDITOR_UNDO_TOOLS.has(toolName)) return fn()
  store.undo.beginBatch(`AI: ${toolName}`)
  try {
    const result = await fn()
    store.undo.commitBatch()
    return result
  } catch (err) {
    store.undo.rollbackBatch()
    throw err
  }
}

function extractNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as JsonObject
  if (typeof obj.deleted === 'string') return []
  const ids: string[] = []
  if (typeof obj.id === 'string') ids.push(obj.id)
  if (Array.isArray(obj.results)) {
    for (const item of obj.results) {
      if (item && typeof item === 'object' && typeof (item as JsonObject).id === 'string')
        ids.push((item as JsonObject).id as string)
    }
  }
  return ids
}
