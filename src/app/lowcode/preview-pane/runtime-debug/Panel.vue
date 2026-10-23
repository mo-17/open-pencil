<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import Tip from '@/components/ui/overlay/Tip.vue'

import { runtimeDebugCopy } from './copy'
import type { RuntimeDebugEntry } from './protocol'

const { entries, recording, available, dropped } = defineProps<{
  entries: readonly RuntimeDebugEntry[]
  recording: boolean
  available: boolean
  dropped: number
}>()
const emit = defineEmits<{
  record: [enabled: boolean]
  clear: []
  close: []
  select: [nodeId: string]
}>()
const { locale } = useI18n()
const copy = computed(() => runtimeDebugCopy(locale.value))
</script>

<template>
  <section
    id="lowcode-runtime-debug"
    data-property="runtime-debug"
    :aria-label="copy.title"
    class="max-h-64 shrink-0 overflow-auto border-t border-border bg-panel text-xs text-surface"
  >
    <div class="sticky top-0 flex flex-wrap items-center gap-2 bg-panel px-2 py-1.5">
      <h2 class="font-medium">{{ copy.title }}</h2>
      <span role="status" class="min-w-0 flex-1 text-muted">
        {{ available ? (recording ? copy.recording : copy.paused) : copy.waiting }} ·
        {{ entries.length }}
      </span>
      <AppButton
        size="xs"
        variant="outline"
        :disabled="!available"
        @click="emit('record', !recording)"
      >
        {{ recording ? copy.pause : copy.record }}
      </AppButton>
      <AppButton size="xs" :disabled="!entries.length" @click="emit('clear')">{{
        copy.clear
      }}</AppButton>
      <Tip :label="copy.close">
        <AppButton size="xs" :aria-label="copy.close" @click="emit('close')"
          ><icon-lucide-x class="size-3"
        /></AppButton>
      </Tip>
    </div>
    <p class="border-t border-border px-2 py-1.5 text-muted">{{ copy.hint }}</p>
    <AppAlert
      v-if="!available"
      tone="info"
      :heading="copy.waiting"
      :description="copy.unavailable"
    />
    <p v-if="!entries.length" class="px-2 py-2 text-muted">{{ copy.empty }}</p>
    <ol v-else class="divide-y divide-border border-t border-border">
      <li
        v-for="entry in entries"
        :key="entry.sequence"
        :data-kind="entry.kind"
        :data-status="entry.status"
        :data-trace="entry.trace"
        class="flex items-start gap-2 px-2 py-1.5 data-[status=error]:text-error"
      >
        <span class="w-14 shrink-0 text-muted">{{ copy.trace }} {{ entry.trace }}</span>
        <span class="min-w-0 flex-1 break-words">
          {{ copy.kinds[entry.kind] }} · <code>{{ entry.label }}</code> ·
          {{ copy.statuses[entry.status] }}
          <span v-if="entry.durationMs !== null" class="text-muted">
            · {{ entry.durationMs }} ms</span
          >
        </span>
        <AppButton
          v-if="entry.nodeId"
          size="xs"
          :aria-label="copy.select"
          @click="emit('select', entry.nodeId)"
        >
          <icon-lucide-locate-fixed class="size-3" />
        </AppButton>
      </li>
    </ol>
    <p v-if="dropped" role="status" class="px-2 py-1.5 text-muted">
      {{ dropped }} {{ copy.omitted }}
    </p>
  </section>
</template>
