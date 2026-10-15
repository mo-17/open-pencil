<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { computed, onScopeDispose, ref, useTemplateRef, watch } from 'vue'

import { getEffectPickCatalogEntry, type EffectPickConfigV1 } from '@open-pencil/core/plugins'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import { createEffectPickPreview } from '@/app/effect-pick/preview'
import { animationsEnabled } from '@/app/shell/motion'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

const MAX_PREVIEW_HEIGHT = 240

const { nodeId, config, width, height } = defineProps<{
  nodeId: string
  config: EffectPickConfigV1
  width: number
  height: number
}>()
const panels = usePanelMessages()
const retainedActivity = useRetainedActivity()
const active = computed(() => retainedActivity?.value ?? true)
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const stage = useTemplateRef<HTMLDivElement>('stage')
const availableWidth = ref(0)
let resizeFrame: number | undefined
useResizeObserver(stage, (entries) => {
  const nextWidth = entries[0]?.contentRect.width ?? 0
  if (nextWidth === availableWidth.value) return
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  // The stage height depends on its width; defer that layout change to the next frame.
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    availableWidth.value = nextWidth
  })
})
onScopeDispose(() => {
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
})
const previewSize = computed(() => ({
  width: Number.isFinite(width) ? Math.max(1, width) : 1,
  height: Number.isFinite(height) ? Math.max(1, height) : 1
}))
const previewScale = computed(() =>
  Math.min(
    1,
    (availableWidth.value || previewSize.value.width) / previewSize.value.width,
    MAX_PREVIEW_HEIGHT / previewSize.value.height
  )
)
const viewportStyle = computed(() => ({
  width: `${previewSize.value.width * previewScale.value}px`,
  height: `${previewSize.value.height * previewScale.value}px`
}))
const frameStyle = computed(() => ({
  width: `${previewSize.value.width}px`,
  height: `${previewSize.value.height}px`,
  transform: `scale(${previewScale.value})`
}))
const source = computed(() => getEffectPickCatalogEntry(config.effectId)?.source)
const clicks = ref(0)
const failed = ref(false)
const playing = ref(true)
let preview: ReturnType<typeof createEffectPickPreview> | undefined

function destroyPreview() {
  preview?.destroy()
  preview = undefined
}

watch(
  [frame, active, () => nodeId],
  () => {
    destroyPreview()
    clicks.value = 0
    failed.value = false
    playing.value = true
    if (!frame.value || !active.value) return
    try {
      preview = createEffectPickPreview(frame.value, config, {
        reducedMotion: !animationsEnabled.value,
        onClick: () => {
          clicks.value = Math.min(clicks.value + 1, 999999)
        },
        onError: () => {
          failed.value = true
          playing.value = false
        }
      })
    } catch {
      failed.value = true
      playing.value = false
    }
  },
  { flush: 'sync' }
)

watch(
  () => config,
  (config) => preview?.setConfig(config),
  { deep: true }
)
watch(animationsEnabled, (enabled) => preview?.setReducedMotion(!enabled))
onScopeDispose(destroyPreview)

function play() {
  preview?.play()
  playing.value = true
}
function pause() {
  preview?.pause()
  playing.value = false
}
function replay() {
  preview?.replay()
  playing.value = true
  clicks.value = 0
}
</script>

<template>
  <section :aria-label="panels.effectPickPreviewTitle" class="mb-3 flex flex-col gap-2">
    <h3 class="text-[11px] font-medium text-surface">{{ panels.effectPickPreviewTitle }}</h3>
    <p class="text-[10px] leading-relaxed text-muted">{{ panels.effectPickPreviewHint }}</p>
    <div ref="stage" class="flex w-full justify-center">
      <div
        class="relative shrink-0 overflow-hidden rounded bg-input ring-1 ring-border ring-inset"
        :style="viewportStyle"
      >
        <iframe
          v-if="active"
          ref="frame"
          :aria-label="panels.effectPickPreviewTitle"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          class="block origin-top-left border-0"
          :style="frameStyle"
        />
      </div>
    </div>
    <AppAlert v-if="failed" tone="error" :heading="panels.effectPickPreviewError" />
    <div class="flex flex-wrap items-center gap-1">
      <AppButton color="neutral" variant="outline" size="sm" :disabled="failed" @click="play">
        <icon-lucide-play class="size-3" />{{ panels.effectPickPreviewPlay }}
      </AppButton>
      <AppButton
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="failed || !playing"
        @click="pause"
      >
        <icon-lucide-pause class="size-3" />{{ panels.effectPickPreviewPause }}
      </AppButton>
      <AppButton color="neutral" variant="outline" size="sm" :disabled="failed" @click="replay">
        <icon-lucide-rotate-ccw class="size-3" />{{ panels.effectPickPreviewReplay }}
      </AppButton>
    </div>
    <p v-if="clicks" role="status" class="text-[10px] text-muted">
      {{ panels.effectPickPreviewClicked({ count: clicks }) }}
    </p>
    <a
      v-if="source"
      :href="source.url"
      target="_blank"
      rel="noopener noreferrer"
      class="text-[10px] text-primary underline"
    >
      {{ panels.effectPickSource }} · {{ source.authorName }}
    </a>
    <p class="text-[10px] leading-relaxed text-muted">
      <code>{{ source?.license }}</code> · {{ panels.effectPickLicense }}
    </p>
  </section>
</template>
