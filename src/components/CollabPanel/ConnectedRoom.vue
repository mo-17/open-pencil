<script setup lang="ts">
import { colorToCSS } from '@open-pencil/core/color'
import { selectTarget } from '@open-pencil/vue'

import AppInput from '@/components/ui/AppInput.vue'
import { useCollabPanelContext } from '@/components/CollabPanel/context'

const collab = useCollabPanelContext()
</script>

<template>
  <div class="mb-3 text-xs font-medium text-surface">{{ collab.dialogs.roomLink }}</div>
  <div class="mb-3 flex items-center gap-1.5">
    <AppInput
      :model-value="collab.shareURL"
      readonly
      data-test-id="collab-room-link"
      class="min-w-0 flex-1"
      @focus="selectTarget($event)"
    />
    <button
      data-test-id="collab-copy-link"
      class="flex h-7 cursor-pointer items-center gap-1 rounded border-none bg-accent px-2 text-xs text-white hover:bg-accent/90"
      @click="collab.copyLink"
    >
      <icon-lucide-check v-if="collab.copied" class="size-3" />
      <icon-lucide-copy v-else class="size-3" />
      {{ collab.copied ? 'Copied' : 'Copy' }}
    </button>
  </div>

  <div class="mb-2 text-xs font-medium text-surface">
    {{ collab.peers.length + 1 }} {{ collab.peers.length === 0 ? 'person' : 'people' }} in this room
  </div>

  <!-- §4.3 — self-host signaling indicator (only when not on the public broker). -->
  <div
    v-if="collab.signalingLabel"
    data-test-id="collab-signaling"
    class="mb-3 flex items-center gap-1 text-[10px] text-muted"
  >
    <icon-lucide-server class="size-3 shrink-0" />
    {{ collab.signalingLabel }}
  </div>

  <div
    v-if="collab.motionConflictCount > 0"
    data-test-id="motion-collab-conflicts"
    class="mb-3 rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning"
  >
    <div class="flex items-center gap-2">
      <icon-lucide-triangle-alert class="size-3 shrink-0" />
      <span class="min-w-0 flex-1">
        {{
          collab.dialogs.motionTimelineConflictCount({ count: String(collab.motionConflictCount) })
        }}
      </span>
      <button
        type="button"
        class="shrink-0 underline underline-offset-2"
        @click="collab.clearMotionConflicts"
      >
        {{ collab.dialogs.motionTimelineConflictClear }}
      </button>
    </div>
    <ul class="mt-1 max-h-28 space-y-1 overflow-y-auto border-t border-warning/20 pt-1">
      <li
        v-for="(conflict, index) in collab.motionConflicts"
        :key="`${conflict.nodeId}:${conflict.trackId ?? ''}:${conflict.keyframeId ?? ''}:${conflict.code}:${index}`"
        class="leading-4"
        data-test-id="motion-collab-conflict-detail"
      >
        <p class="break-all font-medium">
          {{ conflict.code }} · {{ conflict.nodeId }}
          <template v-if="conflict.trackId"> · {{ conflict.trackId }}</template>
          <template v-if="conflict.keyframeId"> · {{ conflict.keyframeId }}</template>
        </p>
        <p class="break-words text-muted">{{ conflict.message }}</p>
      </li>
    </ul>
  </div>

  <!-- §4.4 — per-peer roster with what each collaborator is editing. -->
  <div class="mb-3 flex flex-col gap-1.5">
    <div class="flex items-center gap-2">
      <span
        class="size-2 shrink-0 rounded-full"
        :style="{ background: colorToCSS(collab.state.localColor) }"
      />
      <span class="min-w-0 flex-1 truncate text-xs text-surface">
        {{ collab.state.localName || 'You' }}
      </span>
      <span class="shrink-0 text-[10px] text-muted">you</span>
    </div>

    <div
      v-for="peer in collab.peers"
      :key="peer.clientId"
      data-test-id="collab-peer-row"
      class="flex items-center gap-2"
    >
      <span class="size-2 shrink-0 rounded-full" :style="{ background: colorToCSS(peer.color) }" />
      <span class="min-w-0 flex-1 truncate text-xs text-surface">{{ peer.name }}</span>
      <span
        v-if="collab.peerEditingLabel(peer)"
        data-test-id="collab-peer-editing"
        class="min-w-0 max-w-[55%] shrink truncate text-[10px] text-muted"
      >
        {{ collab.peerEditingLabel(peer) }}
      </span>
    </div>
  </div>

  <button
    data-test-id="collab-disconnect"
    class="flex h-7 w-full cursor-pointer items-center justify-center rounded border border-border bg-transparent text-xs text-muted hover:bg-hover hover:text-surface"
    @click="collab.disconnect"
  >
    Disconnect
  </button>
</template>
