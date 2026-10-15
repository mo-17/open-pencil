<script setup lang="ts">
import { computed } from 'vue'

import { selectTarget } from '@open-pencil/vue'

import { useCollabPanelContext } from '@/components/collab-panel/context'
import { roomStatusText } from '@/components/collab-room/statusText'
import { useRoomActions } from '@/components/collab-room/useRoomActions'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { roomStatus } from '@/theme/collaboration/room-status'

const collab = useCollabPanelContext()
const room = useRoomActions()
const ui = roomStatus()

const statusText = computed(() =>
  roomStatusText(collab.messages, collab.state.status ?? 'connecting', collab.state.peers.length)
)
</script>

<template>
  <p :class="ui.root()" :data-status="collab.state.status" data-test-id="collab-room-status">
    <span :class="ui.dot()" aria-hidden="true" />
    {{ statusText }}
  </p>

  <div class="mb-1.5 text-xs font-medium text-surface">{{ collab.messages.roomLink }}</div>
  <div class="mb-3 flex items-center gap-1.5">
    <AppInput
      :model-value="collab.shareURL"
      readonly
      :aria-label="collab.messages.roomLink"
      data-test-id="collab-room-link"
      class="min-w-0 flex-1"
      @focus="selectTarget($event)"
    />
    <AppButton
      color="primary"
      variant="solid"
      data-test-id="collab-copy-link"
      @click="collab.copyLink"
    >
      <template #leading>
        <icon-lucide-check v-if="collab.copied" class="size-3" />
        <icon-lucide-copy v-else class="size-3" />
      </template>
      {{ collab.copied ? collab.messages.linkCopied : collab.messages.copyLink }}
    </AppButton>
  </div>

  <label for="collab-room-name-input" class="mb-1 block text-xs text-muted">
    {{ collab.messages.yourName }}
  </label>
  <AppInput
    id="collab-room-name-input"
    v-model="collab.nameDraft"
    data-test-id="collab-name-input"
    :placeholder="collab.state.localName"
    @enter="collab.saveName"
    @change="collab.saveName"
  />

  <div class="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
    <p
      v-if="room.desktopLink.value"
      class="flex shrink-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-muted"
    >
      <a
        :href="room.desktopLink.value"
        class="text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
        data-test-id="collab-open-desktop"
      >
        {{ collab.messages.openInDesktopApp }}
      </a>
      <template v-if="room.downloadURL.value">
        <span aria-hidden="true">·</span>
        <a
          :href="room.downloadURL.value"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          data-test-id="collab-download-desktop"
        >
          {{ collab.messages.downloadDesktopApp }}
        </a>
      </template>
    </p>
    <span v-else />
    <AppButton
      color="neutral"
      variant="ghost"
      data-test-id="collab-leave"
      @click="collab.disconnect"
    >
      {{ collab.messages.leaveRoom }}
    </AppButton>
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
</template>
