<script setup lang="ts">
import { computed } from 'vue'

import { CAROUSEL_MODULE_LIMITS } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import type { CarouselSlidesCommit } from '@/app/lowcode/carousel-editor'
import { useCarouselSlidesDraft } from '@/app/lowcode/carousel-editor/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { owner, config, label } = defineProps<{
  owner?: SceneNode
  config: JSONObject
  label: string
}>()
const emit = defineEmits<{ commit: [request: CarouselSlidesCommit] }>()
const panels = usePanelMessages()
const active = useRetainedActivity()
const { draft, invalid, restore, beginInput, input, commit, edit } = useCarouselSlidesDraft(
  () => owner,
  () => config,
  (request) => emit('commit', request),
  active
)
const fields = computed(() => [
  { key: 'title' as const, label: panels.value.lowcodeCarouselTitle },
  { key: 'description' as const, label: panels.value.lowcodeCarouselDescription },
  { key: 'imageUrl' as const, label: panels.value.lowcodeCarouselImageUrl },
  { key: 'alt' as const, label: panels.value.lowcodeCarouselAlt },
  { key: 'href' as const, label: panels.value.lowcodeCarouselHref }
])
const initialChoices = computed(() =>
  draft.value.slides.map((slide, index) => ({
    value: index,
    label: `${index + 1}. ${slide.title}`
  }))
)
</script>

<template>
  <div
    data-test-id="carousel-slides-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-2"
  >
    <label class="text-[10px] text-muted">{{ panels.lowcodeCarouselInitial }}</label>
    <AppSelect
      :model-value="draft.initialIndex"
      :options="initialChoices"
      :label="panels.lowcodeCarouselInitial"
      data-test-id="carousel-initial-slide"
      @update:model-value="edit({ kind: 'initial', index: $event })"
    />
    <p class="text-[10px] leading-relaxed text-muted">{{ panels.lowcodeCarouselSelectionHint }}</p>
    <div class="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
      <fieldset
        v-for="(slide, index) in draft.slides"
        :key="index"
        data-test-id="carousel-slide-row"
        class="min-w-0 rounded border border-border bg-input p-2"
      >
        <legend class="px-1 text-[10px] font-medium text-surface">
          {{ panels.lowcodeCarouselSlideTitle({ index: index + 1 }) }}
        </legend>
        <div class="mb-2 flex justify-end gap-1">
          <AppButton
            variant="ghost"
            size="xs"
            data-test-id="carousel-move-up"
            :disabled="index === 0"
            :aria-label="panels.lowcodeSelectMoveUp"
            @click="edit({ kind: 'move', index, offset: -1 })"
            ><icon-lucide-arrow-up class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            data-test-id="carousel-move-down"
            :disabled="index === draft.slides.length - 1"
            :aria-label="panels.lowcodeSelectMoveDown"
            @click="edit({ kind: 'move', index, offset: 1 })"
            ><icon-lucide-arrow-down class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            data-test-id="carousel-remove-slide"
            :disabled="draft.slides.length <= 1"
            :aria-label="panels.lowcodeInteractiveOptionRemove"
            @click="edit({ kind: 'remove', index })"
            ><icon-lucide-x class="size-3"
          /></AppButton>
        </div>
        <label v-for="field in fields" :key="field.key" class="mb-1.5 block text-[10px] text-muted">
          {{ field.label }}
          <AppTextarea
            v-if="field.key === 'description'"
            :model-value="slide[field.key]"
            :rows="2"
            :aria-label="field.label"
            :maxlength="CAROUSEL_MODULE_LIMITS[field.key]"
            data-test-id="carousel-slide-description"
            @focus="beginInput"
            @update:model-value="input(index, field.key, $event)"
            @blur="commit"
            @keydown.esc="restore"
          />
          <AppInput
            v-else
            :model-value="slide[field.key]"
            :ariaLabel="field.label"
            :maxlength="CAROUSEL_MODULE_LIMITS[field.key]"
            :data-test-id="`carousel-slide-${field.key}`"
            @focus="beginInput"
            @update:model-value="input(index, field.key, $event)"
            @change="commit"
            @enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="restore"
          />
        </label>
      </fieldset>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      data-test-id="carousel-add-slide"
      :disabled="draft.slides.length >= CAROUSEL_MODULE_LIMITS.slides"
      @click="edit({ kind: 'add', title: panels.lowcodeCarouselNewSlide })"
      >{{ panels.lowcodeCarouselAddSlide }}</AppButton
    >
    <p class="text-[10px] leading-relaxed text-muted">
      {{ panels.lowcodeCarouselImageHint({ protocol: 'HTTPS' }) }}
    </p>
    <p class="text-[10px] leading-relaxed text-muted">
      {{ panels.lowcodeCarouselLinkHint({ protocol: 'HTTPS' }) }}
    </p>
    <AppAlert
      v-if="invalid"
      tone="warning"
      :heading="panels.lowcodeCarouselInvalidDraft"
      data-test-id="carousel-draft-error"
    />
    <AppButton
      v-if="invalid"
      variant="ghost"
      size="xs"
      data-test-id="carousel-restore"
      @click="restore"
      >{{ panels.lowcodeCarouselRestore }}</AppButton
    >
  </div>
</template>
