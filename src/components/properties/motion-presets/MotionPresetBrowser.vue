<script setup lang="ts">
import { computed, ref } from 'vue'

import type { MotionPresetCategory } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import type {
  MotionPresetLibraryFilter,
  MotionPresetLibraryItem,
  MotionPresetLibraryKey
} from '@/app/motion-presets/types'
import MotionPresetCard from '@/components/properties/motion-presets/MotionPresetCard.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

interface MotionPresetGroup {
  id: string
  label: string
  items: MotionPresetLibraryItem[]
}

const CATEGORY_ORDER: MotionPresetCategory[] = ['entrance', 'interaction', 'emphasis', 'loop']

const {
  items,
  favoriteKeys,
  canSaveCurrent = false,
  selectedKey,
  disabled = false,
  authoringDisabled = false
} = defineProps<{
  items: readonly MotionPresetLibraryItem[]
  favoriteKeys: readonly MotionPresetLibraryKey[]
  canSaveCurrent?: boolean
  selectedKey?: MotionPresetLibraryKey
  disabled?: boolean
  authoringDisabled?: boolean
}>()

const emit = defineEmits<{
  apply: [item: MotionPresetLibraryItem]
  'preview-start': [item: MotionPresetLibraryItem]
  'preview-stop': [item: MotionPresetLibraryItem]
  'toggle-favorite': [item: MotionPresetLibraryItem]
  'save-current': []
  edit: [item: MotionPresetLibraryItem]
  'update-current': [item: MotionPresetLibraryItem]
  delete: [item: MotionPresetLibraryItem]
}>()

const { panels } = useI18n()
const query = ref('')
const category = ref<MotionPresetLibraryFilter>('all')
const favoriteSet = computed(() => new Set(favoriteKeys))
const categoryLabels = computed<Record<MotionPresetCategory, string>>(() => ({
  entrance: panels.value.motionPresetCategoryEntrance,
  interaction: panels.value.motionPresetCategoryInteraction,
  emphasis: panels.value.motionPresetCategoryEmphasis,
  loop: panels.value.motionPresetCategoryLoop
}))
const categoryOptions = computed<Array<{ value: MotionPresetLibraryFilter; label: string }>>(() => [
  { value: 'all', label: panels.value.motionPresetCategoryAll },
  { value: 'favorites', label: panels.value.motionPresetCategoryFavorites },
  { value: 'entrance', label: panels.value.motionPresetCategoryEntrance },
  { value: 'interaction', label: panels.value.motionPresetCategoryInteraction },
  { value: 'emphasis', label: panels.value.motionPresetCategoryEmphasis },
  { value: 'loop', label: panels.value.motionPresetCategoryLoop },
  { value: 'my', label: panels.value.motionPresetCategoryMy },
  { value: 'shared', label: panels.value.motionPresetCategoryShared }
])

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function triggerLabel(trigger: MotionPresetLibraryItem['trigger']): string {
  const labels = {
    mount: panels.value.motionTriggerMount,
    pageEnter: panels.value.motionTriggerPageEnter,
    pageExit: panels.value.motionTriggerPageExit,
    hover: panels.value.motionTriggerHover,
    press: panels.value.motionTriggerPress,
    focus: panels.value.motionTriggerFocus,
    click: panels.value.motionTriggerClick,
    inView: panels.value.motionTriggerInView,
    loop: panels.value.motionTriggerLoop,
    mixed: panels.value.motionMixed
  }
  return labels[trigger]
}

function categoryLabel(item: MotionPresetLibraryItem): string {
  return item.category === 'custom'
    ? panels.value.motionCustom
    : categoryLabels.value[item.category]
}

const matchingItems = computed(() => {
  const needle = normalizeSearch(query.value)
  return items.filter((item) => {
    if (category.value === 'favorites' && !favoriteSet.value.has(item.key)) return false
    if (category.value === 'my' && item.source !== 'user') return false
    if (category.value === 'shared' && item.source !== 'shared') return false
    if (
      CATEGORY_ORDER.includes(category.value as MotionPresetCategory) &&
      item.category !== category.value
    ) {
      return false
    }
    if (!needle) return true
    return normalizeSearch(
      [
        item.name,
        item.description,
        categoryLabel(item),
        item.category,
        triggerLabel(item.trigger),
        item.trigger,
        ...(item.keywords ?? [])
      ]
        .filter(Boolean)
        .join(' ')
    ).includes(needle)
  })
})

const groups = computed<MotionPresetGroup[]>(() => {
  if (category.value === 'favorites') {
    return [
      {
        id: 'favorites',
        label: panels.value.motionPresetCategoryFavorites,
        items: matchingItems.value
      }
    ]
  }
  if (category.value === 'my') {
    return [{ id: 'my', label: panels.value.motionPresetCategoryMy, items: matchingItems.value }]
  }
  if (category.value === 'shared') {
    return sharedGroups(matchingItems.value)
  }
  if (category.value !== 'all') {
    const id = category.value as MotionPresetCategory
    return [{ id, label: categoryLabels.value[id], items: matchingItems.value }]
  }
  const builtins = CATEGORY_ORDER.map((id) => ({
    id,
    label: categoryLabels.value[id],
    items: matchingItems.value.filter((item) => item.source === 'builtin' && item.category === id)
  })).filter((group) => group.items.length > 0)
  const userItems = matchingItems.value.filter((item) => item.source === 'user')
  const users = userItems.length
    ? [{ id: 'my', label: panels.value.motionPresetCategoryMy, items: userItems }]
    : []
  return [...builtins, ...users, ...sharedGroups(matchingItems.value)]
})

function sharedGroups(values: readonly MotionPresetLibraryItem[]): MotionPresetGroup[] {
  const groups = new Map<string, MotionPresetLibraryItem[]>()
  for (const item of values) {
    if (item.source !== 'shared' || !item.libraryId) continue
    const entries = groups.get(item.libraryId) ?? []
    entries.push(item)
    groups.set(item.libraryId, entries)
  }
  return [...groups.entries()].map(([id, groupItems]) => ({
    id: `shared-${id}`,
    label: groupItems[0]?.libraryName ?? panels.value.motionPresetCategoryShared,
    items: groupItems
  }))
}
</script>

<template>
  <div class="flex gap-1.5">
    <AppInput
      v-model="query"
      type="search"
      size="sm"
      class="min-w-0 flex-1"
      :placeholder="panels.motionPresetSearchPlaceholder"
      :aria-label="panels.motionPresetSearchAria"
      data-test-id="motion-preset-search"
    />
    <AppSelect
      v-model="category"
      class="w-25 shrink-0"
      :label="panels.motionPresetCategoryAria"
      :options="categoryOptions"
      data-test-id="motion-preset-category"
    />
  </div>

  <div class="mt-2 flex items-center justify-between gap-2">
    <p class="text-[10px] text-muted">
      {{
        matchingItems.length === 1
          ? panels.motionPresetCountOne({ count: String(matchingItems.length) })
          : panels.motionPresetCountMany({ count: String(matchingItems.length) })
      }}
    </p>
    <button
      type="button"
      class="rounded px-1.5 py-1 text-[10px] text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50"
      data-test-id="motion-preset-save-current"
      :disabled="disabled || authoringDisabled || !canSaveCurrent"
      @click="emit('save-current')"
    >
      + {{ panels.motionPresetSaveCurrent }}
    </button>
  </div>

  <div class="mt-1.5 max-h-72 space-y-2 overflow-y-auto pr-0.5">
    <section
      v-for="group in groups"
      :key="group.id"
      :data-test-id="`motion-preset-group-${group.id}`"
      :aria-label="group.label"
    >
      <h3 class="mb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
        {{ group.label }}
      </h3>
      <div class="grid grid-cols-2 gap-1.5">
        <MotionPresetCard
          v-for="item in group.items"
          :key="item.key"
          :item="item"
          :display-name="item.name"
          :trigger-label="triggerLabel(item.trigger)"
          :favorite="favoriteSet.has(item.key)"
          :selected="selectedKey === item.key"
          :disabled="disabled"
          :authoring-disabled="authoringDisabled"
          :can-update-current="canSaveCurrent"
          @apply="emit('apply', $event)"
          @toggle-favorite="emit('toggle-favorite', $event)"
          @preview-start="emit('preview-start', $event)"
          @preview-stop="emit('preview-stop', $event)"
          @edit="emit('edit', $event)"
          @update-current="emit('update-current', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
    </section>

    <div
      v-if="matchingItems.length === 0"
      data-test-id="motion-preset-empty"
      class="rounded border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted"
    >
      {{ panels.motionPresetNoMatches }}
    </div>
  </div>
</template>
