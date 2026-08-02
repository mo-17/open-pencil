<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { templateRef, unrefElement } from '@vueuse/core'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxVirtualizer,
  ComboboxViewport,
  type AcceptableValue
} from 'reka-ui'

import {
  fontFamilyOptionLicenseStatus,
  useFontPicker,
  type FontAccessController,
  type FontFamilyOption
} from '#vue/primitives/FontPicker/useFontPicker'

import type { FontPickerUI } from '#vue/primitives/FontPicker/types'

const {
  listFamilies,
  localFontAccess,
  ui,
  emptySearchText,
  emptyLicenseFilterText,
  emptyFontsText,
  emptyFontsHint
} = defineProps<{
  listFamilies: () => Promise<string[] | FontFamilyOption[]>
  localFontAccess?: FontAccessController
  ui?: FontPickerUI
  emptySearchText?: string
  emptyLicenseFilterText?: string
  emptyFontsText?: string
  emptyFontsHint?: string
}>()

const modelValue = defineModel<string>({ required: true })
const emit = defineEmits<{ select: [family: string] }>()

const contentRef = templateRef<HTMLElement>('contentRef')

function focusSearchInput() {
  nextTick(() => {
    const content = unrefElement(contentRef)
    if (!(content instanceof HTMLElement)) return
    content.querySelector<HTMLInputElement>('input')?.focus()
  })
}

const {
  families,
  searchTerm,
  licenseFilter,
  open,
  filtered,
  loading,
  accessState,
  requestAccess,
  setLicenseFilter,
  select
} = useFontPicker({
  modelValue,
  listFamilies,
  localFontAccess,
  onSelect: (family) => emit('select', family)
})

const selectedOption = computed(() =>
  families.value.find((option) => option.family === modelValue.value)
)
</script>

<template>
  <ComboboxRoot
    v-model:open="open"
    :model-value="modelValue"
    :ignore-filter="true"
    @update:model-value="
      (v: AcceptableValue) => {
        if (typeof v === 'string') select(v)
      }
    "
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger as-child>
        <slot name="trigger" :value="modelValue" :open="open" :option="selectedOption">
          <button :class="ui?.trigger">
            <span class="truncate">{{ modelValue }}</span>
          </button>
        </slot>
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        :side-offset="2"
        align="start"
        position="popper"
        :class="ui?.content"
        @open-auto-focus.prevent
        ref="contentRef"
        @vue:mounted="focusSearchInput"
      >
        <slot name="search" :search-term="searchTerm">
          <ComboboxInput
            v-model="searchTerm"
            :display-value="() => ''"
            :class="ui?.search"
            placeholder="Search fonts…"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </slot>

        <slot
          name="filters"
          :license-filter="licenseFilter"
          :set-license-filter="setLicenseFilter"
        />

        <ComboboxViewport :class="ui?.viewport ?? 'max-h-72 overflow-y-auto'">
          <ComboboxVirtualizer
            v-slot="{ option }"
            :options="filtered"
            :text-content="(option: FontFamilyOption) => option.family"
            :estimate-size="36"
            :overscan="2"
          >
            <ComboboxItem
              :value="option.family"
              :class="ui?.item"
              :style="{ fontFamily: `'${option.family}', sans-serif` }"
              :data-license-status="fontFamilyOptionLicenseStatus(option)"
            >
              <slot
                name="item"
                :option="option"
                :family="option.family"
                :source="option.source"
                :license-display="option.licenseDisplay"
                :license-status="fontFamilyOptionLicenseStatus(option)"
                :selected="option.family === modelValue"
              >
                <ComboboxItemIndicator>
                  <slot name="indicator" :selected="option.family === modelValue" />
                </ComboboxItemIndicator>
                <span class="truncate">{{ option.family }}</span>
              </slot>
            </ComboboxItem>
          </ComboboxVirtualizer>

          <div
            v-if="filtered.length === 0 && (searchTerm || licenseFilter !== 'all')"
            :class="ui?.empty"
          >
            {{
              searchTerm
                ? (emptySearchText ?? 'No fonts found')
                : (emptyLicenseFilterText ?? 'No fonts match this license filter')
            }}
          </div>
          <div v-else-if="filtered.length === 0" :class="ui?.empty">
            <div>
              <p v-if="accessState === 'prompt'">
                Allow local font access to browse installed fonts.
              </p>
              <p v-else-if="accessState === 'denied'">
                Local font access is blocked for this site.
              </p>
              <p v-else-if="accessState === 'unsupported'">
                Local fonts are not available in this browser.
              </p>
              <p v-else>{{ emptyFontsText ?? 'No local fonts available.' }}</p>
              <p v-if="emptyFontsHint" class="mt-1">{{ emptyFontsHint }}</p>
              <button
                v-if="accessState === 'prompt'"
                type="button"
                :class="ui?.emptyAction"
                :disabled="loading"
                @click="requestAccess"
              >
                {{ loading ? 'Loading…' : 'Allow local fonts' }}
              </button>
            </div>
          </div>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
