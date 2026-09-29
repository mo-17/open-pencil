<script setup lang="ts">
import { DialogClose, DialogDescription, DialogTitle } from 'reka-ui'
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { usePanelMessages, useCommonMessages } from '@open-pencil/vue'

import type { LocalAsset } from '@/app/assets/types'
import { useEditorStore } from '@/app/editor/active-store'
import { nodeIcon } from '@/app/editor/icons'
import { openExternalLink } from '@/app/shell/ui'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialogRoot, useDialogUI } from '@/components/ui/dialog'

const { asset, busy, error } = defineProps<{
  asset: LocalAsset | null
  busy: boolean
  error: string
}>()
const emit = defineEmits<{ insert: [] }>()
const open = defineModel<boolean>('open', { required: true })
const editor = useEditorStore()
const panels = usePanelMessages()
const common = useCommonMessages()
const dialog = useDialogUI()
const previewURL = shallowRef<string>()
const previewLoading = ref(false)
let previewRequestId = 0
function replacePreview(blob: Blob | null) {
  const previous = previewURL.value
  previewURL.value = blob ? URL.createObjectURL(blob) : undefined
  // The dialog may still be leaving. Remove / replace the img src before revoking its URL,
  // otherwise a pending browser image request can fail with ERR_FILE_NOT_FOUND.
  if (previous) void nextTick(() => URL.revokeObjectURL(previous))
}

function clearPreview() {
  replacePreview(null)
}

async function updatePreview() {
  const requestId = ++previewRequestId
  const nodeId = asset?.componentId
  if (!open.value || !nodeId) {
    clearPreview()
    return
  }

  const node = editor.getNode(nodeId)
  if (!node) {
    clearPreview()
    return
  }

  previewLoading.value = true
  try {
    const maxSize = Math.max(node.width, node.height, 1)
    const scale = Math.min(176 / maxSize, 2)
    const graph = editor.graph
    const data = await editor.renderExportImage([nodeId], scale, 'PNG', asset?.pageId)
    if (requestId !== previewRequestId || editor.graph !== graph) return
    replacePreview(data ? new Blob([data], { type: 'image/png' }) : null)
  } catch {
    if (requestId === previewRequestId) clearPreview()
  } finally {
    if (requestId === previewRequestId) previewLoading.value = false
  }
}

watch(
  [open, () => asset?.componentId, () => editor.graph, () => editor.state.sceneVersion],
  updatePreview,
  {
    flush: 'post'
  }
)
onBeforeUnmount(() => {
  previewRequestId++
  clearPreview()
})
</script>
<template>
  <AppDialogRoot v-if="asset" v-model:open="open" size="lg" data-test-id="asset-details-dialog">
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <component :is="nodeIcon(asset.node)" class="size-4 shrink-0 text-component" />
        <div class="min-w-0">
          <DialogTitle :class="dialog.title" class="truncate">{{ asset.name }}</DialogTitle>
          <DialogDescription class="mt-0.5 text-[11px] text-muted">
            {{ asset.node.type === 'COMPONENT_SET' ? panels.componentSet : panels.component }}
            <span v-if="asset.variantCount > 0"> · {{ asset.variantCount }} variants</span>
          </DialogDescription>
        </div>
      </div>
      <DialogClose
        data-test-id="asset-details-close"
        :aria-label="common.close"
        class="flex size-7 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
      >
        <icon-lucide-x class="size-4" />
      </DialogClose>
    </div>

    <div class="grid min-h-0 grid-cols-[260px_1fr] gap-0">
      <div class="border-r border-border p-4">
        <div
          data-test-id="asset-details-preview"
          class="flex h-36 items-center justify-center overflow-hidden rounded-lg border border-border bg-canvas/60"
        >
          <img
            v-if="previewURL"
            data-test-id="asset-details-preview-image"
            :src="previewURL"
            :alt="`${asset.name} preview`"
            class="max-h-[120px] max-w-[210px] object-contain"
          />
          <div v-else class="text-center">
            <icon-lucide-loader-2
              v-if="previewLoading"
              class="mx-auto size-5 animate-spin motion-reduce:animate-none text-muted"
            />
            <component v-else :is="nodeIcon(asset.node)" class="mx-auto size-8 text-component" />
            <p class="mt-2 max-w-44 truncate text-xs font-medium text-surface">
              {{ asset.name }}
            </p>
          </div>
        </div>
        <AppButton
          color="primary"
          variant="solid"
          size="md"
          :disabled="busy"
          data-test-id="asset-details-insert"
          class="mt-3 w-full"
          @click="emit('insert')"
        >
          {{ panels.insertInstance }}
        </AppButton>
        <p v-if="error" role="alert" class="mt-2 text-xs text-warning">{{ error }}</p>
      </div>

      <div class="min-w-0 p-4">
        <section v-if="asset.description" class="mb-4">
          <h3 class="text-[11px] font-medium tracking-wider text-muted uppercase">
            {{ panels.description }}
          </h3>
          <p data-test-id="asset-details-description" class="mt-1 text-xs leading-5 text-surface">
            {{ asset.description }}
          </p>
        </section>

        <section v-if="asset.sourceLibraryKey" class="mb-4">
          <h3 class="text-[11px] font-medium tracking-wider text-muted uppercase">
            {{ panels.assetLibraryBadge }}
          </h3>
          <p data-test-id="asset-details-library" class="mt-1 break-all text-xs text-muted">
            {{ asset.sourceLibraryKey }}
          </p>
        </section>

        <section v-if="asset.docsURL" class="mb-4">
          <h3 class="text-[11px] font-medium tracking-wider text-muted uppercase">
            {{ panels.documentation }}
          </h3>
          <AppButton
            color="primary"
            variant="link"
            size="xs"
            data-test-id="asset-details-docs"
            class="mt-1"
            @click="asset.docsURL ? openExternalLink(asset.docsURL) : undefined"
          >
            <icon-lucide-book-open class="size-3" />
            {{ panels.openDocs }}
          </AppButton>
        </section>

        <section v-if="asset.variants.length > 0">
          <h3 class="text-[11px] font-medium tracking-wider text-muted uppercase">
            {{ panels.properties }}
          </h3>
          <div class="mt-2 flex flex-col gap-2">
            <div
              v-for="variant in asset.variants"
              :key="variant.name"
              data-test-id="asset-details-property"
              class="rounded border border-border bg-input/40 px-2 py-1.5"
            >
              <div class="text-xs font-medium text-surface">{{ variant.name }}</div>
              <div class="mt-1 text-[11px] text-muted">{{ variant.values.join(', ') }}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </AppDialogRoot>
</template>
