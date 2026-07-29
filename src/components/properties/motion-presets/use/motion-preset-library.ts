import { computed, ref } from 'vue'

import {
  createMotionPreset,
  isMotionPresetId,
  parseSharedMotionPresetManifestJson,
  type MotionPresetId,
  type MotionSpec,
  type MotionStaggerOptions
} from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  appMotionPresetLibrary,
  appMotionPresetLibrarySnapshot,
  builtinMotionPresetKey,
  chooseTauriMotionPresetLibraryFile,
  isSharedMotionPresetKey,
  isUserMotionPresetKey,
  motionSharedPresetIdsFromKey,
  motionPresetLibraryItems,
  motionUserPresetIdFromKey,
  readBrowserMotionPresetLibraryFile,
  readSharedMotionPresetManifestSource,
  saveMotionPresetLibraryFile,
  userMotionPresetKey,
  type MotionPresetLibraryItem,
  type MotionPresetLibraryKey,
  type MotionPresetEditorValue,
  type MotionPresetStaggerOptions
} from '@/app/motion-presets'
import {
  applyMotionSpec,
  buildMotionApplications,
  readMotionSelection
} from '@/app/properties/motion'
import { motionNodeAuthoringCapabilityReason } from '@/app/properties/motion/v2-capabilities'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function enabledStagger(options: MotionPresetStaggerOptions): MotionStaggerOptions | undefined {
  return options.enabled
    ? { stepMs: options.stepMs, direction: options.direction, rhythm: options.rhythm }
    : undefined
}

function matchingSharedPresetKey(motion: MotionSpec): MotionPresetLibraryKey | undefined {
  const id = motion.preset?.id
  const libraryId = motion.preset?.parameters.libraryId
  if (!id || typeof libraryId !== 'string') return undefined
  const shared = appMotionPresetLibrarySnapshot.value.sharedLibraries.find(
    (candidate) => candidate.manifest.library.id === libraryId
  )
  const preset = shared?.manifest.presets.find((candidate) => candidate.id === id)
  if (!shared || !preset || preset.revision !== motion.preset?.version) return undefined
  const instantiated = appMotionPresetLibrary.instantiateSharedPreset(libraryId, id)
  return JSON.stringify(instantiated) === JSON.stringify(motion)
    ? `shared:${libraryId}:${id}`
    : undefined
}

function matchingUserPresetKey(motion: MotionSpec): MotionPresetLibraryKey | undefined {
  const id = motion.preset?.id
  if (!id?.startsWith('user-')) return undefined
  const preset = appMotionPresetLibrarySnapshot.value.library.presets.find(
    (candidate) => candidate.id === id
  )
  if (!preset || preset.revision !== motion.preset?.version) return undefined
  return JSON.stringify(appMotionPresetLibrary.instantiatePreset(id)) === JSON.stringify(motion)
    ? userMotionPresetKey(id)
    : undefined
}

export function useMotionPresetLibrary() {
  const store = useEditorStore()
  const { selectedIds } = useSelectionState()
  const { panels } = useI18n()
  const error = ref('')
  const exportJson = ref('')
  const staggerEnabled = ref(false)
  const staggerStepMs = ref(80)
  const staggerDirection = ref<MotionPresetStaggerOptions['direction']>('forward')
  const staggerRhythm = ref<MotionPresetStaggerOptions['rhythm']>('linear')
  const sharedBusyId = ref('')

  const selectedIdList = computed(() => [...selectedIds.value])
  const selectedNodes = useSceneComputed(() =>
    selectedIdList.value.flatMap((id) => {
      const node = store.graph.getNode(id)
      return node ? [node] : []
    })
  )
  const selection = computed(() => readMotionSelection(selectedNodes.value))
  const labels = computed<Record<MotionPresetId, string>>(() => ({
    'fade-in': panels.value.motionPresetFadeIn,
    'slide-up': panels.value.motionPresetSlideUp,
    'scale-in': panels.value.motionPresetScaleIn,
    'bounce-in': panels.value.motionPresetBounceIn,
    'hover-lift': panels.value.motionPresetHoverLift,
    press: panels.value.motionPresetPress,
    pulse: panels.value.motionPresetPulse,
    float: panels.value.motionPresetFloat
  }))

  const items = computed(() =>
    motionPresetLibraryItems(
      appMotionPresetLibrarySnapshot.value.library,
      appMotionPresetLibrarySnapshot.value.sharedLibraries
    ).map((item) => {
      if (!item.key.startsWith('builtin:')) return item
      const id = item.key.slice('builtin:'.length)
      return isMotionPresetId(id) ? { ...item, name: labels.value[id] } : item
    })
  )
  const favorites = computed(() => appMotionPresetLibrarySnapshot.value.favorites)
  const sharedLibraries = computed(() => appMotionPresetLibrarySnapshot.value.sharedLibraries)
  const errorMessage = computed(
    () => error.value || appMotionPresetLibrarySnapshot.value.error?.message || ''
  )
  const authoringCapabilityReason = computed(() => {
    for (const node of selectedNodes.value) {
      const reason = motionNodeAuthoringCapabilityReason(node)
      if (reason) return reason
    }
    return null
  })
  const authoringDisabled = computed(() => authoringCapabilityReason.value !== null)
  const authoringDisabledReason = computed(() =>
    authoringCapabilityReason.value === 'booleanResult'
      ? panels.value.motionRequiresResolvedBooleanGeometry
      : ''
  )
  const canSaveCurrent = computed(
    () =>
      !authoringDisabled.value &&
      selection.value.allHaveMotion &&
      !selection.value.mixed &&
      selectedNodes.value.length > 0 &&
      selectedNodes.value[0]?.motion !== undefined
  )
  const selectedKey = computed<MotionPresetLibraryKey | undefined>(() => {
    const builtin = selection.value.presetId
    if (isMotionPresetId(builtin)) return builtinMotionPresetKey(builtin)
    if (selection.value.mixed || builtin !== 'custom') return undefined
    const motion = selectedNodes.value[0]?.motion
    if (!motion) return undefined
    return matchingSharedPresetKey(motion) ?? matchingUserPresetKey(motion)
  })

  function clearError() {
    error.value = ''
  }

  function reportError(cause: unknown) {
    error.value = message(cause)
  }

  function motionFor(item: MotionPresetLibraryItem) {
    if (item.key.startsWith('builtin:')) {
      const id = item.key.slice('builtin:'.length)
      if (!isMotionPresetId(id)) throw new Error(`Unknown motion preset: ${id}`)
      return createMotionPreset(id)
    }
    if (isSharedMotionPresetKey(item.key)) {
      const { libraryId, presetId } = motionSharedPresetIdsFromKey(item.key)
      return appMotionPresetLibrary.instantiateSharedPreset(libraryId, presetId)
    }
    if (!isUserMotionPresetKey(item.key)) throw new Error(`Unknown motion preset: ${item.key}`)
    return appMotionPresetLibrary.instantiatePreset(motionUserPresetIdFromKey(item.key))
  }

  function stopPreview() {
    store.stopMotionPreview()
  }

  function apply(item: MotionPresetLibraryItem, stagger: MotionPresetStaggerOptions) {
    stopPreview()
    if (authoringDisabled.value) {
      reportError(authoringDisabledReason.value)
      return
    }
    try {
      applyMotionSpec(
        store,
        selectedIdList.value,
        motionFor(item),
        panels.value.motionApplyPreset,
        enabledStagger(stagger)
      )
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  function preview(item: MotionPresetLibraryItem, stagger: MotionPresetStaggerOptions) {
    stopPreview()
    if (authoringDisabled.value) {
      reportError(authoringDisabledReason.value)
      return
    }
    try {
      const applications = buildMotionApplications(
        store,
        selectedIdList.value,
        motionFor(item),
        enabledStagger(stagger)
      )
      store.previewMotionSpecs(
        applications.map(({ nodeId, motion }) => ({ nodeId, spec: motion })),
        { selection: { mode: 'all' }, infiniteAsSingleCycle: true, holdFinalFrame: true }
      )
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  function toggleFavorite(item: MotionPresetLibraryItem) {
    if (item.source === 'shared') return
    try {
      appMotionPresetLibrary.toggleFavorite(item.key)
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  function saveCurrent(value: MotionPresetEditorValue, finish: (error?: string) => void) {
    const motion = selectedNodes.value[0]?.motion
    if (!motion || !canSaveCurrent.value) {
      finish(panels.value.motionNoneHint)
      return
    }
    try {
      appMotionPresetLibrary.createPreset({ ...value, motion })
      clearError()
      finish()
    } catch (cause) {
      reportError(cause)
      finish(message(cause))
    }
  }

  function edit(
    item: MotionPresetLibraryItem,
    value: MotionPresetEditorValue,
    finish: (error?: string) => void
  ) {
    if (!isUserMotionPresetKey(item.key)) {
      finish(panels.value.motionCustom)
      return
    }
    try {
      appMotionPresetLibrary.editPreset(motionUserPresetIdFromKey(item.key), value)
      clearError()
      finish()
    } catch (cause) {
      reportError(cause)
      finish(message(cause))
    }
  }

  function updateFromCurrent(item: MotionPresetLibraryItem) {
    const motion = selectedNodes.value[0]?.motion
    if (!motion || !canSaveCurrent.value || !isUserMotionPresetKey(item.key)) return
    try {
      appMotionPresetLibrary.updatePreset(motionUserPresetIdFromKey(item.key), { motion })
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  function remove(item: MotionPresetLibraryItem) {
    if (!isUserMotionPresetKey(item.key)) return
    try {
      appMotionPresetLibrary.deletePreset(motionUserPresetIdFromKey(item.key))
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  function importJson(
    json: string,
    policy: Parameters<typeof appMotionPresetLibrary.importJson>[1]
  ) {
    try {
      appMotionPresetLibrary.importJson(json, policy)
      exportJson.value = ''
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  function exportLibraryJson() {
    try {
      exportJson.value = appMotionPresetLibrary.exportJson()
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  async function importFile(
    file: File | undefined,
    policy: Parameters<typeof appMotionPresetLibrary.importJson>[1]
  ) {
    try {
      const json = file
        ? await readBrowserMotionPresetLibraryFile(file)
        : await chooseTauriMotionPresetLibraryFile()
      if (json === null) return
      appMotionPresetLibrary.importJson(json, policy)
      exportJson.value = ''
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  async function exportFile() {
    try {
      await saveMotionPresetLibraryFile(appMotionPresetLibrary.exportJson())
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  async function withSharedSource(
    libraryId: string,
    action: (manifest: Awaited<ReturnType<typeof readSharedMotionPresetManifestSource>>) => void
  ) {
    const shared = appMotionPresetLibrarySnapshot.value.sharedLibraries.find(
      (candidate) => candidate.manifest.library.id === libraryId
    )
    if (!shared) return reportError(`Unknown shared motion preset library: ${libraryId}`)
    sharedBusyId.value = libraryId
    try {
      const manifest = await readSharedMotionPresetManifestSource(shared.manifest.source)
      action(manifest)
      clearError()
    } catch (cause) {
      reportError(cause)
    } finally {
      sharedBusyId.value = ''
    }
  }

  function acceptSharedJson(json: string) {
    try {
      appMotionPresetLibrary.acceptSharedLibrary(parseSharedMotionPresetManifestJson(json))
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  function checkSharedLibrary(libraryId: string) {
    return withSharedSource(libraryId, (manifest) => {
      appMotionPresetLibrary.checkSharedLibrary(manifest)
    })
  }

  function acceptSharedUpdate(libraryId: string) {
    return withSharedSource(libraryId, (manifest) => {
      appMotionPresetLibrary.acceptSharedLibrary(manifest)
    })
  }

  function removeSharedLibrary(libraryId: string) {
    try {
      appMotionPresetLibrary.removeSharedLibrary(libraryId)
      clearError()
    } catch (cause) {
      reportError(cause)
    }
  }

  return {
    selection,
    selectedIdList,
    items,
    favorites,
    sharedLibraries,
    sharedBusyId,
    errorMessage,
    authoringDisabled,
    authoringDisabledReason,
    exportJson,
    canSaveCurrent,
    selectedKey,
    staggerEnabled,
    staggerStepMs,
    staggerDirection,
    staggerRhythm,
    apply,
    preview,
    stopPreview,
    toggleFavorite,
    saveCurrent,
    edit,
    updateFromCurrent,
    remove,
    importJson,
    exportLibraryJson,
    importFile,
    exportFile,
    acceptSharedJson,
    checkSharedLibrary,
    acceptSharedUpdate,
    removeSharedLibrary
  }
}
