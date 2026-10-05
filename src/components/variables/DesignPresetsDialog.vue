<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { computed, ref, watch } from 'vue'

import { colorToHex } from '@open-pencil/core/color'
import type { VariableCollection, VariableValue } from '@open-pencil/scene-graph'
import { useCommonMessages, useEditor, useVariableMessages } from '@open-pencil/vue'

import {
  DESIGN_PRESET_IDS,
  getDesignPresetTokens,
  type DesignPresetId
} from '@/app/design-presets/catalog'
import { designPresetCollectionName, importDesignPreset } from '@/app/design-presets/import'
import AppButton from '@/components/ui/button/AppButton.vue'
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot
} from '@/components/ui/dialog'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import { designPresets } from '@/theme/design/presets'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  imported: [collection: VariableCollection]
  returnFocus: [event: Event]
}>()
const editor = useEditor()
const messages = useVariableMessages()
const common = useCommonMessages()
const selected = ref<DesignPresetId>('business')
const failed = ref(false)
const styles = designPresets()
const names = computed(() => ({
  business: messages.value.presetBusiness,
  soft: messages.value.presetSoft,
  contrast: messages.value.presetContrast
}))
const descriptions = computed(() => ({
  business: messages.value.presetBusinessDescription,
  soft: messages.value.presetSoftDescription,
  contrast: messages.value.presetContrastDescription
}))
const tokens = computed(() => getDesignPresetTokens(selected.value))
const collectionName = computed(() => {
  void editor.state.sceneVersion
  return designPresetCollectionName(editor, names.value[selected.value])
})

watch(open, () => {
  failed.value = false
})
watch(selected, () => {
  failed.value = false
})

function formatValue(value: VariableValue): string {
  return typeof value === 'object' && 'r' in value ? colorToHex(value) : String(value)
}

function importPreset() {
  try {
    const collection = importDesignPreset(editor, selected.value, {
      collectionName: names.value[selected.value],
      light: messages.value.presetLight,
      dark: messages.value.presetDark,
      undo: messages.value.presetImport
    })
    emit('imported', collection)
    open.value = false
  } catch {
    failed.value = true
  }
}
</script>

<template>
  <AppDialogRoot v-model:open="open" size="lg" @close-auto-focus="emit('returnFocus', $event)">
    <AppDialogHeader
      :heading="messages.designPresets"
      :description="messages.presetIntro"
      :close-label="common.close"
    />
    <AppDialogBody :ui="{ body: 'space-y-4' }">
      <RadioGroupRoot
        v-model="selected"
        :aria-label="messages.presetChoose"
        :class="styles.options()"
      >
        <RadioGroupItem
          v-for="id in DESIGN_PRESET_IDS"
          :key="id"
          :value="id"
          :class="styles.option()"
        >
          <span :class="styles.name()">{{ names[id] }}</span>
          <span :class="styles.description()">{{ descriptions[id] }}</span>
        </RadioGroupItem>
      </RadioGroupRoot>
      <AppAlert :heading="messages.presetScope" :description="messages.presetScopeDescription" />
      <div>
        <h3 class="mb-2 text-xs font-medium text-surface">
          {{ messages.presetCollection }}: {{ collectionName }}
        </h3>
        <div :class="styles.preview()">
          <table :class="styles.table()" :aria-label="messages.presetPreview">
            <thead :class="styles.header()">
              <tr>
                <th :class="styles.cell()">{{ messages.presetVariable }}</th>
                <th :class="styles.cell()">{{ messages.presetLight }}</th>
                <th :class="styles.cell()">{{ messages.presetDark }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="token in tokens" :key="token.name">
                <td :class="styles.cell()">
                  <code>{{ collectionName }}/{{ token.name }}</code>
                </td>
                <td v-for="mode in ['light', 'dark'] as const" :key="mode" :class="styles.cell()">
                  <span :class="styles.value()">
                    <span
                      v-if="token.type === 'COLOR'"
                      :class="styles.swatch()"
                      :style="{ backgroundColor: formatValue(token[mode]) }"
                      aria-hidden="true"
                    />
                    {{ formatValue(token[mode]) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <AppAlert
        v-if="failed"
        tone="error"
        :heading="messages.presetImportFailed"
        :description="messages.presetRetry"
      />
    </AppDialogBody>
    <AppDialogFooter>
      <AppButton variant="ghost" @click="open = false">{{ common.cancel }}</AppButton>
      <AppButton @click="importPreset">{{ messages.presetImport }}</AppButton>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
