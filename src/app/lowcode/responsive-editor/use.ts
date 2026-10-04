import { computed, onBeforeUnmount, type Ref } from 'vue'

import type {
  ResponsiveBreakpoint,
  ResponsiveOverride,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'
import { provideRetainedActivity, useRetainedActivity } from '@open-pencil/vue'

import { getActiveEditorStore } from '@/app/editor/active-store'

import { responsiveClearBreakpoint, responsiveSetField } from './model'

export interface ResponsiveEditContext {
  enabled: Readonly<Ref<boolean>>
  key: () => string
  cancelDrafts: () => void
}

/** Recheck live ownership before a numeric draft or a portalled selector can write. */
export function responsiveNodeEditable(graph: SceneGraph, node: SceneNode): boolean {
  const visited = new Set<string>()
  for (let current = node; ;) {
    if (
      visited.has(current.id) ||
      current.locked ||
      current.internalOnly ||
      current.libraryReadonly ||
      current.librarySource?.readOnly
    )
      return false
    visited.add(current.id)
    if (!current.parentId) return true
    const parent = graph.getNode(current.parentId)
    if (!parent) return false
    current = parent
  }
}

export function useResponsiveFields(options: {
  node: () => SceneNode
  graph: SceneGraph
  breakpoint: ResponsiveBreakpoint
  context: ResponsiveEditContext
}) {
  const store = getActiveEditorStore()
  const owner = options.graph.getNode(options.node().id)
  const pageId = store.state.currentPageId
  const initialKey = options.context.key()
  const retained = useRetainedActivity()
  let disposed = false
  onBeforeUnmount(() => {
    disposed = true
  })
  const active = computed(() => {
    // Reading the context key tracks authored fields and selection before Vue replaces the view.
    const matches = options.context.key() === initialKey
    return (
      matches &&
      options.context.enabled.value &&
      retained?.value !== false &&
      getActiveEditorStore() === store &&
      store.graph === options.graph &&
      store.state.currentPageId === pageId &&
      store.state.selectedIds.size === 1 &&
      owner !== undefined &&
      store.state.selectedIds.has(owner.id) &&
      store.graph.getNode(owner.id) === owner &&
      responsiveNodeEditable(options.graph, options.node())
    )
  })
  provideRetainedActivity(active)

  function setField<K extends keyof ResponsiveOverride>(
    key: K,
    value: ResponsiveOverride[K] | undefined
  ) {
    if (disposed || !active.value || !owner) return
    const current = owner.responsiveOverrides?.[options.breakpoint]
    if (
      Object.is(current?.[key], value) &&
      (value !== undefined || !Object.hasOwn(current ?? {}, key))
    )
      return
    store.updateNodeWithUndo(
      owner.id,
      {
        responsiveOverrides: responsiveSetField(
          owner.responsiveOverrides,
          options.breakpoint,
          key,
          value
        )
      },
      'Update responsive overrides'
    )
  }
  function clearBreakpoint() {
    if (disposed || !active.value || !owner?.responsiveOverrides?.[options.breakpoint]) return
    store.updateNodeWithUndo(
      owner.id,
      {
        responsiveOverrides: responsiveClearBreakpoint(
          owner.responsiveOverrides,
          options.breakpoint
        )
      },
      'Clear responsive breakpoint'
    )
  }
  return { active, setField, clearBreakpoint }
}
