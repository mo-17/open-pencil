<script setup lang="ts">
import { usePanelMessages, useDialogMessages } from '@open-pencil/vue'

import type { useAssetWorkbench } from '@/app/assets/use'
import AppButton from '@/components/ui/button/AppButton.vue'

const { items, favorites, busy } = defineProps<{
  items: ReturnType<typeof useAssetWorkbench>['filteredModules']['value']
  favorites: Set<string>
  busy: boolean
}>()
const emit = defineEmits<{
  insert: [
    module: ReturnType<typeof useAssetWorkbench>['filteredModules']['value'][number]['module'],
    effectId?: string
  ]
  favorite: [key: string]
}>()
const panels = usePanelMessages()
const dialogs = useDialogMessages()
</script>
<template>
  <section v-if="items.length" class="mb-3" :aria-label="panels.assetSourcePlugin">
    <h2 class="mb-1 px-1 text-[10px] font-medium text-muted">{{ panels.assetSourcePlugin }}</h2>
    <p class="mb-2 px-1 text-[10px] leading-4 text-muted">{{ panels.assetModulePreviewHint }}</p>
    <ul class="flex flex-col gap-2">
      <li
        v-for="item in items"
        :key="item.key"
        :data-module-type="item.module.contribution.moduleType"
        :data-effect-id="item.effectId"
        class="rounded border border-border p-2"
      >
        <div class="flex items-start gap-2">
          <icon-lucide-puzzle class="mt-1 size-4 shrink-0 text-component" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <h3 class="text-xs font-medium text-surface">{{ item.name }}</h3>
            <p class="mt-0.5 text-[10px] text-muted">{{ item.pluginName }}</p>
          </div>
          <AppButton
            color="neutral"
            variant="ghost"
            size="sm"
            shape="square"
            :aria-label="
              favorites.has(item.key) ? panels.assetRemoveFavorite : panels.assetAddFavorite
            "
            :aria-pressed="favorites.has(item.key)"
            @click="emit('favorite', item.key)"
          >
            <icon-lucide-star
              class="size-3.5"
              :fill="favorites.has(item.key) ? 'currentColor' : 'none'"
            />
          </AppButton>
        </div>
        <p class="mt-2 text-[11px] leading-4 text-muted">{{ item.description }}</p>
        <AppButton
          color="neutral"
          variant="outline"
          size="sm"
          class="mt-2 w-full"
          :disabled="busy"
          @click="emit('insert', item.module, item.effectId)"
        >
          <icon-lucide-plus class="size-3" />{{ dialogs.pluginAddToCanvas }}
        </AppButton>
      </li>
    </ul>
  </section>
</template>
