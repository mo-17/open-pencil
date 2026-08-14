<script setup lang="ts">
import type { LibrariesPanelController } from '@/app/lowcode/use-libraries-panel'

const { controller } = defineProps<{ controller: LibrariesPanelController }>()
const {
  busyComponentKey,
  busyOperation,
  candidateComponents,
  importCandidateComponent,
  isBusy,
  panels,
  remoteCandidate
} = controller
</script>

<template>
  <div
    v-if="remoteCandidate"
    data-test-id="lowcode-library-candidate"
    class="mb-2 rounded border border-border bg-input/40 px-2 py-1.5"
  >
    <p class="truncate text-xs font-medium text-surface">{{ remoteCandidate.manifest.name }}</p>
    <p class="mb-1.5 truncate text-[10px] text-muted">{{ remoteCandidate.manifestURL }}</p>
    <ul v-if="candidateComponents.length > 0" class="flex flex-col gap-1">
      <li
        v-for="component in candidateComponents"
        :key="component.key"
        data-test-id="lowcode-library-candidate-component"
        class="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
      >
        <div class="min-w-0">
          <p class="truncate text-[11px] text-surface">{{ component.name }}</p>
          <p class="truncate text-[10px] text-muted">
            {{ component.key }} · {{ component.version }}
          </p>
        </div>
        <button
          type="button"
          data-test-id="lowcode-library-import"
          class="shrink-0 rounded px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="isBusy"
          :aria-label="panels.lowcodeLibrariesImportAria({ componentKey: component.key })"
          @click="importCandidateComponent(component)"
        >
          {{
            busyOperation === 'importing' && busyComponentKey === component.key
              ? panels.lowcodeLibrariesImporting({ componentKey: component.key })
              : panels.lowcodeLibrariesImport
          }}
        </button>
      </li>
    </ul>
    <p v-else class="text-[10px] text-muted">
      {{ panels.lowcodeLibrariesAllCandidateComponentsImported }}
    </p>
  </div>
</template>
