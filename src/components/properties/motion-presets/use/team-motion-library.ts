import { computed, ref } from 'vue'

import type { TeamMotionLibraryEntry } from '@open-pencil/scene-graph'
import { useI18n, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  appTeamMotionLibrary,
  appTeamMotionLibrarySnapshot,
  type StoredTeamMotionLibrary
} from '@/app/motion-presets'
import { applyMotionApplications, applyMotionSpec } from '@/app/properties/motion'

export interface TeamMotionEntryItem {
  readonly libraryId: string
  readonly entryId: string
  readonly entry: TeamMotionLibraryEntry
}

function entryId(entry: TeamMotionLibraryEntry): string {
  return entry.kind === 'preset' ? entry.preset.id : entry.recipe.id
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function roleMapping(entry: Extract<TeamMotionLibraryEntry, { kind: 'recipe' }>, ids: string[]) {
  const roles = entry.recipe.roles.map((role) => role.id)
  if (roles.length === 1) return { [roles[0]]: ids }
  if (roles.length === ids.length) {
    return Object.fromEntries(roles.map((role, index) => [role, [ids[index]]]))
  }
  throw new Error(
    `Recipe ${entry.recipe.name} needs ${roles.length} role selections; selected ${ids.length}.`
  )
}

export function useTeamMotionLibrary() {
  const editor = useEditorStore()
  const { selectedIds } = useSelectionState()
  const { panels } = useI18n()
  const manifestJSON = ref('')
  const publicKeyPem = ref('')
  const busyId = ref('')
  const localError = ref('')

  const libraries = computed(() => appTeamMotionLibrarySnapshot.value.libraries)
  const errorMessage = computed(
    () => localError.value || appTeamMotionLibrarySnapshot.value.error?.message || ''
  )
  const disabled = computed(
    () => appTeamMotionLibrarySnapshot.value.blocked || !appTeamMotionLibrarySnapshot.value.ready
  )
  const items = computed<TeamMotionEntryItem[]>(() =>
    libraries.value.flatMap(({ registry }) => {
      const libraryId = registry.accepted.manifest.library.id
      return registry.accepted.manifest.entries.map((entry) => ({
        libraryId,
        entryId: entryId(entry),
        entry
      }))
    })
  )

  async function run(id: string, task: () => Promise<unknown>): Promise<void> {
    if (busyId.value) {
      localError.value = 'Another team Motion library operation is already in progress.'
      return
    }
    busyId.value = id
    try {
      await task()
      localError.value = ''
    } catch (cause) {
      localError.value = message(cause)
    } finally {
      busyId.value = ''
    }
  }

  async function stageManifest(): Promise<void> {
    const manifest = manifestJSON.value.trim()
    const key = publicKeyPem.value.trim()
    if (!manifest || !key) return
    await run('import', async () => {
      await appTeamMotionLibrary.stageManifest(manifest, key)
      manifestJSON.value = ''
      publicKeyPem.value = ''
    })
  }

  function selectedIdList(): string[] {
    if (disabled.value) {
      throw new Error('Team Motion libraries are unavailable until verification succeeds.')
    }
    const ids = [...selectedIds.value]
    if (ids.length === 0) throw new Error(panels.value.motionNoneHint)
    return ids
  }

  function instantiate(item: TeamMotionEntryItem, tokens: Record<string, number>) {
    const ids = selectedIdList()
    return appTeamMotionLibrary.instantiate(item.libraryId, item.entryId, {
      tokens,
      ...(item.entry.kind === 'recipe' ? { roleMapping: roleMapping(item.entry, ids) } : {})
    })
  }

  function apply(item: TeamMotionEntryItem, tokens: Record<string, number>): void {
    try {
      const ids = selectedIdList()
      const result = instantiate(item, tokens)
      editor.stopMotionPreview()
      if (result.kind === 'preset') {
        applyMotionSpec(editor, ids, result.motion, panels.value.motionApplyPreset)
      } else {
        applyMotionApplications(editor, result.result.assignments, panels.value.motionApplyPreset)
      }
      localError.value = ''
    } catch (cause) {
      localError.value = message(cause)
    }
  }

  function preview(item: TeamMotionEntryItem, tokens: Record<string, number>): void {
    try {
      const ids = selectedIdList()
      const result = instantiate(item, tokens)
      const applications =
        result.kind === 'preset'
          ? ids.map((nodeId) => ({ nodeId, spec: result.motion }))
          : result.result.assignments.map(({ nodeId, motion }) => ({ nodeId, spec: motion }))
      editor.stopMotionPreview()
      editor.previewMotionSpecs(applications, {
        selection: { mode: 'all' },
        infiniteAsSingleCycle: true,
        holdFinalFrame: true
      })
      localError.value = ''
    } catch (cause) {
      localError.value = message(cause)
    }
  }

  function library(id: string): StoredTeamMotionLibrary | undefined {
    return libraries.value.find(
      (candidate) => candidate.registry.accepted.manifest.library.id === id
    )
  }

  return {
    manifestJSON,
    publicKeyPem,
    busyId,
    libraries,
    items,
    errorMessage,
    disabled,
    stageManifest,
    check: (id: string) => run(id, () => appTeamMotionLibrary.checkSource(id)),
    accept: (id: string) => run(id, () => appTeamMotionLibrary.accept(id)),
    reject: (id: string) => run(id, () => appTeamMotionLibrary.reject(id)),
    rollbackLatest: (id: string) => {
      const digest = library(id)?.registry.history[0]?.verifiedDigest
      return digest ? run(id, () => appTeamMotionLibrary.rollback(id, digest)) : Promise.resolve()
    },
    remove: (id: string) => run(id, async () => appTeamMotionLibrary.remove(id)),
    apply,
    preview,
    stopPreview: () => editor.stopMotionPreview()
  }
}
