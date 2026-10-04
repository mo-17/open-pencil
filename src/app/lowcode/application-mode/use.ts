import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'

import {
  lowcodeApplicationShellSlotEligible,
  validateLowcodeApplicationGuardMessage
} from '@open-pencil/lowcode'
import { usePageMessages, useRetainedActivity } from '@open-pencil/vue'

import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'

import { useApplicationGuardDraft } from './guards/draft'
import { applicationGuardFallbackValid } from './guards/model'
import { setApplicationPageGuard } from './guards/mutation'
import type { ApplicationGuardKind, ApplicationGuardSource } from './guards/types'
import { readApplicationMode } from './model'
import {
  setApplicationEnabled,
  setApplicationEntry,
  setApplicationRole,
  setApplicationRoute,
  setApplicationStart,
  setApplicationStateRetention
} from './mutation'
import { useApplicationShellDraft } from './shell/draft'
import { applicationShellSlotOptions, readApplicationShell } from './shell/model'
import { setApplicationShell } from './shell/mutation'
import type { ApplicationShellSource } from './shell/types'
import type { ApplicationModeEditor, ApplicationModePanelModel } from './types'

/** Any lifecycle or scene change permanently retires the previous rendered callbacks. */
export function useApplicationModeModel(
  getEditor: () => ApplicationModeEditor | undefined,
  active?: Readonly<Ref<boolean>>,
  label: () => string = () => 'Application pages'
) {
  const version = shallowRef(0)
  let disposed = false
  let unbind: Array<() => void> = []
  const retire = () => {
    version.value++
  }
  const stopEditor = watch(
    getEditor,
    (editor) => {
      for (const stop of unbind) stop()
      unbind = []
      retire()
      if (!editor) return
      const events = [
        'graph:replaced',
        'page:changed',
        'node:created',
        'node:updated',
        'node:deleted',
        'node:reparented',
        'node:reordered'
      ] as const
      unbind = events.map((event) => editor.onEditorEvent(event, retire))
    },
    { immediate: true, flush: 'sync' }
  )
  if (active) watch(active, retire, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    stopEditor()
    for (const stop of unbind) stop()
  })
  const context = computed(() => {
    const capturedVersion = version.value
    const editor = getEditor()
    const graph = editor?.graph
    const page = graph?.getNode(editor?.state.currentPageId ?? '')
    const view = readApplicationMode(editor)
    const inactive = active?.value === false
    function apply(action: (owner: ApplicationModeEditor) => boolean): boolean {
      if (!editor) return false
      if (disposed || active?.value === false || capturedVersion !== version.value) return false
      if (getEditor() !== editor) return false
      if (editor.graph !== graph) return false
      if (editor.graph.getNode(editor.state.currentPageId) !== page) return false
      return action(editor)
    }
    return { capturedVersion, editor, graph, page, view, inactive, apply }
  })
  const shellSource = computed<ApplicationShellSource>(() => {
    const { capturedVersion, editor, graph, inactive, apply } = context.value
    const view = readApplicationShell(editor)
    return {
      ...view,
      version: capturedVersion,
      disabled: view.disabled || inactive,
      getSlots: (frameNodeId) => (graph ? applicationShellSlotOptions(graph, frameNodeId) : []),
      eligible: (frameNodeId, slotNodeId) =>
        !!graph && lowcodeApplicationShellSlotEligible(graph, frameNodeId, slotNodeId),
      commit: (value) => apply((owner) => setApplicationShell(owner, value, label()))
    }
  })
  const shell = useApplicationShellDraft(() => shellSource.value)
  function guardSource(kind: ApplicationGuardKind) {
    return computed<ApplicationGuardSource>(() => {
      const { capturedVersion, editor, page, view, inactive, apply } = context.value
      const enter = view.enterGuard
      const leave = view.leaveConfirm
      return {
        kind,
        version: capturedVersion,
        disabled: view.guardsDisabled || inactive,
        configured: kind === 'enter' ? !!enter : !!leave,
        expression: kind === 'enter' ? (enter?.conditionExpr ?? '') : (leave?.dirtyExpr ?? ''),
        detail: kind === 'enter' ? (enter?.fallback ?? '') : (leave?.message ?? ''),
        detailValid: (value) =>
          kind === 'enter'
            ? applicationGuardFallbackValid(editor, page, value)
            : validateLowcodeApplicationGuardMessage(value),
        commit(value) {
          let next: unknown = undefined
          if (value !== undefined)
            next =
              kind === 'enter'
                ? { conditionExpr: value.expression, fallback: value.detail }
                : { dirtyExpr: value.expression, message: value.detail }
          return apply(
            (owner) => !!page && setApplicationPageGuard(owner, page, kind, next, label())
          )
        }
      }
    })
  }
  const enterSource = guardSource('enter')
  const leaveSource = guardSource('leave')
  const enter = useApplicationGuardDraft(() => enterSource.value)
  const leave = useApplicationGuardDraft(() => leaveSource.value)
  const panel = computed<ApplicationModePanelModel>(() => {
    const { capturedVersion, page, view, inactive, apply } = context.value
    return {
      ...view,
      version: capturedVersion,
      shell: shell.value,
      enter: enter.value,
      leave: leave.value,
      modeDisabled: view.modeDisabled || inactive,
      pageDisabled: view.pageDisabled || inactive,
      entryDisabled: view.entryDisabled || inactive,
      startDisabled: view.startDisabled || inactive,
      routeDisabled: view.routeDisabled || inactive,
      stateRetentionDisabled: view.stateRetentionDisabled || inactive,
      guardsDisabled: view.guardsDisabled || inactive,
      setEnabled(value) {
        return apply((owner) => setApplicationEnabled(owner, value, label()))
      },
      setRole(value) {
        return apply((owner) => !!page && setApplicationRole(owner, page, value, label()))
      },
      setEntry(value) {
        return apply((owner) => !!page && setApplicationEntry(owner, page, value, label()))
      },
      setStart(value) {
        return apply((owner) => setApplicationStart(owner, value, label()))
      },
      setRoute(value) {
        return apply((owner) => !!page && setApplicationRoute(owner, page, value, label()))
      },
      setStateRetention(value) {
        return apply((owner) => !!page && setApplicationStateRetention(owner, page, value, label()))
      }
    }
  })
  return { panel }
}

export function useApplicationMode() {
  const messages = usePageMessages()
  return useApplicationModeModel(
    () => getActiveEditorStoreOrNull() ?? undefined,
    useRetainedActivity(),
    () => messages.value.applicationModeTitle
  )
}
