<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { computed, watch } from 'vue'

import { useI18n } from '@open-pencil/vue'
import {
  aiPopoutBusy,
  aiPopoutOpen,
  focusActiveAIPopout,
  setAIPopoutDisabled
} from '@/app/ai/popout/session'
import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { appPluginStore, appPluginStoreSnapshot } from '@/app/plugins/app'
import { runInstalledPluginCommand } from '@/app/plugins/host'
import { AI_POPOUT_COMMAND, AI_POPOUT_PLUGIN_ID } from '@/app/plugins/host/ids'
import { toast } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'

import ChatPanel from './ChatPanel.vue'
import CodePanel from './CodePanel.vue'
import DesignPanel from './DesignPanel.vue'
import ZoomDropdown from './editor/ZoomDropdown.vue'
import Tip from './ui/Tip.vue'

const { activeTab } = useAIChat()
const store = useEditorStore()
const { dialogs, panels } = useI18n()
const desktopAvailable = isTauri()
const aiPopoutCommand = computed(() => {
  void appPluginStoreSnapshot.value
  return appPluginStore.command(AI_POPOUT_PLUGIN_ID, AI_POPOUT_COMMAND.commandId)
})
const aiPopoutReady = computed(() => aiPopoutCommand.value !== null && !aiPopoutBusy.value)
const aiPopoutLabel = computed(() =>
  aiPopoutOpen.value ? dialogs.value.aiPopoutFocus : dialogs.value.aiPopoutOpen
)

async function openOrFocusAIPopout(): Promise<void> {
  const installed = aiPopoutCommand.value
  if (!installed || aiPopoutBusy.value) return
  try {
    if (aiPopoutOpen.value) {
      await focusActiveAIPopout()
      return
    }
    await runInstalledPluginCommand(store, installed.plugin, installed.contribution)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}

watch(
  aiPopoutCommand,
  (command) => {
    void setAIPopoutDisabled(command === null)
  },
  { immediate: true }
)
</script>

<template>
  <aside
    data-test-id="properties-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-panel"
    style="contain: paint layout style"
  >
    <TabsRoot v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
      <TabsList class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <TabsTrigger
          value="design"
          data-test-id="properties-tab-design"
          class="relative rounded px-2.5 py-1 text-[11px] text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface after:absolute after:inset-x-2 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent"
        >
          {{ panels.design }}
        </TabsTrigger>
        <TabsTrigger
          value="code"
          data-test-id="properties-tab-code"
          class="relative flex items-center gap-1 rounded px-2.5 py-1 text-[11px] text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface after:absolute after:inset-x-2 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent"
        >
          <icon-lucide-code class="size-3" />
          {{ panels.code }}
        </TabsTrigger>
        <TabsTrigger
          value="ai"
          data-test-id="properties-tab-ai"
          class="relative flex items-center gap-1 rounded px-2.5 py-1 text-[11px] text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface after:absolute after:inset-x-2 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent"
        >
          <icon-lucide-sparkles class="size-3" />
          {{ panels.ai }}
        </TabsTrigger>
        <ZoomDropdown v-if="activeTab === 'design'" />
        <Tip
          v-if="desktopAvailable && activeTab === 'ai' && aiPopoutCommand"
          :label="aiPopoutLabel"
        >
          <button
            type="button"
            data-test-id="ai-popout-toggle"
            :aria-label="aiPopoutLabel"
            :aria-pressed="aiPopoutOpen"
            class="ml-auto flex size-7 shrink-0 items-center justify-center rounded text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            :class="aiPopoutOpen ? 'bg-hover text-surface' : undefined"
            :disabled="!aiPopoutReady"
            @click="openOrFocusAIPopout"
          >
            <icon-lucide-loader-circle v-if="aiPopoutBusy" class="size-3.5 animate-spin" />
            <icon-lucide-picture-in-picture-2 v-else class="size-3.5" />
          </button>
        </Tip>
      </TabsList>

      <TabsContent
        value="design"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'design'"
      >
        <DesignPanel />
      </TabsContent>

      <TabsContent
        value="code"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'code'"
      >
        <CodePanel />
      </TabsContent>

      <TabsContent
        value="ai"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'ai'"
      >
        <ChatPanel />
      </TabsContent>
    </TabsRoot>
  </aside>
</template>
