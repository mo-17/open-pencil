import { computed, ref, watch } from 'vue'

import {
  type MotionEasingName,
  type PrototypeAction,
  type PrototypeConnection,
  type PrototypeSpecV1,
  type PrototypeTransition,
  type PrototypeTransitionDirection,
  type PrototypeTrigger
} from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  addPrototypeConnection,
  listPrototypeTargets,
  nextPrototypeConnectionId,
  removePrototypeConnection,
  replacePrototypeConnection,
  updateNodePrototypeWithUndo,
  updateNodeTransitionKeyWithUndo
} from '@/app/properties/prototype'

type PrototypeActionKind = PrototypeAction['kind']
type PrototypeTransitionKind = PrototypeTransition['kind']

const DEFAULT_EASING: MotionEasingName = 'ease'

function transition(kind: PrototypeTransitionKind): PrototypeTransition {
  if (kind === 'instant') return { kind }
  if (kind === 'smartMatch') {
    return { kind, durationMs: 300, easing: DEFAULT_EASING, fallback: 'dissolve' }
  }
  if (kind === 'slide' || kind === 'push') {
    return { kind, durationMs: 300, easing: DEFAULT_EASING, direction: 'left' }
  }
  return { kind, durationMs: 300, easing: DEFAULT_EASING }
}

function action(kind: PrototypeActionKind, targetNodeId?: string): PrototypeAction | null {
  if (kind === 'navigate') return targetNodeId ? { kind, targetNodeId } : null
  if (kind === 'openOverlay') {
    return targetNodeId ? { kind, targetNodeId, placement: 'center', dismissOnOutside: true } : null
  }
  return { kind }
}

export function usePrototypeAuthoring(selectedIds: () => readonly string[]) {
  const store = useEditorStore()
  const { panels } = useI18n()
  const errorMessage = ref<string | null>(null)
  const transitionKeyDraft = ref('')
  const selectionKey = computed(() => selectedIds().join('\0'))
  const selectedNode = useSceneComputed(() => {
    const ids = selectedIds()
    return ids.length === 1 ? store.graph.getNode(ids[0] ?? '') : undefined
  })
  const spec = useSceneComputed(() => {
    const ids = selectedIds()
    return ids.length === 1 ? store.graph.getNode(ids[0] ?? '')?.prototype : undefined
  })
  const selectedTransitionKey = useSceneComputed(() => {
    const ids = selectedIds()
    return ids.length === 1 ? store.graph.getNode(ids[0] ?? '')?.transitionKey : undefined
  })
  const connections = computed(() => spec.value?.connections ?? [])
  const targets = useSceneComputed(() => listPrototypeTargets(store))
  const canAuthor = computed(() => selectedNode.value !== undefined)

  watch(
    () => [selectionKey.value, selectedTransitionKey.value ?? ''] as const,
    ([, key]) => {
      transitionKeyDraft.value = key
      errorMessage.value = null
    },
    { immediate: true }
  )

  function run(operation: () => void): boolean {
    try {
      operation()
      errorMessage.value = null
      return true
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  function commit(next: PrototypeSpecV1 | undefined): void {
    const node = selectedNode.value
    if (!node) return
    run(() => updateNodePrototypeWithUndo(store, node.id, next, panels.value.motionUpdate))
  }

  function addConnection(): void {
    const node = selectedNode.value
    if (!node) return
    const trigger: PrototypeTrigger =
      (node.events?.onClick?.length ?? 0) > 0
        ? { kind: 'afterDelay', delayMs: 500 }
        : { kind: 'click' }
    const connection: PrototypeConnection = {
      id: nextPrototypeConnectionId(spec.value),
      trigger,
      action: { kind: 'back' },
      transition: { kind: 'instant' },
      interruption: 'replace',
      playback: 'forward'
    }
    run(() => commit(addPrototypeConnection(spec.value, connection)))
  }

  function updateConnection(
    connectionId: string,
    mutate: (connection: PrototypeConnection) => PrototypeConnection
  ): void {
    const current = spec.value
    if (!current) return
    const connection = current.connections.find(({ id }) => id === connectionId)
    if (!connection) return
    run(() => commit(replacePrototypeConnection(current, mutate(structuredClone(connection)))))
  }

  function removeConnection(connectionId: string): void {
    const current = spec.value
    if (!current) return
    run(() => commit(removePrototypeConnection(current, connectionId)))
  }

  function updateTrigger(connectionId: string, kind: PrototypeTrigger['kind']): void {
    updateConnection(connectionId, (connection) => ({
      ...connection,
      trigger: kind === 'click' ? { kind } : { kind, delayMs: 500 }
    }))
  }

  function updateDelay(connectionId: string, delayMs: number): void {
    updateConnection(connectionId, (connection) => ({
      ...connection,
      trigger: { kind: 'afterDelay', delayMs }
    }))
  }

  function updateAction(connectionId: string, kind: PrototypeActionKind): void {
    const next = action(kind, targets.value[0]?.id)
    if (!next) {
      errorMessage.value = panels.value.motionPrototypeNoTargets
      return
    }
    updateConnection(connectionId, (connection) => ({ ...connection, action: next }))
  }

  function updateTarget(connectionId: string, targetNodeId: string): void {
    updateConnection(connectionId, (connection) => {
      const current = connection.action
      if (current.kind === 'navigate') {
        return { ...connection, action: { ...current, targetNodeId } }
      }
      if (current.kind === 'openOverlay') {
        return { ...connection, action: { ...current, targetNodeId } }
      }
      return connection
    })
  }

  function updateOverlayPlacement(
    connectionId: string,
    placement: Extract<PrototypeAction, { kind: 'openOverlay' }>['placement']
  ): void {
    updateConnection(connectionId, (connection) =>
      connection.action.kind === 'openOverlay'
        ? { ...connection, action: { ...connection.action, placement } }
        : connection
    )
  }

  function updateDismissOnOutside(connectionId: string, dismissOnOutside: boolean): void {
    updateConnection(connectionId, (connection) =>
      connection.action.kind === 'openOverlay'
        ? { ...connection, action: { ...connection.action, dismissOnOutside } }
        : connection
    )
  }

  function updateTransition(connectionId: string, kind: PrototypeTransitionKind): void {
    updateConnection(connectionId, (connection) => ({
      ...connection,
      transition: transition(kind)
    }))
  }

  function updateDuration(connectionId: string, durationMs: number): void {
    updateConnection(connectionId, (connection) =>
      connection.transition.kind === 'instant'
        ? connection
        : { ...connection, transition: { ...connection.transition, durationMs } }
    )
  }

  function updateEasing(connectionId: string, easing: MotionEasingName): void {
    updateConnection(connectionId, (connection) =>
      connection.transition.kind === 'instant'
        ? connection
        : { ...connection, transition: { ...connection.transition, easing } }
    )
  }

  function updateDirection(connectionId: string, direction: PrototypeTransitionDirection): void {
    updateConnection(connectionId, (connection) => {
      const current = connection.transition
      return current.kind === 'slide' || current.kind === 'push'
        ? { ...connection, transition: { ...current, direction } }
        : connection
    })
  }

  function updateSmartMatchFallback(
    connectionId: string,
    fallback: Extract<PrototypeTransition, { kind: 'smartMatch' }>['fallback']
  ): void {
    updateConnection(connectionId, (connection) =>
      connection.transition.kind === 'smartMatch'
        ? { ...connection, transition: { ...connection.transition, fallback } }
        : connection
    )
  }

  function updateInterruption(
    connectionId: string,
    interruption: NonNullable<PrototypeConnection['interruption']>
  ): void {
    updateConnection(connectionId, (connection) => ({ ...connection, interruption }))
  }

  function updatePlayback(
    connectionId: string,
    playback: NonNullable<PrototypeConnection['playback']>
  ): void {
    updateConnection(connectionId, (connection) => ({ ...connection, playback }))
  }

  function commitTransitionKey(): void {
    const node = selectedNode.value
    if (!node) return
    run(() => {
      const key = updateNodeTransitionKeyWithUndo(
        store,
        node.id,
        transitionKeyDraft.value,
        panels.value.motionUpdate
      )
      transitionKeyDraft.value = key ?? ''
    })
  }

  function resetTransitionKey(): void {
    transitionKeyDraft.value = selectedTransitionKey.value ?? ''
    errorMessage.value = null
  }

  return {
    panels,
    selectedNode,
    canAuthor,
    connections,
    targets,
    errorMessage,
    transitionKeyDraft,
    addConnection,
    updateConnection,
    removeConnection,
    updateTrigger,
    updateDelay,
    updateAction,
    updateTarget,
    updateOverlayPlacement,
    updateDismissOnOutside,
    updateTransition,
    updateDuration,
    updateEasing,
    updateDirection,
    updateSmartMatchFallback,
    updateInterruption,
    updatePlayback,
    commitTransitionKey,
    resetTransitionKey
  }
}
