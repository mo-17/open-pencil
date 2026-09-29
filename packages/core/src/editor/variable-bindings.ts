import { isNumberVariableBindingField, type SceneNode } from '@open-pencil/scene-graph'

import type { EditorContext } from './types'

export function createVariableBindingActions(
  ctx: EditorContext,
  updateNodeWithUndo: (nodeId: string, changes: Partial<SceneNode>, label: string) => void
) {
  function bindVariable(nodeId: string, path: string, variableId: string) {
    const node = ctx.graph.getNode(nodeId)
    if (!node) return
    const prevVarId = node.boundVariables[path]
    ctx.graph.bindVariable(nodeId, path, variableId)
    ctx.undo.push({
      label: 'Bind variable',
      forward: () => {
        try {
          ctx.graph.bindVariable(nodeId, path, variableId)
          ctx.requestRender()
        } catch (e) {
          console.warn('Redo bindVariable failed:', e instanceof Error ? e.message : String(e))
        }
      },
      inverse: () => {
        try {
          if (prevVarId) ctx.graph.bindVariable(nodeId, path, prevVarId)
          else ctx.graph.unbindVariable(nodeId, path)
          ctx.requestRender()
        } catch (e) {
          console.warn('Undo bindVariable failed:', e instanceof Error ? e.message : String(e))
        }
      }
    })
    ctx.requestRender()
  }

  function unbindVariable(nodeId: string, path: string) {
    const node = ctx.graph.getNode(nodeId)
    if (!node) return
    const prevVarId = node.boundVariables[path]
    if (!prevVarId) return
    const resolved = isNumberVariableBindingField(path)
      ? ctx.graph.resolveEffectiveVariableForNode(nodeId, prevVarId)
      : undefined
    ctx.undo.runBatch('Unbind variable', () => {
      // Persist only a concrete displayed number. Broken aliases and missing modes
      // keep the authored value, and raw graph unbind remains a binding-only action.
      if (typeof resolved === 'number' && Number.isFinite(resolved)) {
        updateNodeWithUndo(nodeId, { [path]: resolved }, 'Unbind variable')
      }
      removeBinding(nodeId, path, prevVarId)
    })
  }

  function removeBinding(nodeId: string, path: string, prevVarId: string) {
    ctx.graph.unbindVariable(nodeId, path)
    ctx.undo.push({
      label: 'Unbind variable',
      forward: () => {
        try {
          ctx.graph.unbindVariable(nodeId, path)
          ctx.requestRender()
        } catch (e) {
          console.warn('Redo unbindVariable failed:', e instanceof Error ? e.message : String(e))
        }
      },
      inverse: () => {
        try {
          ctx.graph.bindVariable(nodeId, path, prevVarId)
          ctx.requestRender()
        } catch (e) {
          console.warn('Undo unbindVariable failed:', e instanceof Error ? e.message : String(e))
        }
      }
    })
    ctx.requestRender()
  }

  return { bindVariable, unbindVariable }
}
