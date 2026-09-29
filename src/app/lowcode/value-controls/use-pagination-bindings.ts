import { computed, onScopeDispose, ref, watch } from 'vue'

import { resolvePaginationModule } from '@open-pencil/core/plugins'
import { validateExpression } from '@open-pencil/lowcode'
import type { BindingExpr, SceneNode } from '@open-pencil/scene-graph'
import { useI18n, useRetainedActivity, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { currentModuleEditorOwner } from '@/app/lowcode/module-editor/owner'

import {
  PAGINATION_BINDING_KEYS,
  paginationBindingFromSelection,
  paginationBindingOptions,
  paginationBindingSelection,
  type PaginationBindingKey
} from './pagination-bindings'

export function usePaginationBindings() {
  const editor = useEditorStore()
  const { panels } = useI18n()
  const { selectedNode } = useSelectionState()
  const owner = useSceneComputed(() => {
    const selected = selectedNode.value
    // Selection state exposes display copies; writes retain the live graph owner's identity.
    const node = selected ? editor.graph.getNode(selected.id) : undefined
    return node && resolvePaginationModule(node.interactiveProps?.module)?.ok ? node : undefined
  })
  const active = useRetainedActivity()
  const generation = ref(0)
  let inputOwner: typeof owner.value
  let previousModule: unknown
  function cancel() {
    inputOwner = undefined
    previousModule = undefined
    generation.value++
  }
  watch(() => [owner.value, active?.value], cancel, { flush: 'sync' })
  onScopeDispose(cancel)
  function begin(event: Event) {
    const target = event.currentTarget as HTMLElement
    if (active?.value === false || Number(target.dataset.paginationGeneration) !== generation.value)
      return
    inputOwner = owner.value
    previousModule = structuredClone(inputOwner?.interactiveProps?.module)
  }
  const rows = useSceneComputed(() => {
    const node = owner.value
    if (!node) return []
    return PAGINATION_BINDING_KEYS.map((key) => {
      const binding = node.bindings?.[key]
      const options = paginationBindingOptions(editor.graph, node, editor.state.currentPageId, key)
      const expression = binding?.kind === 'expr' ? (binding.expr ?? '') : ''
      return {
        key,
        generation: generation.value,
        options,
        selected: paginationBindingSelection(binding, key, options),
        expression
      }
    })
  })
  const labels = computed(() => ({
    currentPage: panels.value.lowcodePaginationCurrentPage,
    total: panels.value.lowcodeModulePaginationTotal,
    pageSize: panels.value.lowcodeModulePaginationPageSize
  }))

  function commit(key: PaginationBindingKey, next: BindingExpr | undefined) {
    const node = owner.value
    if (
      !node ||
      active?.value === false ||
      inputOwner !== node ||
      !currentModuleEditorOwner(editor, {
        owner: node,
        previousModule
      })
    )
      return
    const bindings = { ...node.bindings }
    if (next) bindings[key] = next
    else Reflect.deleteProperty(bindings, key)
    editor.updateNodeWithUndo(node.id, { bindings }, panels.value.lowcodePaginationBindings)
  }

  function select(key: PaginationBindingKey, event: Event) {
    const target = event.target as HTMLElement
    if (!target.isConnected || target.dataset.ownerId !== owner.value?.id) return
    const row = rows.value.find((entry) => entry.key === key)
    if (!row) return
    const next = paginationBindingFromSelection(
      (event.target as HTMLSelectElement).value,
      key,
      row.options
    )
    if (next !== null) commit(key, next)
  }

  function expression(
    key: PaginationBindingKey,
    value: string,
    target: SceneNode | undefined,
    renderedGeneration: number
  ) {
    if (
      key === 'currentPage' ||
      target !== owner.value ||
      renderedGeneration !== generation.value ||
      !validateExpression(value).ok
    )
      return
    commit(key, { kind: 'expr', expr: value })
  }
  function expressionError(value: string): string | undefined {
    const result = validateExpression(value)
    return result.ok ? undefined : result.reason
  }

  return { owner, rows, labels, panels, select, expression, generation, begin, expressionError }
}
