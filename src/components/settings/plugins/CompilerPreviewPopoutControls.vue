<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type { CompilerPreviewPopoutControls } from '@/app/lowcode/preview-pane/popout/controls'
import {
  compilerPreviewPopoutControls,
  resetCompilerPreviewPopoutControls
} from '@/app/settings/compiler-preview-popout-controls'
import AppSwitch from '@/components/ui/AppSwitch.vue'

const { disabled = false } = defineProps<{ disabled?: boolean }>()
const { dialogs } = useI18n()

function controlModel(key: keyof CompilerPreviewPopoutControls) {
  return computed<boolean>({
    get: () => compilerPreviewPopoutControls.value[key],
    set: (value) => {
      compilerPreviewPopoutControls.value = {
        ...compilerPreviewPopoutControls.value,
        [key]: value
      }
    }
  })
}

const toolbar = controlModel('toolbar')
const reload = controlModel('reload')
const focusEditor = controlModel('focusEditor')
const alwaysOnTop = controlModel('alwaysOnTop')
const diagnostics = controlModel('diagnostics')
const exportMicrofrontend = controlModel('exportMicrofrontend')
const deploy = controlModel('deploy')
const childControlsDisabled = computed(() => disabled || !toolbar.value)
</script>

<template>
  <section
    class="mt-3 rounded border border-border bg-input/20 p-2.5"
    :aria-disabled="disabled || undefined"
    data-test-id="plugin-compiler-preview-popout-controls"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h5 class="text-[10px] font-medium text-surface">
          {{ dialogs.pluginCompilerPreviewPopoutControls }}
        </h5>
        <p class="mt-0.5 text-[9px] leading-relaxed text-muted">
          {{ dialogs.pluginCompilerPreviewPopoutControlsDescription }}
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded border border-border px-2 py-1 text-[9px] text-muted transition-colors hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="disabled"
        data-test-id="plugin-compiler-preview-popout-controls-reset"
        @click="resetCompilerPreviewPopoutControls"
      >
        {{ dialogs.pluginCompilerPreviewPopoutReset }}
      </button>
    </div>

    <div class="mt-2 grid gap-1.5">
      <div class="flex min-h-7 items-center justify-between gap-3 rounded px-1.5">
        <span class="text-[10px] text-surface">
          {{ dialogs.pluginCompilerPreviewPopoutToolbar }}
        </span>
        <AppSwitch
          v-model="toolbar"
          :label="dialogs.pluginCompilerPreviewPopoutToolbar"
          :disabled="disabled"
          data-test-id="plugin-compiler-preview-popout-control-toolbar"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginCompilerPreviewPopoutReload }}
        </span>
        <AppSwitch
          v-model="reload"
          :label="dialogs.pluginCompilerPreviewPopoutReload"
          :disabled="childControlsDisabled"
          data-test-id="plugin-compiler-preview-popout-control-reload"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginCompilerPreviewPopoutFocusEditor }}
        </span>
        <AppSwitch
          v-model="focusEditor"
          :label="dialogs.pluginCompilerPreviewPopoutFocusEditor"
          :disabled="childControlsDisabled"
          data-test-id="plugin-compiler-preview-popout-control-focus-editor"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginCompilerPreviewPopoutAlwaysOnTop }}
        </span>
        <AppSwitch
          v-model="alwaysOnTop"
          :label="dialogs.pluginCompilerPreviewPopoutAlwaysOnTop"
          :disabled="childControlsDisabled"
          data-test-id="plugin-compiler-preview-popout-control-always-on-top"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginCompilerPreviewPopoutDiagnostics }}
        </span>
        <AppSwitch
          v-model="diagnostics"
          :label="dialogs.pluginCompilerPreviewPopoutDiagnostics"
          :disabled="childControlsDisabled"
          data-test-id="plugin-compiler-preview-popout-control-diagnostics"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginCompilerPreviewPopoutExportMicrofrontend }}
        </span>
        <AppSwitch
          v-model="exportMicrofrontend"
          :label="dialogs.pluginCompilerPreviewPopoutExportMicrofrontend"
          :disabled="childControlsDisabled"
          data-test-id="plugin-compiler-preview-popout-control-export-microfrontend"
        />
      </div>

      <div
        class="ml-3 flex min-h-7 items-center justify-between gap-3 rounded border-l border-border pl-2 pr-1.5"
      >
        <span class="text-[10px] text-muted">
          {{ dialogs.pluginCompilerPreviewPopoutDeploy }}
        </span>
        <AppSwitch
          v-model="deploy"
          :label="dialogs.pluginCompilerPreviewPopoutDeploy"
          :disabled="childControlsDisabled"
          data-test-id="plugin-compiler-preview-popout-control-deploy"
        />
      </div>
    </div>
  </section>
</template>
