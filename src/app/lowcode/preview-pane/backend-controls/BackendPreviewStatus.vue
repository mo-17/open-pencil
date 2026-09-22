<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

const { message, url } = defineProps<{ message: string; url: string }>()
const emit = defineEmits<{ open: [] }>()
const { locale } = useI18n()
const chinese = computed(() => locale.value === 'zh-CN')
</script>

<template>
  <div
    data-test-id="lowcode-preview-local-status"
    class="flex shrink-0 items-center gap-3 border-b border-border bg-panel px-3 py-2 text-xs"
  >
    <div class="min-w-0 flex-1">
      <p role="status" class="text-surface">{{ message }}</p>
      <p class="text-muted">
        {{
          chinese
            ? '登录时会打开系统浏览器，授权后可回到此处继续操作。'
            : 'Sign in through your system browser, then return here to continue.'
        }}
      </p>
      <code class="block select-text truncate text-muted">{{ url }}</code>
    </div>
    <button
      type="button"
      data-test-id="lowcode-preview-local-browser"
      class="shrink-0 rounded bg-accent px-3 py-2 text-white"
      @click="emit('open')"
    >
      {{ chinese ? '在浏览器打开' : 'Open in browser' }}
    </button>
  </div>
</template>
