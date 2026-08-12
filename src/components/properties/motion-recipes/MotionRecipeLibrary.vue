<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import {
  MOTION_RECIPE_LIBRARY_LIMITS,
  type MotionRecipeMergePolicy
} from '@open-pencil/scene-graph'

import { isTauri } from '@/app/tauri/env'
import AppSelect from '@/components/ui/AppSelect.vue'
import Tip from '@/components/ui/Tip.vue'

import type { MotionRecipeLibraryLabels } from './types'
import { useMotionRecipeLibrary } from './use-motion-recipe-library'

const { labels } = defineProps<{ labels: MotionRecipeLibraryLabels }>()
const recipe = useMotionRecipeLibrary()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const conflictPolicy = defineModel<MotionRecipeMergePolicy>('conflictPolicy', {
  default: 'error'
})
const recipeOptions = computed(() =>
  recipe.recipes.value.map((item) => ({ value: item.id, label: item.name }))
)
const conflictOptions = computed(() => [
  { value: 'error' as const, label: labels.conflictReject },
  { value: 'skip' as const, label: labels.conflictKeep },
  { value: 'replace' as const, label: labels.conflictReplace }
])

function inputText(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : ''
}

function inputNumber(event: Event): number {
  return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : Number.NaN
}

function requestImportFile(): void {
  if (isTauri()) void recipe.importFile(undefined, conflictPolicy.value)
  else fileInput.value?.click()
}

function importBrowserFile(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  input.value = ''
  if (file) void recipe.importFile(file, conflictPolicy.value)
}
</script>

<template>
  <section class="mt-2 space-y-2 border-t border-border pt-2" data-test-id="motion-recipes">
    <div class="text-[10px] font-medium text-surface">{{ labels.title }}</div>

    <div class="grid grid-cols-2 gap-1.5">
      <input
        v-model="recipe.createName.value"
        data-test-id="motion-recipe-name"
        class="rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface"
        :placeholder="labels.createNamePlaceholder"
        maxlength="96"
      />
      <input
        v-model="recipe.createDescription.value"
        class="rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface"
        :placeholder="labels.createDescriptionPlaceholder"
        maxlength="512"
      />
    </div>
    <button
      type="button"
      data-test-id="motion-recipe-create"
      class="w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
      :disabled="recipe.blocked.value || !recipe.createName.value.trim()"
      @click="recipe.createFromSelection"
    >
      {{ labels.createFromSelection }}
    </button>

    <div v-if="recipe.recipes.value.length === 0" class="text-[10px] text-muted">
      {{ labels.empty }}
    </div>
    <AppSelect
      v-else
      :model-value="recipe.selectedRecipeId.value"
      :label="labels.recipeSelect"
      :placeholder="labels.recipeSelect"
      :options="recipeOptions"
      @update:model-value="recipe.selectRecipe"
    />

    <template v-if="recipe.selectedRecipe.value">
      <div v-if="recipe.selectedRecipe.value.parameters.length" class="space-y-1">
        <div class="text-[10px] text-muted">{{ labels.parameters }}</div>
        <label
          v-for="parameter in recipe.selectedRecipe.value.parameters"
          :key="parameter.id"
          class="grid grid-cols-[1fr_84px] items-center gap-2 text-[10px] text-surface"
        >
          <span>{{ parameter.id }}</span>
          <input
            type="number"
            class="rounded border border-border bg-input px-1.5 py-1 text-right"
            :min="parameter.min"
            :max="parameter.max"
            :value="recipe.parameters.value[parameter.id]"
            @input="recipe.setParameter(parameter.id, inputNumber($event))"
          />
        </label>
      </div>

      <div class="space-y-1">
        <div class="text-[10px] text-muted">{{ labels.roleMapping }}</div>
        <label
          v-for="role in recipe.selectedRecipe.value.roles"
          :key="role.id"
          class="grid grid-cols-[80px_1fr] items-center gap-2 text-[10px] text-surface"
        >
          <Tip :label="role.id">
            <span class="truncate">{{ role.id }}</span>
          </Tip>
          <input
            :data-test-id="`motion-recipe-role-${role.id}`"
            class="rounded border border-border bg-input px-1.5 py-1 font-mono"
            :value="recipe.roleMapping.value[role.id]?.join(', ') ?? ''"
            :placeholder="labels.mappingTargetPlaceholder"
            @input="recipe.setRoleTargets(role.id, inputText($event))"
          />
        </label>
      </div>

      <div
        class="rounded px-1.5 py-1 text-[10px]"
        :class="
          recipe.compatibility.value.compatible
            ? 'bg-success/10 text-success'
            : 'bg-danger/10 text-danger'
        "
      >
        {{
          recipe.compatibility.value.compatible
            ? `${labels.compatible}: ${recipe.compatibility.value.assignmentCount}`
            : `${labels.incompatible}: ${recipe.compatibility.value.error ?? ''}`
        }}
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
          :disabled="!recipe.compatibility.value.compatible"
          @click="recipe.preview"
        >
          {{ labels.preview }}
        </button>
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface hover:bg-hover"
          @click="recipe.stopPreview"
        >
          {{ labels.stopPreview }}
        </button>
        <button
          type="button"
          data-test-id="motion-recipe-apply"
          class="rounded bg-accent px-2 py-1 text-[10px] text-accent-foreground disabled:opacity-50"
          :disabled="!recipe.compatibility.value.compatible"
          @click="recipe.apply(labels.apply)"
        >
          {{ labels.apply }}
        </button>
        <button
          type="button"
          class="rounded border border-danger/40 px-2 py-1 text-[10px] text-danger hover:bg-danger/10"
          @click="recipe.removeSelected"
        >
          {{ labels.delete }}
        </button>
      </div>
    </template>

    <div class="space-y-1.5 border-t border-border pt-2">
      <textarea
        v-model="recipe.importJSON.value"
        rows="3"
        :maxlength="MOTION_RECIPE_LIBRARY_LIMITS.maxJsonBytes"
        class="w-full resize-y rounded border border-border bg-input p-1.5 font-mono text-[10px] text-surface"
        :placeholder="labels.jsonPlaceholder"
      />
      <AppSelect
        v-model="conflictPolicy"
        :label="labels.conflictPolicy"
        :options="conflictOptions"
      />
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="hidden"
        @change="importBrowserFile"
      />
      <div class="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface disabled:opacity-50"
          :disabled="!recipe.importJSON.value.trim()"
          @click="recipe.importLibrary(conflictPolicy)"
        >
          {{ labels.importJson }}
        </button>
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface"
          @click="recipe.exportLibrary"
        >
          {{ labels.exportJson }}
        </button>
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface"
          @click="requestImportFile"
        >
          {{ labels.importFile }}
        </button>
        <button
          type="button"
          class="rounded border border-border bg-input px-2 py-1 text-[10px] text-surface"
          @click="recipe.exportFile"
        >
          {{ labels.exportFile }}
        </button>
      </div>
      <textarea
        v-if="recipe.exportedJSON.value"
        :value="recipe.exportedJSON.value"
        readonly
        rows="3"
        class="w-full resize-y rounded border border-border bg-panel p-1.5 font-mono text-[10px] text-muted"
      />
    </div>

    <p v-if="recipe.error.value" class="text-[10px] text-danger" role="alert">
      {{ recipe.error.value }}
    </p>
  </section>
</template>
