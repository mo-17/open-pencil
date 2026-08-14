<script setup lang="ts">
import { useSectionUI } from '@/components/ui/section'
import LibrariesCandidate from '@/components/properties/Lowcode/LibrariesCandidate.vue'
import LibrariesImportedList from '@/components/properties/Lowcode/LibrariesImportedList.vue'
import LibrariesSourceControls from '@/components/properties/Lowcode/LibrariesSourceControls.vue'

import { useLibrariesPanel } from '@/app/lowcode/use-libraries-panel'

const sectionCls = useSectionUI()
const controller = useLibrariesPanel()
const { hasLibraries, isBusy, panels, rows } = controller
</script>

<template>
  <div data-test-id="lowcode-libraries-section" :class="sectionCls.wrapper" :aria-busy="isBusy">
    <div class="mb-1.5 flex items-center justify-between">
      <span class="text-[11px] text-muted">{{ panels.lowcodeLibraries }}</span>
      <span class="text-[10px] text-muted">
        {{ panels.lowcodeLibrariesImportCount({ count: String(rows.length) }) }}
      </span>
    </div>

    <LibrariesSourceControls :controller />
    <LibrariesCandidate :controller />
    <p v-if="!hasLibraries" data-test-id="lowcode-libraries-empty" class="text-[11px] text-muted">
      {{ panels.lowcodeLibrariesEmpty }}
    </p>
    <LibrariesImportedList v-else :controller />
  </div>
</template>
