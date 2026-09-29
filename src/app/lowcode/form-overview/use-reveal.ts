import {
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
  type Ref
} from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  clearLowcodeActionFocus,
  requestLowcodeActionFocus,
  type LowcodeActionFocusTarget
} from '@/app/lowcode/action/focus'
import { flashLowcodeFocusHighlight } from '@/app/lowcode/focus-highlight'

import type { FormOverviewTarget } from './types'

const VALUE_BINDING_SELECTOR =
  '[data-test-id="lowcode-value-binding-select"]:not(:disabled), [data-test-id="lowcode-value-binding-create"], [data-module-binding]'

/** Temporary inspector navigation. It never changes the saved workspace layout or graph. */
export function useFormOverviewReveal(
  editor: Pick<Editor, 'graph' | 'select'> & { state: Pick<Editor['state'], 'sceneVersion'> },
  selectedNode: Readonly<Ref<SceneNode | null | undefined>>,
  selectedCount: Readonly<Ref<number>>,
  filter: Ref<string>
) {
  const root = ref<HTMLElement | null>(null)
  const request = shallowRef<{ graph: Editor['graph']; target: FormOverviewTarget } | null>(null)
  let actionFocus: LowcodeActionFocusTarget | null = null

  function setRoot(element: Element | ComponentPublicInstance | null): void {
    root.value = element instanceof HTMLElement ? element : null
  }

  function clear(): void {
    request.value = null
    if (actionFocus) clearLowcodeActionFocus(actionFocus)
    actionFocus = null
  }

  function isRevealedSection(id: string): boolean {
    const current = request.value
    return (
      current?.graph === editor.graph &&
      current.target.nodeId === selectedNode.value?.id &&
      current.target.section === id
    )
  }

  async function reveal(requestedTarget: FormOverviewTarget): Promise<void> {
    const graph = editor.graph
    const node = graph.getNode(requestedTarget.nodeId)
    if (!node) return
    const target: FormOverviewTarget =
      requestedTarget.section === 'lowcode-bindings' &&
      (node.type === 'RADIO' || node.type === 'SELECT')
        ? { ...requestedTarget, section: 'lowcode-control' }
        : requestedTarget
    clear()
    if (target.actionId && target.actionPath) {
      actionFocus = {
        nodeId: target.nodeId,
        actionId: target.actionId,
        actionPath: target.actionPath
      }
      requestLowcodeActionFocus(graph, actionFocus)
    }
    filter.value = ''
    editor.select([target.nodeId])
    const current = { graph, target }
    request.value = current
    await nextTick()
    // Collapsible presence mounts its children after its own nextTick; focus after layout.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    if (request.value !== current || !isRevealedSection(target.section)) return
    const section = root.value?.querySelector<HTMLElement>(
      `[data-test-id="inspector-section-${target.section}"]`
    )
    section?.scrollIntoView({ block: 'nearest' })
    const selectors = {
      'lowcode-bindings': VALUE_BINDING_SELECTOR,
      'lowcode-control': VALUE_BINDING_SELECTOR,
      'lowcode-validation':
        '[data-test-id="lowcode-validation-required"], [data-test-id="lowcode-validation-summary-enabled"]',
      'lowcode-events': 'button'
    }
    const selector = target.actionPath
      ? `[data-lowcode-action-path="${CSS.escape(target.actionPath)}"]`
      : selectors[target.section]
    const field = section?.querySelector<HTMLElement>(selector)
    field?.scrollIntoView({ block: 'nearest' })
    field?.focus({ preventScroll: true })
    if (actionFocus && field) clearLowcodeActionFocus(actionFocus)
    flashLowcodeFocusHighlight(target.actionPath ? field : section)
  }

  watch(
    () => [editor.state.sceneVersion, selectedNode.value?.id, selectedCount.value],
    () => {
      const current = request.value
      if (
        current &&
        (current.graph !== editor.graph ||
          current.target.nodeId !== selectedNode.value?.id ||
          selectedCount.value !== 1)
      )
        clear()
    },
    { flush: 'sync' }
  )
  onScopeDispose(clear)
  return { setRoot, isRevealedSection, reveal }
}
