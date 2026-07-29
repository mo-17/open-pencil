import { computed, onBeforeUnmount, ref, watch } from 'vue'

import {
  motionDriverDocumentStates,
  motionDriverPageStates,
  motionDriverVariables
} from '@open-pencil/core/motion'
import {
  MOTION_DRIVER_LIMITS,
  type MotionDriver,
  type MotionDriverSource,
  type MotionDriverSpecV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import { useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  collectMotionDriverNodes,
  collectMotionDriverTracks,
  createMotionDriver,
  isMotionDriverOwner,
  nextMotionDriverId,
  parseMotionDriverTrackKey,
  removeMotionDriver,
  replaceMotionDriver,
  updateMotionDriversWithUndo
} from '@/app/properties/motion/drivers'

export const MOTION_DRIVER_SOURCE_KINDS = [
  'scroll',
  'pointer',
  'drag',
  'visibility',
  'pageState',
  'documentState',
  'variable'
] as const satisfies readonly MotionDriverSource['kind'][]

type MotionDriverSourceKind = (typeof MOTION_DRIVER_SOURCE_KINDS)[number]
type MotionDriverAxis = Extract<MotionDriverSource, { axis: unknown }>['axis']

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function sourceForKind(
  kind: MotionDriverSourceKind,
  fallbackNodeId: string,
  fallbackVariableId: string,
  fallbackPageStateId: string,
  fallbackDocumentStateId: string
): MotionDriverSource {
  switch (kind) {
    case 'scroll':
      return { kind, axis: 'y', metric: 'progress' }
    case 'pointer':
      return { kind, axis: 'x', space: 'local' }
    case 'drag':
      return { kind, handleNodeId: fallbackNodeId, axis: 'x', distance: 100 }
    case 'visibility':
      return { kind, sourceNodeId: fallbackNodeId }
    case 'pageState':
      return { kind, stateId: fallbackPageStateId || 'state-id' }
    case 'documentState':
      return { kind, stateId: fallbackDocumentStateId || 'state-id' }
    case 'variable':
      return { kind, variableId: fallbackVariableId || 'variable-id' }
  }
  const unsupportedKind: never = kind
  throw new RangeError(`Unsupported Motion driver source kind: ${String(unsupportedKind)}`)
}

/** Structured continuous-driver authoring with one complete validated owner snapshot per edit. */
export function useMotionDrivers() {
  const store = useEditorStore()
  const { selectedIds } = useSelectionState()
  const selectedDriverId = ref('')
  const previewProgress = ref(0)
  const previewingDriverId = ref('')
  const localError = ref('')

  const owner = computed<SceneNode | undefined>(() => {
    void store.state.sceneVersion
    const ids = [...selectedIds.value]
    if (ids.length > 1) return undefined
    const selected = ids.length === 1 ? store.graph.getNode(ids[0]) : undefined
    if (isMotionDriverOwner(selected)) return selected
    const page = store.graph.getNode(store.state.currentPageId)
    return isMotionDriverOwner(page) ? page : undefined
  })
  const spec = computed(() => {
    void store.state.sceneVersion
    const ownerId = owner.value?.id
    return ownerId ? store.graph.getNode(ownerId)?.motionDrivers : undefined
  })
  const drivers = computed(() => spec.value?.drivers ?? [])
  const selectedDriver = computed(() =>
    drivers.value.find(({ id }) => id === selectedDriverId.value)
  )
  const nodes = computed(() => {
    void store.state.sceneVersion
    return owner.value ? collectMotionDriverNodes(store.graph, owner.value.id) : []
  })
  const tracks = computed(() => {
    void store.state.sceneVersion
    return owner.value ? collectMotionDriverTracks(store.graph, owner.value.id) : []
  })
  const pageStates = computed(() => {
    void store.state.sceneVersion
    return owner.value ? motionDriverPageStates(store.graph, owner.value) : []
  })
  const documentStates = computed(() => {
    void store.state.sceneVersion
    return motionDriverDocumentStates(store.graph)
  })
  const variables = computed(() => {
    void store.state.sceneVersion
    return motionDriverVariables(store.graph).map((variable) => ({
      id: variable.id,
      name: variable.name
    }))
  })
  const canAdd = computed(
    () =>
      Boolean(owner.value) &&
      tracks.value.length > 0 &&
      drivers.value.length < MOTION_DRIVER_LIMITS.maxDrivers
  )

  watch(
    () => `${owner.value?.id ?? ''}\u0000${drivers.value.map(({ id }) => id).join('\u0000')}`,
    () => {
      if (!drivers.value.some(({ id }) => id === selectedDriverId.value)) {
        selectedDriverId.value = drivers.value[0]?.id ?? ''
      }
      localError.value = ''
    },
    { immediate: true }
  )

  function commit(next: MotionDriverSpecV1 | undefined, coalesceKey?: string): boolean {
    const currentOwner = owner.value
    if (!currentOwner) return false
    try {
      const changed = updateMotionDriversWithUndo(
        store,
        currentOwner.id,
        next,
        'Update continuous Motion drivers',
        coalesceKey
      )
      localError.value = ''
      return changed
    } catch (cause) {
      localError.value = errorMessage(cause)
      return false
    }
  }

  function addDriver(): void {
    const currentOwner = owner.value
    const target = tracks.value.at(0)
    if (!currentOwner || !target || !canAdd.value) return
    const current = spec.value
    const driver = createMotionDriver(
      nextMotionDriverId(current),
      { kind: 'scroll', axis: 'y', metric: 'progress' },
      { targetNodeId: target.nodeId, trackId: target.trackId }
    )
    const next: MotionDriverSpecV1 = {
      version: 1,
      drivers: [...(current?.drivers ?? []), driver]
    }
    if (commit(next)) selectedDriverId.value = driver.id
  }

  function editSelected(edit: (driver: MotionDriver) => MotionDriver, coalesceKey?: string): void {
    const current = spec.value
    const selected = selectedDriver.value
    if (!current || !selected) return
    try {
      const next = replaceMotionDriver(current, selected.id, edit(structuredClone(selected)))
      commit(next, coalesceKey)
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  function deleteSelected(): void {
    const current = spec.value
    const selected = selectedDriver.value
    if (!current || !selected) return
    try {
      const next = removeMotionDriver(current, selected.id)
      if (commit(next)) {
        stopPreview()
        selectedDriverId.value = next?.drivers[0]?.id ?? ''
      }
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  function setSourceKind(kind: MotionDriverSourceKind): void {
    const fallbackNodeId = nodes.value.at(0)?.id ?? owner.value?.id ?? ''
    const fallbackVariableId = variables.value[0]?.id ?? ''
    const fallbackPageStateId = pageStates.value[0]?.id ?? ''
    const fallbackDocumentStateId = documentStates.value[0]?.id ?? ''
    editSelected((driver) =>
      createMotionDriver(
        driver.id,
        sourceForKind(
          kind,
          fallbackNodeId,
          fallbackVariableId,
          fallbackPageStateId,
          fallbackDocumentStateId
        ),
        driver.target
      )
    )
  }

  function editSource(edit: (source: MotionDriverSource) => MotionDriverSource): void {
    editSelected((driver) => ({ ...driver, source: edit(driver.source) }))
  }

  function setOptionalSourceNodeId(sourceNodeId: string): void {
    editSource((source) => {
      if (source.kind !== 'scroll' && source.kind !== 'pointer') return source
      return sourceNodeId ? { ...source, sourceNodeId } : withoutSourceNodeId(source)
    })
  }

  function setRequiredSourceNodeId(sourceNodeId: string): void {
    editSource((source) => {
      if (source.kind === 'drag') return { ...source, handleNodeId: sourceNodeId }
      if (source.kind === 'visibility') return { ...source, sourceNodeId }
      return source
    })
  }

  function setAxis(axis: MotionDriverAxis): void {
    editSource((source) => ('axis' in source ? { ...source, axis } : source))
  }

  function setScrollMetric(metric: 'progress' | 'offset'): void {
    editSelected((driver) => {
      if (driver.source.kind !== 'scroll') return driver
      const defaults = createMotionDriver(driver.id, { ...driver.source, metric }, driver.target)
      return { ...driver, source: defaults.source, mapping: defaults.mapping }
    })
  }

  function setPointerSpace(space: 'local' | 'viewport'): void {
    editSource((source) => (source.kind === 'pointer' ? { ...source, space } : source))
  }

  function setDragDistance(distance: number): void {
    editSource((source) => (source.kind === 'drag' ? { ...source, distance } : source))
  }

  function setStateId(stateId: string): void {
    editSource((source) =>
      source.kind === 'pageState' || source.kind === 'documentState'
        ? { ...source, stateId }
        : source
    )
  }

  function setVariableId(variableId: string): void {
    editSource((source) => (source.kind === 'variable' ? { ...source, variableId } : source))
  }

  function setTargetTrack(key: string): void {
    const { nodeId, trackId } = parseMotionDriverTrackKey(key)
    editSelected((driver) => ({ ...driver, target: { targetNodeId: nodeId, trackId } }))
  }

  function setMapping(
    key: keyof MotionDriver['mapping'],
    value: number | boolean,
    coalesce = false
  ): void {
    editSelected(
      (driver) => ({ ...driver, mapping: { ...driver.mapping, [key]: value } }),
      coalesce ? `motion-driver-${selectedDriverId.value}-${key}` : undefined
    )
  }

  function preview(progress = previewProgress.value): void {
    const driver = selectedDriver.value
    if (!driver) return
    const target = store.graph.getNode(driver.target.targetNodeId)
    const track = target?.motion?.tracks.find(({ id }) => id === driver.target.trackId)
    if (!target || !track) return
    const normalized = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
    previewProgress.value = normalized
    store.seekMotionPreview([target.id], track.trigger, normalized * track.timing.durationMs, {
      trackId: track.id,
      infiniteAsSingleCycle: true,
      holdFinalFrame: true
    })
    previewingDriverId.value = driver.id
  }

  function stopPreview(): void {
    if (!previewingDriverId.value) return
    store.stopMotionPreview()
    previewingDriverId.value = ''
  }

  onBeforeUnmount(stopPreview)

  return {
    owner,
    drivers,
    selectedDriverId,
    selectedDriver,
    nodes,
    tracks,
    pageStates,
    documentStates,
    variables,
    canAdd,
    localError,
    previewProgress,
    previewingDriverId,
    addDriver,
    deleteSelected,
    setSourceKind,
    setOptionalSourceNodeId,
    setRequiredSourceNodeId,
    setAxis,
    setScrollMetric,
    setPointerSpace,
    setDragDistance,
    setStateId,
    setVariableId,
    setTargetTrack,
    setMapping,
    preview,
    stopPreview
  }
}

function withoutSourceNodeId(
  source: Extract<MotionDriverSource, { kind: 'scroll' | 'pointer' }>
): Extract<MotionDriverSource, { kind: 'scroll' | 'pointer' }> {
  const { sourceNodeId: omitted, ...rest } = source
  void omitted
  return rest
}
