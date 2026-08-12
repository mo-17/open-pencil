<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import MotionPresetLibrary from '@/components/properties/MotionPresetLibrary.vue'
import MotionGeneratedEffect from '@/components/properties/MotionGeneratedEffect.vue'
import {
  MotionRecipeLibrary,
  type MotionRecipeLibraryLabels
} from '@/components/properties/motion-recipes'
import MotionPrototypeAuthoring from '@/components/properties/motion-presets/MotionPrototypeAuthoring.vue'
import MotionSceneTimeline from '@/components/properties/MotionSceneTimeline.vue'
import MotionDetailsControls from '@/components/properties/motion-presets/MotionDetailsControls.vue'
import MotionTeamLibraries from '@/components/properties/motion-presets/MotionTeamLibraries.vue'
import { useMotionPresetLibrary } from '@/components/properties/motion-presets/use/motion-preset-library'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const { panels } = useI18n()
const recipeLabels = computed<MotionRecipeLibraryLabels>(() => ({
  title: panels.value.motionRecipes,
  createNamePlaceholder: panels.value.motionRecipeNamePlaceholder,
  createDescriptionPlaceholder: panels.value.motionRecipeDescriptionPlaceholder,
  createFromSelection: panels.value.motionRecipeCreateFromSelection,
  empty: panels.value.motionRecipeEmpty,
  recipeSelect: panels.value.motionRecipeSelect,
  parameters: panels.value.motionRecipeParameters,
  roleMapping: panels.value.motionRecipeRoleMapping,
  mappingTargetPlaceholder: panels.value.motionRecipeMappingPlaceholder,
  compatible: panels.value.motionRecipeCompatible,
  incompatible: panels.value.motionRecipeIncompatible,
  preview: panels.value.motionPreview,
  stopPreview: panels.value.motionStopPreview,
  apply: panels.value.motionRecipeApply,
  delete: panels.value.motionRecipeDelete,
  jsonPlaceholder: panels.value.motionRecipeJsonPlaceholder,
  conflictPolicy: panels.value.motionRecipeConflictPolicy,
  conflictReject: panels.value.motionRecipeConflictReject,
  conflictKeep: panels.value.motionRecipeConflictKeep,
  conflictReplace: panels.value.motionRecipeConflictReplace,
  importJson: panels.value.motionRecipeImportJson,
  exportJson: panels.value.motionRecipeExportJson,
  importFile: panels.value.motionRecipeImportFile,
  exportFile: panels.value.motionRecipeExportFile
}))
const {
  selection,
  selectedIdList,
  items,
  favorites,
  sharedLibraries,
  sharedBusyId,
  errorMessage,
  authoringDisabled,
  authoringDisabledReason,
  exportJSON,
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
  importJSON,
  exportLibraryJSON,
  importFile,
  exportFile,
  acceptSharedJSON,
  checkSharedLibrary,
  acceptSharedUpdate,
  removeSharedLibrary
} = useMotionPresetLibrary()
</script>

<template>
  <div data-test-id="motion-panel">
    <PanelSection :label="panels.motion">
      <MotionSceneTimeline />

      <fieldset>
        <legend class="mb-1.5 text-[11px] text-muted">{{ panels.motionPresets }}</legend>
        <p
          v-if="authoringDisabledReason"
          data-test-id="motion-node-capability-warning"
          class="mb-2 rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[10px] leading-4 text-warning"
        >
          {{ authoringDisabledReason }}
        </p>
        <MotionPresetLibrary
          :items="items"
          :favorite-keys="favorites"
          :shared-libraries="sharedLibraries"
          :shared-busy-id="sharedBusyId"
          :selection-count="selection.count"
          :can-save-current="canSaveCurrent"
          :selected-key="selectedKey"
          :error="errorMessage"
          :authoring-disabled="authoringDisabled"
          :export-json="exportJSON"
          :stagger-enabled="staggerEnabled"
          :stagger-step-ms="staggerStepMs"
          :stagger-direction="staggerDirection"
          :stagger-rhythm="staggerRhythm"
          @apply="apply"
          @preview-start="preview"
          @preview-stop="stopPreview"
          @toggle-favorite="toggleFavorite"
          @save-current="saveCurrent"
          @edit="edit"
          @update-current="updateFromCurrent"
          @delete="remove"
          @import-json="importJSON"
          @export-json="exportLibraryJSON"
          @import-file="importFile"
          @export-file="exportFile"
          @accept-shared-json="acceptSharedJSON"
          @check-shared="checkSharedLibrary"
          @accept-shared="acceptSharedUpdate"
          @remove-shared="removeSharedLibrary"
          @update:stagger-enabled="staggerEnabled = $event"
          @update:stagger-step-ms="staggerStepMs = $event"
          @update:stagger-direction="staggerDirection = $event"
          @update:stagger-rhythm="staggerRhythm = $event"
        />
      </fieldset>

      <MotionGeneratedEffect />

      <MotionRecipeLibrary :labels="recipeLabels" />

      <MotionTeamLibraries />

      <MotionPrototypeAuthoring :selected-ids="selectedIdList" />

      <MotionDetailsControls :selection="selection" :selected-ids="selectedIdList" />
    </PanelSection>
  </div>
</template>
