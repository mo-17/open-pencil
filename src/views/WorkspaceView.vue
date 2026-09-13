<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useEventListener } from '@vueuse/core'
import { onMounted, onUnmounted, provide, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useI18n } from '@open-pencil/vue'

import { startMCPRuntime, stopMCPRuntime } from '@/app/automation/mcp/runtime'
import { exposeCollaborationActions } from '@/app/browser-bridge'
import { usesTestCollabTransport } from '@/app/collab/transport/policy'
import { COLLAB_KEY, useCollab } from '@/app/collab/use'
import { createDemoShapes } from '@/app/demo/document'
import { appRuntimeConfig } from '@/app/runtime/config'
import { useKeyboard } from '@/app/shell/keyboard/use'
import { openFileFromPath, useEditorMenu } from '@/app/shell/menu/use'
import { toast } from '@/app/shell/ui'
import {
  activeTab,
  createDocumentInCurrentTab,
  createHomeTab,
  createTab,
  getActiveStore,
  tabCount
} from '@/app/tabs'
import { isTauri } from '@/app/tauri/env'
import CommandPalette from '@/components/commands/CommandPalette.vue'
import EditorWorkspace from '@/components/editor/EditorWorkspace.vue'
import FontStatusBanner from '@/components/font-status/FontStatusBanner.vue'
import HomeWorkspace from '@/components/home/HomeWorkspace.vue'
import SafariBanner from '@/components/SafariBanner.vue'
import RenameSelectionDialog from '@/components/selection/RenameSelectionDialog.vue'
import TabBar from '@/components/TabBar.vue'

const route = useRoute()
const createdInitialTab = tabCount() === 0
const shouldCreateHome =
  route.path === '/' &&
  !appRuntimeConfig.test &&
  !route.meta.demo &&
  (isTauri() || appRuntimeConfig.recentFiles)
let firstTab = activeTab.value
if (!firstTab) firstTab = shouldCreateHome ? createHomeTab() : createTab()

if (createdInitialTab && route.meta.demo && !appRuntimeConfig.test) {
  void createDemoShapes(firstTab.store)
}

useHead({ title: route.meta.demo ? 'Demo' : undefined })
useKeyboard()
useEditorMenu()

const collab = useCollab(getActiveStore)
provide(COLLAB_KEY, collab)
exposeCollaborationActions(collab)
const { dialogs } = useI18n()

collab.onDocStateConflict((kind) => {
  const target =
    kind === 'state' ? dialogs.value.presenceTargetState : dialogs.value.presenceTargetDocState
  toast.warning(dialogs.value.presenceConflictToast({ target }))
})

useEventListener(
  document,
  'wheel',
  (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault()
  },
  { passive: false }
)

const fileAssociationCleanup = ref<(() => void) | null>(null)
const mcpRuntimeEnabled = import.meta.env.MODE !== 'native-test' && !usesTestCollabTransport()

interface PendingOpenFile {
  path: string
}

async function openPendingAssociatedFiles(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  const files = await invoke<PendingOpenFile[]>('take_pending_open')
  for (const file of files) await openFileFromPath(file.path)
}

async function bindAssociatedFileOpen(): Promise<void> {
  if (!isTauri()) return
  const { listen } = await import('@tauri-apps/api/event')
  fileAssociationCleanup.value = await listen('open-associated-files', () => {
    void openPendingAssociatedFiles().catch((error) => console.error('[Open With]', error))
  })
  await openPendingAssociatedFiles()
}

onMounted(async () => {
  if (mcpRuntimeEnabled) await startMCPRuntime(getActiveStore)

  try {
    await bindAssociatedFileOpen()
  } catch (error) {
    console.error('[Open With]', error)
  }
})

onUnmounted(() => {
  if (mcpRuntimeEnabled) void stopMCPRuntime()
  fileAssociationCleanup.value?.()
})
</script>

<template>
  <div data-test-id="editor-root" class="flex h-screen w-screen flex-col">
    <SafariBanner />
    <FontStatusBanner />
    <RenameSelectionDialog />
    <CommandPalette />
    <TabBar />
    <HomeWorkspace v-show="activeTab?.kind === 'home'" @new-document="createDocumentInCurrentTab" />
    <EditorWorkspace v-if="activeTab?.kind !== 'home'" />
  </div>
</template>
