<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type { AIPopoutControls } from '@/app/ai/popout/controls'
import { aiPopoutControls, resetAIPopoutControls } from '@/app/settings/ai-popout-controls'
import AppSwitch from '@/components/ui/AppSwitch.vue'

const { disabled = false } = defineProps<{ disabled?: boolean }>()
const { dialogs } = useI18n()

function controlModel(key: keyof AIPopoutControls) {
  return computed<boolean>({
    get: () => aiPopoutControls.value[key],
    set: (value) => {
      aiPopoutControls.value = {
        ...aiPopoutControls.value,
        [key]: value
      }
    }
  })
}

const toolbar = controlModel('toolbar')
const focusEditor = controlModel('focusEditor')
const alwaysOnTop = controlModel('alwaysOnTop')
const clearChat = controlModel('clearChat')
const settings = controlModel('settings')
const childControlsDisabled = computed(() => disabled || !toolbar.value)
</script>

<template>
  <section
    class="mt-3 rounded border border-border bg-input/20 p-2.5"
    :aria-disabled="disabled || undefined"
    data-test-id="plugin-ai-popout-controls"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h5 class="text-[10px] font-medium text-surface">
          {{ dialogs.pluginAIPopoutControls }}
        </h5>
        <p class="mt-0.5 text-[9px] leading-relaxed text-muted">
          {{ dialogs.pluginAIPopoutControlsDescription }}
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded border border-border px-2 py-1 text-[9px] text-muted transition-colors hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="disabled"
        data-test-id="plugin-ai-popout-controls-reset"
        @click="resetAIPopoutControls"
      >
        {{ dialogs.pluginAIPopoutReset }}
      </button>
    </div>

    <div class="mt-2 grid gap-1.5">
      <div class="flex min-h-7 items-center justify-between gap-3 rounded px-1.5">
        <span class="text-[10px] text-surface">
          {{ dialogs.pluginAIPopoutToolbar }}
        </span>
        <AppSwitch
          v-model="toolbar"
          :label="dialogs.pluginAIPopoutToolbar"
          :disabled="disabled"
          data-test-id="plugin-ai-popout-control-toolbar"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginAIPopoutFocusEditor }}
        </span>
        <AppSwitch
          v-model="focusEditor"
          :label="dialogs.pluginAIPopoutFocusEditor"
          :disabled="childControlsDisabled"
          data-test-id="plugin-ai-popout-control-focus-editor"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginAIPopoutAlwaysOnTop }}
        </span>
        <AppSwitch
          v-model="alwaysOnTop"
          :label="dialogs.pluginAIPopoutAlwaysOnTop"
          :disabled="childControlsDisabled"
          data-test-id="plugin-ai-popout-control-always-on-top"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginAIPopoutClearChat }}
        </span>
        <AppSwitch
          v-model="clearChat"
          :label="dialogs.pluginAIPopoutClearChat"
          :disabled="childControlsDisabled"
          data-test-id="plugin-ai-popout-control-clear-chat"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginAIPopoutSettings }}
        </span>
        <AppSwitch
          v-model="settings"
          :label="dialogs.pluginAIPopoutSettings"
          :disabled="childControlsDisabled"
          data-test-id="plugin-ai-popout-control-settings"
        />
      </div>
    </div>
  </section>
</template>
