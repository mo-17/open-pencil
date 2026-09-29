import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { ActionDef, EventName, SceneNode } from '@open-pencil/scene-graph'

import { clearLowcodeActionFocus, peekLowcodeActionFocus } from '../action/focus'
import { editableNodeEvents, eventAtActionPath } from './selection'

/** Owns only inspector selection; authored actions remain on the document. */
export function useLowcodeEventEditor(
  editor: Pick<Editor, 'graph' | 'updateNodeWithUndo'>,
  node: Readonly<Ref<SceneNode | null | undefined>>
) {
  const preferredEvent = ref<EventName | null>(null)
  const generation = ref(0)
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })
  watch(
    [() => editor.graph, () => node.value?.id],
    () => {
      generation.value++
      preferredEvent.value = null
    },
    { flush: 'sync' }
  )
  const availableEvents = computed(() => editableNodeEvents(node.value?.type))
  watch(
    () => peekLowcodeActionFocus(editor.graph, node.value?.id),
    (pending) => {
      const requested = eventAtActionPath(pending?.actionPath)
      if (requested && availableEvents.value.includes(requested)) preferredEvent.value = requested
    },
    { flush: 'sync', immediate: true }
  )
  const eventName = computed<EventName | null>({
    get() {
      const events = availableEvents.value
      const requested = eventAtActionPath(
        peekLowcodeActionFocus(editor.graph, node.value?.id)?.actionPath
      )
      if (requested && events.includes(requested)) {
        return requested
      }
      if (preferredEvent.value && events.includes(preferredEvent.value)) return preferredEvent.value
      return events.find((name) => node.value?.events?.[name]?.length) ?? events.at(0) ?? null
    },
    set(value) {
      if (!value || !availableEvents.value.includes(value)) return
      const pending = peekLowcodeActionFocus(editor.graph, node.value?.id)
      if (pending) clearLowcodeActionFocus(pending)
      preferredEvent.value = value
    }
  })
  watch(eventName, () => generation.value++, { flush: 'sync' })
  // Pin the function to the rendered graph/node/event. A stale child emit must
  // not write its old action array into a newly selected event or document.
  const target = computed(() => {
    const graph = editor.graph
    const id = node.value?.id
    const name = eventName.value
    const version = generation.value
    if (!id || !name) return null
    return {
      key: `${version}:${id}:${name}`,
      commit(next: ActionDef[]): void {
        if (
          disposed ||
          generation.value !== version ||
          editor.graph !== graph ||
          node.value?.id !== id ||
          eventName.value !== name
        )
          return
        const current = graph.getNode(id)
        if (!current || !editableNodeEvents(current.type).includes(name)) return
        preferredEvent.value = name
        const events = { ...current.events }
        if (next.length) events[name] = next
        else Reflect.deleteProperty(events, name)
        editor.updateNodeWithUndo(id, { events }, 'Update events')
      }
    }
  })
  return { availableEvents, eventName, target }
}
