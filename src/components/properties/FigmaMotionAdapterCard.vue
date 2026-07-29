<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { MotionSpec } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { createFigmaMotionAdapterView } from '@/app/properties/figma-motion-adapter'

const { motion, opacity } = defineProps<{ motion: MotionSpec; opacity: number }>()
const { panels } = useI18n()
const copied = ref(false)
const copyError = ref('')
const adapter = computed(() => createFigmaMotionAdapterView({ motion, opacity }))
const firstIssue = computed(() => adapter.value.plan.issues[0]?.message ?? '')

watch(
  () => [motion, opacity] as const,
  () => {
    copied.value = false
    copyError.value = ''
  }
)

async function copyScript() {
  const script = adapter.value.script
  if (!script) return
  try {
    await navigator.clipboard.writeText(script)
    copied.value = true
    copyError.value = ''
  } catch (error) {
    copied.value = false
    copyError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <fieldset class="mt-3" data-test-id="figma-motion-adapter">
    <legend class="mb-1.5 text-[11px] text-muted">{{ panels.motionFigmaNative }}</legend>
    <div class="space-y-1.5 rounded border border-border bg-input/40 p-2">
      <p
        class="text-[11px] leading-4"
        :class="adapter.plan.supported ? 'text-surface' : 'text-warning'"
        data-test-id="figma-motion-status"
      >
        {{ adapter.plan.supported ? panels.motionFigmaCompatible : panels.motionFigmaUnsupported }}
      </p>
      <p v-if="firstIssue" class="text-[10px] leading-4 text-muted">{{ firstIssue }}</p>
      <p class="text-[10px] leading-4 text-muted">{{ panels.motionFigmaSharedHint }}</p>
      <p v-if="copyError" class="text-[10px] leading-4 text-warning" role="alert">
        {{ copyError }}
      </p>
      <button
        type="button"
        data-test-id="figma-motion-copy-script"
        class="h-7 w-full rounded border border-border bg-input px-2 text-[11px] text-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="adapter.script === null"
        @click="copyScript"
        @keydown.stop
      >
        {{ copied ? panels.motionFigmaCopied : panels.motionFigmaCopyScript }}
      </button>
    </div>
  </fieldset>
</template>
