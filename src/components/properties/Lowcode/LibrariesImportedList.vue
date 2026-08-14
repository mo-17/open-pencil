<script setup lang="ts">
import type { LibrariesPanelController } from '@/app/lowcode/use-libraries-panel'

const { controller } = defineProps<{ controller: LibrariesPanelController }>()
const {
  acceptUpdate,
  busyComponentKey,
  busyLibraryId,
  busyOperation,
  canAccept,
  checkLibrary,
  isMutationBusy,
  manifestSourceURL,
  panels,
  rows,
  statusClass,
  statusLabel
} = controller
</script>

<template>
  <ul class="flex flex-col gap-1.5">
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
      <div class="mt-1.5 grid grid-cols-2 gap-1">
        <button
          v-if="manifestSourceURL(row.libraryId)"
          type="button"
          data-test-id="lowcode-library-check"
          class="rounded px-2 py-1 text-left text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="isMutationBusy"
          :aria-label="panels.lowcodeLibrariesCheckAria({ libraryName: row.libraryName })"
          @click="checkLibrary(row.libraryId)"
        >
          {{
            busyOperation === 'checking' && busyLibraryId === row.libraryId
              ? panels.lowcodeLibrariesChecking
              : panels.lowcodeLibrariesCheck
          }}
        </button>
        <span v-else aria-hidden="true"></span>
        <button
          type="button"
          data-test-id="lowcode-library-accept"
          class="rounded px-2 py-1 text-left text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canAccept(row)"
          :aria-label="panels.lowcodeLibrariesAcceptUpdateAria({ componentKey: row.componentKey })"
          @click="acceptUpdate(row.componentKey)"
        >
          {{
            busyOperation === 'accepting' && busyComponentKey === row.componentKey
              ? panels.lowcodeLibrariesAccepting({ componentKey: row.componentKey })
              : panels.lowcodeLibrariesAcceptUpdate
          }}
        </button>
      </div>
    </li>
  </ul>
</template>
