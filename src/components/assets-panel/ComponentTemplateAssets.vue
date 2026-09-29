<script setup lang="ts">
import { usePanelMessages } from '@open-pencil/vue'

import { componentTemplateAssetKey } from '@/app/assets/component-templates'
import type { useAssetWorkbench } from '@/app/assets/use'
import type { ComponentTemplateId } from '@/app/lowcode/component-templates'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import { componentTemplates } from '@/theme/component-templates'

const { items, favorites, busy } = defineProps<{
  items: ReturnType<typeof useAssetWorkbench>['filteredTemplates']['value']
  favorites: ReadonlySet<string>
  busy: boolean
}>()
const emit = defineEmits<{
  insert: [id: ComponentTemplateId]
  favorite: [key: string]
  plugins: []
}>()
const panels = usePanelMessages()
const styles = componentTemplates()
</script>

<template>
  <section v-if="items.length" :class="styles.root()" :aria-label="panels.assetSourceTemplate">
    <h2 :class="styles.heading()">{{ panels.assetSourceTemplate }}</h2>
    <p :class="styles.hint()">{{ panels.assetTemplateScope }}</p>
    <ul :class="styles.list()">
      <li
        v-for="item in items"
        :key="item.template.id"
        :data-component-template="item.template.id"
        :data-template-kind="item.template.kind"
        :class="styles.card()"
      >
        <div :class="styles.header()">
          <div :class="styles.title()">
            <h3>{{ item.template.name }}</h3>
            <p :class="styles.badge()">
              {{
                item.template.kind === 'basic'
                  ? panels.assetTemplateBasic
                  : panels.assetTemplateCombination
              }}
              · React / Vue
            </p>
          </div>
          <AppButton
            color="neutral"
            variant="ghost"
            size="sm"
            shape="square"
            :aria-label="
              favorites.has(componentTemplateAssetKey(item.template.id))
                ? panels.assetRemoveFavorite
                : panels.assetAddFavorite
            "
            :aria-pressed="favorites.has(componentTemplateAssetKey(item.template.id))"
            @click="emit('favorite', componentTemplateAssetKey(item.template.id))"
          >
            <icon-lucide-star
              :class="styles.star()"
              :data-selected="favorites.has(componentTemplateAssetKey(item.template.id))"
              aria-hidden="true"
            />
          </AppButton>
        </div>
        <p :class="styles.description()">{{ item.template.description }}</p>
        <details v-if="item.template.limitations.length" :class="styles.details()">
          <summary :class="styles.summary()">{{ panels.assetTemplateDetails }}</summary>
          <ul :class="styles.limitations()">
            <li v-for="limit in item.template.limitations" :key="limit">{{ limit }}</li>
          </ul>
        </details>
        <div :class="styles.actions()">
          <AppAlert
            v-if="!item.availability.ok"
            tone="warning"
            :heading="panels.assetTemplateUnavailable"
            :description="
              panels.assetTemplateModules({ modules: item.availability.missingModules.join(', ') })
            "
          >
            <template #actions>
              <AppButton color="neutral" variant="outline" size="sm" @click="emit('plugins')">
                {{ panels.assetTemplateManagePlugins }}
              </AppButton>
            </template>
          </AppAlert>
          <AppButton
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="busy || !item.availability.ok"
            @click="emit('insert', item.template.id)"
          >
            <icon-lucide-plus class="size-3" aria-hidden="true" />{{ panels.assetTemplateInsert }}
          </AppButton>
        </div>
      </li>
    </ul>
  </section>
</template>
