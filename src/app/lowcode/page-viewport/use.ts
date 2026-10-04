import { computed, type Ref } from 'vue'

import { validateLowcodePageViewport } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import { useI18n, useRetainedActivity, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useModuleValueSession } from '@/app/lowcode/value-controls/form/session'

import {
  currentPageViewportOwner,
  isPageViewportRawEntry,
  pageViewportIsEditable,
  setPageViewportMode,
  type PageViewportEditor
} from './mutation'

/** Each rendered select retains its own page/configuration/activation authority. */
export function usePageViewportSelection(
  editor: PageViewportEditor,
  owner: Readonly<Ref<SceneNode | undefined>>,
  source: Readonly<Ref<unknown>>,
  active: Readonly<Ref<boolean>> | undefined,
  label: () => string
) {
  const session = useModuleValueSession(
    () => owner.value,
    () => source.value,
    active
  )
  return computed(() => {
    const version = session.version.value
    const page = owner.value
    const value = validateLowcodePageViewport(page?.lowcodePageViewport)
    const invalid =
      !!page &&
      ((page.lowcodePageViewport !== undefined && !value.ok) ||
        page.pluginData.some(isPageViewportRawEntry))
    return {
      version,
      mode: value.ok ? value.value.mode : 'fixed',
      invalid,
      disabled: !page || active?.value === false || !pageViewportIsEditable(editor.graph, page),
      select(mode: unknown) {
        const request = session.request(version)
        if (request?.owner) setPageViewportMode(editor, request.owner, mode, label())
      }
    }
  })
}

export function usePageViewport() {
  const editor = useEditorStore()
  const { panels } = useI18n()
  const owner = useSceneComputed(() => currentPageViewportOwner(editor))
  const source = useSceneComputed(() => ({
    config: owner.value?.lowcodePageViewport,
    raw: owner.value?.pluginData.filter(isPageViewportRawEntry),
    locked: owner.value?.locked,
    internalOnly: owner.value?.internalOnly,
    librarySource: owner.value?.librarySource
  }))
  const selection = usePageViewportSelection(
    editor,
    owner,
    source,
    useRetainedActivity(),
    () => panels.value.lowcodePageViewport
  )
  const options = computed(() => [
    { value: 'responsive', label: panels.value.lowcodePageViewportResponsive },
    { value: 'fit-width', label: panels.value.lowcodePageViewportFitWidth },
    { value: 'fixed', label: panels.value.lowcodePageViewportFixed }
  ])
  const hint = computed(() => {
    if (selection.value.invalid) return panels.value.lowcodePageViewportInvalid
    if (selection.value.mode === 'responsive') return panels.value.lowcodePageViewportResponsiveHint
    if (selection.value.mode === 'fit-width') return panels.value.lowcodePageViewportFitWidthHint
    return panels.value.lowcodePageViewportFixedHint
  })
  return { selection, options, hint, panels }
}
