<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

import { usePopoverUI } from '@/components/ui/popover'

import type { PreviewRefreshPolicy } from './compile-scheduler'
import type { PreviewTarget, PreviewUIKit } from './use-compile-on-change'

const {
  summary,
  iconOnly = false,
  showTarget = false
} = defineProps<{
  summary: string
  iconOnly?: boolean
  showTarget?: boolean
}>()

const target = defineModel<PreviewTarget>('target', { required: true })
const uiKit = defineModel<PreviewUIKit>('uiKit', { required: true })
const theme = defineModel<'light' | 'dark'>('theme', { required: true })
const i18nEnabled = defineModel<boolean>('i18nEnabled', { required: true })
const localesInput = defineModel<string>('localesInput', { required: true })
const refreshPolicy = defineModel<PreviewRefreshPolicy>('refreshPolicy', { required: true })

const popoverUI = usePopoverUI({
  content: 'z-[120] w-72 rounded-lg border border-border p-3'
})
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button
        type="button"
        data-test-id="lowcode-preview-settings-toggle"
        aria-label="Preview settings"
        class="flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded border border-border bg-input px-2 text-xs text-surface outline-none transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent"
      >
        <icon-lucide-sliders-horizontal class="size-3.5 shrink-0 text-muted" />
        <span v-if="!iconOnly" class="max-w-40 truncate">{{ summary }}</span>
        <icon-lucide-chevron-down v-if="!iconOnly" class="size-3 shrink-0 text-muted" />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="lowcode-preview-settings-panel"
        :class="popoverUI.content"
        :side-offset="6"
        side="bottom"
        align="end"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-xs font-medium text-surface">Preview settings</h2>
          <span class="text-[10px] text-muted"
            >Target · {{ target === 'vue' ? 'Vue 3' : 'React' }}</span
          >
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-x-3 gap-y-2.5">
          <template v-if="showTarget">
            <label for="lowcode-preview-popover-target" class="text-[11px] text-muted">
              Target
            </label>
            <select
              id="lowcode-preview-popover-target"
              v-model="target"
              data-test-id="lowcode-preview-target"
              class="h-7 rounded border border-border bg-input px-2 text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <option value="react">React</option>
              <option value="vue">Vue 3</option>
            </select>
          </template>

          <label for="lowcode-preview-uikit" class="text-[11px] text-muted">UI components</label>
          <select
            id="lowcode-preview-uikit"
            v-model="uiKit"
            :disabled="target === 'vue'"
            data-test-id="lowcode-preview-uikit"
            class="h-7 rounded border border-border bg-input px-2 text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50"
          >
            <option value="none">Tailwind</option>
            <option value="shadcn">shadcn/ui</option>
          </select>

          <label for="lowcode-preview-theme" class="text-[11px] text-muted">Theme</label>
          <select
            id="lowcode-preview-theme"
            v-model="theme"
            data-test-id="lowcode-preview-theme"
            class="h-7 rounded border border-border bg-input px-2 text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>

          <label for="lowcode-preview-refresh-policy" class="text-[11px] text-muted">
            Refresh policy
          </label>
          <select
            id="lowcode-preview-refresh-policy"
            v-model="refreshPolicy"
            data-test-id="lowcode-preview-refresh-policy"
            class="h-7 rounded border border-border bg-input px-2 text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <option value="realtime">Real-time</option>
            <option value="auto">Auto</option>
            <option value="manual">Manual</option>
          </select>

          <span class="text-[11px] text-muted">i18n</span>
          <label
            class="flex h-7 items-center justify-end gap-2 text-[11px] text-muted"
            :class="target === 'vue' ? 'opacity-50' : ''"
          >
            <input
              v-model="i18nEnabled"
              :disabled="target === 'vue'"
              type="checkbox"
              data-test-id="lowcode-preview-i18n"
            />
            <span>{{ i18nEnabled ? 'On' : 'Off' }}</span>
          </label>
        </div>

        <label v-if="i18nEnabled" class="mt-3 block text-[11px] text-muted">
          Locales
          <input
            v-model="localesInput"
            type="text"
            data-test-id="lowcode-preview-locales"
            placeholder="ar, fr"
            class="mt-1 h-7 w-full rounded border border-border bg-input px-2 text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
        </label>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
