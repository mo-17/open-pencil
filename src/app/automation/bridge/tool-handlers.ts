import type { Editor } from '@open-pencil/core/editor'
import { renderTreeNode } from '@open-pencil/core/design-jsx'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { ALL_TOOLS } from '@open-pencil/core/tools'

import type { EditorStore } from '@/app/editor/active-store'

type FigmaFactory = () => FigmaAPI

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
    store: EditorStore,
    toolArgs: Record<string, unknown>
  ): Promise<unknown> {
    const tree = toolArgs.tree as Parameters<typeof renderTreeNode>[1]
    const result = await renderTreeNode(store.graph, tree, {
      parentId: (toolArgs.parent_id as string | undefined) ?? store.state.currentPageId,
      x: toolArgs.x as number | undefined,
      y: toolArgs.y as number | undefined
    })
    computeAllLayouts(store.graph, store.state.currentPageId)
    store.requestRender()
    store.flashNodes([result.id])
    return {
      ok: true,
      result: { id: result.id, name: result.name, type: result.type, children: result.childIds }
    }
  }

  return async function handleTool(store: EditorStore, args: unknown): Promise<unknown> {
    const toolName = (args as { name?: string }).name
    const toolArgs = (args as { args?: Record<string, unknown> }).args ?? {}
    if (!toolName) throw new Error('Missing "name" in args')

    if (toolName === 'render' && toolArgs.tree) {
      return handleToolRender(store, toolArgs)
    }

    const def = ALL_TOOLS.find((t) => t.name === toolName)
    if (!def) throw new Error(`Unknown tool: ${toolName}`)
    const figma = makeFigma()
    const editor: Editor = store
    const result = await runWithUndoBatch(store, def.name, () =>
      def.execute(figma, toolArgs, { editor })
    )

    if (figma.currentPageId !== store.state.currentPageId) {
      void store.switchPage(figma.currentPageId)
    }

    if (def.mutates) {
      computeAllLayouts(store.graph, store.state.currentPageId)
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
  store: EditorStore,
  toolName: string,
  fn: () => T | Promise<T>
): Promise<T> {
  if (!EDITOR_UNDO_TOOLS.has(toolName)) return await fn()
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
  const obj = result as Record<string, unknown>
  if (typeof obj.deleted === 'string') return []
  const ids: string[] = []
  if (typeof obj.id === 'string') ids.push(obj.id)
  if (Array.isArray(obj.results)) {
    for (const item of obj.results) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).id === 'string'
      )
        ids.push((item as Record<string, unknown>).id as string)
    }
  }
  return ids
}
