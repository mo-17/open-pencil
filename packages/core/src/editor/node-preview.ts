import { isEqual, pick, uniq } from 'es-toolkit'

import {
  cloneInstanceOverrideState,
  findInstanceAncestor,
  recordInstanceOverride,
  type InstanceOverrideState,
  type SceneNode
} from '@open-pencil/scene-graph'

import { assertNodeEditable } from './capabilities'
import type { EditorContext } from './types'

export interface NodePreview {
  readonly closed: boolean
  /** Defer derived layout while composing a geometric update; flush with a normal update. */
  update: (id: string, changes: Partial<SceneNode>, options?: { deferLayout?: boolean }) => void
  commit: (
    finalize?: (
      node: SceneNode,
      before: Readonly<Partial<SceneNode>>
    ) => Partial<SceneNode> | undefined
  ) => void
  cancel: () => void
}

/** One owned numeric/property edit, including every node changed by its layout. */
export function createNodePreviewActions(
  ctx: EditorContext,
  updateNode: (id: string, changes: Partial<SceneNode>) => void
) {
  let current: NodePreview | null = null

  function cancelNodePreviews() {
    current?.cancel()
  }

  function beginNodePreview(
    label = 'Update',
    options: { preserveSourceMetadata?: boolean } = {}
  ): NodePreview {
    cancelNodePreviews()
    const graph = ctx.graph
    // Geometric editors own their targeted raw-metadata invalidation. Preserve their
    // source payload on the initial commit and every later history replay as well.
    const preserveSourceMetadata = options.preserveSourceMetadata === true
    const originals = new Map<string, Partial<SceneNode>>()
    const targets = new Set<string>()
    const layoutOnly = new Set<string>()
    const editedBefore = new Map<string, string[]>()
    const overridesBefore = new Map<string, InstanceOverrideState>()
    let closed = false
    let endInteraction: (() => void) | undefined
    const subscriptions: Array<() => void> = []

    function capture(node: SceneNode, changes: Partial<SceneNode>) {
      if (!originals.has(node.id) && graph.isApplyingLayout) layoutOnly.add(node.id)
      if (!graph.isApplyingLayout) {
        layoutOnly.delete(node.id)
        markEdited(node, changes)
        const owner = findInstanceAncestor(graph, node.id)
        if (owner && !overridesBefore.has(owner.id))
          overridesBefore.set(owner.id, cloneInstanceOverrideState(owner.instanceOverrides))
      }
      const previous = originals.get(node.id) ?? {}
      const keys = (Object.keys(changes) as (keyof SceneNode)[]).filter(
        (key) => !Object.hasOwn(previous, key)
      )
      if (keys.length) Object.assign(previous, structuredClone(pick(node, keys)))
      originals.set(node.id, previous)
    }

    // Fields count as edited while previewed, as a committed edit marks them, so the preview's
    // own layout stops keeping geometry a file saved; cancel takes the marks back.
    function markEdited(node: SceneNode, changes: Partial<SceneNode>) {
      if (preserveSourceMetadata || graph.isPreservingSourceMetadata) return
      if (!editedBefore.has(node.id)) editedBefore.set(node.id, node.source.editedFields)
      node.source.editedFields = uniq([...node.source.editedFields, ...Object.keys(changes)])
    }

    function close() {
      closed = true
      for (const stop of subscriptions) stop()
      endInteraction?.()
      if (current === preview) current = null
    }

    // Callback/event dispatch can cancel the transaction synchronously.
    function isClosed(): boolean {
      return closed
    }

    function collectEdits() {
      const edits: Array<{
        id: string
        before: Partial<SceneNode>
        after: Partial<SceneNode>
      }> = []
      for (const [id, before] of originals) {
        const node = graph.getNode(id)
        if (!node) continue
        const after = structuredClone(pick(node, Object.keys(before) as (keyof SceneNode)[]))
        if (!isEqual(before, after)) edits.push({ id, before, after })
      }
      return edits
    }

    const preview: NodePreview = {
      get closed() {
        return closed
      },
      update(id, changes, updateOptions) {
        if (closed || graph !== ctx.graph || !graph.getNode(id)) return
        targets.add(id)
        endInteraction ??= ctx.beginInteractiveEdit()
        try {
          assertNodeEditable(graph, id)
          graph.runPreviewUpdates(() => {
            if (updateOptions?.deferLayout) graph.updateNodePreview(id, changes)
            else if (Object.keys(changes).length === 0) ctx.runLayoutForNode(id)
            else updateNode(id, changes)
          }, capture)
          ctx.requestRepaint()
        } catch (error) {
          preview.cancel()
          throw error
        }
      },
      commit(finalize) {
        if (closed) return
        try {
          for (const id of targets) assertNodeEditable(graph, id)
        } catch (error) {
          preview.cancel()
          throw error
        }
        let edits = collectEdits()
        if (finalize) {
          try {
            for (const edit of edits) {
              const node = graph.getNode(edit.id)
              if (!node) continue
              const changes = finalize(node, edit.before)
              if (isClosed()) return
              if (!changes) continue
              graph.runPreviewUpdates(() => {
                const update = () => graph.updateNodePreview(edit.id, changes)
                if (layoutOnly.has(edit.id)) graph.withLayoutMutations(update)
                else update()
              }, capture)
              if (isClosed()) return
            }
            edits = collectEdits()
          } catch (error) {
            preview.cancel()
            throw error
          }
        }
        close()
        if (edits.length === 0) {
          if (originals.size) ctx.requestRender()
          return
        }
        function apply(direction: 'before' | 'after') {
          const applyEdits = () => {
            for (const edit of edits) {
              const update = () => graph.updateNode(edit.id, structuredClone(edit[direction]))
              if (layoutOnly.has(edit.id)) graph.withLayoutMutations(update)
              else update()
            }
            if (direction === 'after') {
              for (const edit of edits) {
                if (layoutOnly.has(edit.id)) continue
                const fields = (Object.keys(edit.before) as (keyof SceneNode)[]).filter(
                  (key) => !isEqual(edit.before[key], edit.after[key])
                )
                recordInstanceOverride(graph, edit.id, fields)
              }
            } else {
              for (const [id, state] of overridesBefore)
                graph.updateNode(id, { instanceOverrides: cloneInstanceOverrideState(state) })
            }
          }
          if (preserveSourceMetadata) graph.preserveSourceMetadataDuring(applyEdits)
          else applyEdits()
          ctx.requestRender()
        }
        ctx.undo.push({
          label,
          forward: () => apply('after'),
          inverse: () => apply('before')
        })
        // Publish the complete preview delta, including layout children and implicit edits.
        apply('after')
      },
      cancel() {
        if (closed) return
        close()
        for (const [id, previous] of originals)
          graph.updateNodePreview(id, structuredClone(previous))
        for (const [id, fields] of editedBefore) {
          const node = graph.getNode(id)
          if (node) node.source.editedFields = fields
        }
        // Reconcile retained/tiled resources once; cancellation publishes no committed node edits.
        if (originals.size) ctx.requestRender()
      }
    }
    for (const event of ['selection:changed', 'page:changed', 'graph:replaced'] as const) {
      subscriptions.push(ctx.onEditorEvent(event, preview.cancel))
    }
    subscriptions.push(
      ctx.onEditorEvent('node:deleted', (id) => {
        if (targets.has(id) || originals.has(id)) preview.cancel()
      })
    )
    current = preview
    return preview
  }

  return { beginNodePreview, cancelNodePreviews }
}
