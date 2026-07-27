<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'

import {
  acceptLibraryUpdate,
  type LibraryManifest,
  type SceneGraph
} from '@open-pencil/scene-graph'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { useI18n, useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { getActiveEditorStore, useEditorStore } from '@/app/editor/active-store'
import {
  cloneSceneGraphForLibraryUndo,
  libraryPanelRows,
  parseLibraryManifestText,
  readLibraryGraphFile,
  type LibraryPanelStatus
} from '@/app/lowcode/libraries'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()

const manifest = ref<LibraryManifest | null>(null)
const libraryGraph = shallowRef<SceneGraph | null>(null)
const manifestName = ref('')
const libraryName = ref('')
const manifestError = ref('')
const libraryError = ref('')
const acceptError = ref('')
const acceptMessage = ref('')

const rows = useSceneComputed(() => libraryPanelRows(editor.graph, manifest.value))
const hasLibraries = computed(() => rows.value.length > 0)
const canAccept = computed(() => !!manifest.value && !!libraryGraph.value)

async function loadManifest(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  manifestError.value = ''
  acceptError.value = ''
  acceptMessage.value = ''
  try {
    manifest.value = parseLibraryManifestText(await file.text())
    manifestName.value = file.name
  } catch (error) {
    manifest.value = null
    manifestName.value = ''
    manifestError.value = error instanceof Error ? error.message : String(error)
  }
}

async function loadLibrary(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  libraryError.value = ''
  acceptError.value = ''
  acceptMessage.value = ''
  try {
    libraryGraph.value = await readLibraryGraphFile(file)
    libraryName.value = file.name
  } catch (error) {
    libraryGraph.value = null
    libraryName.value = ''
    libraryError.value = error instanceof Error ? error.message : String(error)
  }
}

function acceptUpdate(componentKey: string): void {
  if (!manifest.value || !libraryGraph.value) return
  acceptError.value = ''
  acceptMessage.value = ''
  const sourceGraph = libraryGraph.value
  const targetGraph = getActiveEditorStore().graph
  const before = cloneSceneGraphForLibraryUndo(targetGraph)
  const result = acceptLibraryUpdate({
    sourceGraph,
    targetGraph,
    manifest: manifest.value,
    componentKey
  })
  if ('error' in result) {
    editor.replaceGraph(before)
    acceptError.value = result.error
    return
  }
  computeAllLayouts(targetGraph, editor.state.currentPageId)
  editor.requestRender()
  const after = cloneSceneGraphForLibraryUndo(targetGraph)
  editor.pushUndoEntry({
    label: 'Accept library update',
    forward: () => {
      editor.replaceGraph(cloneSceneGraphForLibraryUndo(after))
    },
    inverse: () => {
      editor.replaceGraph(cloneSceneGraphForLibraryUndo(before))
    }
  })
  acceptMessage.value =
    result.warnings.length > 0
      ? panels.value.lowcodeLibrariesAcceptedWithWarnings({
          componentKey: result.component.key,
          warnings: result.warnings.join(' ')
        })
      : panels.value.lowcodeLibrariesAccepted({ componentKey: result.component.key })
}

function statusClass(status: LibraryPanelStatus): string {
  switch (status) {
    case 'outdated':
      return 'text-amber-400'
    case 'up-to-date':
      return 'text-emerald-400'
    case 'missing-manifest':
    case 'missing-cached-master':
      return 'text-red-400'
    default:
      return 'text-muted'
  }
}

function statusLabel(status: LibraryPanelStatus): string {
  switch (status) {
    case 'outdated':
      return panels.value.lowcodeLibrariesStatusOutdated
    case 'up-to-date':
      return panels.value.lowcodeLibrariesStatusUpToDate
    case 'missing-manifest':
      return panels.value.lowcodeLibrariesStatusMissingManifest
    case 'missing-cached-master':
      return panels.value.lowcodeLibrariesStatusMissingCachedMaster
    case 'unknown':
      return panels.value.lowcodeLibrariesStatusUnknown
  }
}
</script>

<template>
  <div data-test-id="lowcode-libraries-section" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">{{ panels.lowcodeLibraries }}</label>
      <span class="text-[10px] text-muted">
        {{ panels.lowcodeLibrariesImportCount({ count: String(rows.length) }) }}
      </span>
    </div>

    <p v-if="!hasLibraries" data-test-id="lowcode-libraries-empty" class="text-[11px] text-muted">
      {{ panels.lowcodeLibrariesEmpty }}
    </p>

    <div class="mb-2 grid grid-cols-2 gap-1.5">
      <label
        class="cursor-pointer rounded border border-border px-2 py-1 text-center text-[11px] text-muted hover:bg-hover hover:text-surface"
      >
        {{ panels.lowcodeLibrariesManifest }}
        <input
          type="file"
          accept=".json,application/json"
          class="hidden"
          data-test-id="lowcode-library-manifest-file"
          :aria-label="panels.lowcodeLibrariesManifestFileAria"
          @change="loadManifest"
        />
      </label>
      <label
        class="cursor-pointer rounded border border-border px-2 py-1 text-center text-[11px] text-muted hover:bg-hover hover:text-surface"
      >
        {{ panels.lowcodeLibrariesLibraryFile }}
        <input
          type="file"
          accept=".fig,.pen"
          class="hidden"
          data-test-id="lowcode-library-source-file"
          :aria-label="panels.lowcodeLibrariesLibraryFileAria"
          @change="loadLibrary"
        />
      </label>
    </div>

    <div class="mb-2 flex flex-col gap-0.5 text-[10px] text-muted">
      <p v-if="manifestName" data-test-id="lowcode-library-manifest-name" class="truncate">
        {{ panels.lowcodeLibrariesManifestLoaded({ name: manifestName }) }}
      </p>
      <p v-if="libraryName" data-test-id="lowcode-library-source-name" class="truncate">
        {{ panels.lowcodeLibrariesLibraryLoaded({ name: libraryName }) }}
      </p>
      <p v-if="manifestError" data-test-id="lowcode-library-manifest-error" class="text-red-400">
        {{ manifestError }}
      </p>
      <p v-if="libraryError" data-test-id="lowcode-library-source-error" class="text-red-400">
        {{ libraryError }}
      </p>
      <p v-if="acceptError" data-test-id="lowcode-library-accept-error" class="text-red-400">
        {{ acceptError }}
      </p>
      <p
        v-if="acceptMessage"
        data-test-id="lowcode-library-accept-message"
        class="text-emerald-400"
      >
        {{ acceptMessage }}
      </p>
    </div>

    <ul v-if="hasLibraries" class="flex flex-col gap-1.5">
      <li
        v-for="row in rows"
        :key="`${row.libraryId}:${row.componentKey}`"
        data-test-id="lowcode-library-row"
        class="rounded border border-border bg-input/40 px-2 py-1.5"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-xs font-medium text-surface">{{ row.componentKey }}</p>
            <p class="truncate text-[10px] text-muted">{{ row.libraryName }}</p>
          </div>
          <span
            data-test-id="lowcode-library-status"
            class="shrink-0 text-[10px]"
            :class="statusClass(row.status)"
          >
            {{ statusLabel(row.status) }}
          </span>
        </div>
        <dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-1 gap-y-0.5 text-[10px]">
          <dt class="text-muted">{{ panels.lowcodeLibrariesCurrent }}</dt>
          <dd class="truncate text-surface">
            {{ row.currentVersion ?? panels.lowcodeLibrariesMissing }}
          </dd>
          <dt class="text-muted">{{ panels.lowcodeLibrariesLatest }}</dt>
          <dd class="truncate text-surface">
            {{ row.latestVersion ?? panels.lowcodeLibrariesUnknown }}
          </dd>
          <dt class="text-muted">{{ panels.lowcodeLibrariesSource }}</dt>
          <dd class="truncate text-surface">{{ row.sourceRef }}</dd>
        </dl>
        <button
          type="button"
          data-test-id="lowcode-library-accept"
          class="mt-1.5 w-full rounded px-2 py-1 text-left text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="row.status !== 'outdated' || !canAccept"
          :aria-label="panels.lowcodeLibrariesAcceptUpdateAria({ componentKey: row.componentKey })"
          @click="acceptUpdate(row.componentKey)"
        >
          {{ panels.lowcodeLibrariesAcceptUpdate }}
        </button>
      </li>
    </ul>
  </div>
</template>
