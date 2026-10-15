<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useEventListener } from '@vueuse/core'
import { MotionConfig } from 'motion-v'
import { TooltipProvider } from 'reka-ui'
import { defineAsyncComponent, onMounted, watch, computed } from 'vue'

import { provideEditor, useI18n } from '@open-pencil/vue'

import { useDocumentCloseProtection } from '@/app/document/close/use'
import { useFollowingEditorStore } from '@/app/editor/active-store'
import { applicationRuntimeGuideOpen } from '@/app/help/application-runtime-guide'
import {
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  ONEDRIVE_STORAGE_PROVIDER_ID,
  storageProviderPluginState
} from '@/app/integrations/storage'
import { ALIYUN_DRIVE_STORAGE_PROVIDER_ID } from '@/app/integrations/storage/aliyun-drive/config'
import { BAIDU_NETDISK_STORAGE_PROVIDER_ID } from '@/app/integrations/storage/baidu-netdisk/config'
import { useApplicationRuntimeGuideMenu } from '@/app/shell/menu/help-actions'
import { animationsEnabled } from '@/app/shell/motion'
import { useAppTheme } from '@/app/shell/theme'
import { toast } from '@/app/shell/ui'
import { useRestartApprovals } from '@/app/shell/updater/approvals'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater/check'
import { kickSyncEngine, resumeStorageSync } from '@/app/storage/sync'
import { prepareForReload } from '@/app/tabs'
import UnsavedChangesDialog from '@/components/document/UnsavedChangesDialog.vue'
import PublishLibraryDialog from '@/components/libraries/PublishLibraryDialog.vue'
import LibraryUpdateReviewDialog from '@/components/libraries/review/LibraryUpdateReviewDialog.vue'
import RecoveryDialog from '@/components/recovery/RecoveryDialog.vue'
import AISetupDialog from '@/components/settings/ai-setup/AISetupDialog.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import UsageStatsPrompt from '@/components/sharing/UsageStatsPrompt.vue'
import AppShell from '@/components/shell/AppShell.vue'
import Toaster from '@/components/shell/Toaster.vue'
import VoiceCallAudio from '@/components/voice-call/VoiceCallAudio.vue'

const { updates, locale } = useI18n()
const ApplicationRuntimeGuideDialog = defineAsyncComponent(
  () => import('@/components/help/ApplicationRuntimeGuideDialog.vue')
)

useHead({
  titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil'),
  htmlAttrs: {
    lang: locale,
    'data-motion': computed(() => (animationsEnabled.value ? 'full' : 'off'))
  }
})

provideEditor(useFollowingEditorStore())
useAppTheme()
useApplicationRuntimeGuideMenu()

watch(
  () =>
    [
      storageProviderPluginState(GOOGLE_DRIVE_STORAGE_PROVIDER_ID),
      storageProviderPluginState(ONEDRIVE_STORAGE_PROVIDER_ID),
      storageProviderPluginState(ALIYUN_DRIVE_STORAGE_PROVIDER_ID),
      storageProviderPluginState(BAIDU_NETDISK_STORAGE_PROVIDER_ID)
    ] as const,
  (states, previousStates) => {
    if (
      states.some((state, index) => state === 'enabled' && previousStates?.[index] !== 'enabled')
    ) {
      void resumeStorageSync()
    }
  },
  { immediate: true }
)

useDocumentCloseProtection()
useRestartApprovals()
useEventListener(window, 'pagehide', () => {
  void prepareForReload()
})

onMounted(() => {
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(updates)
  void kickSyncEngine()
})
</script>

<template>
  <MotionConfig :reduced-motion="animationsEnabled ? 'never' : 'always'">
    <TooltipProvider :delay-duration="400">
      <AppShell>
        <RouterView />
      </AppShell>
      <SettingsDialog />
      <ApplicationRuntimeGuideDialog v-if="applicationRuntimeGuideOpen" />
      <AISetupDialog />
      <RecoveryDialog />
      <UnsavedChangesDialog />
      <PublishLibraryDialog />
      <LibraryUpdateReviewDialog />
      <UsageStatsPrompt />
      <Toaster />
      <VoiceCallAudio />
    </TooltipProvider>
  </MotionConfig>
</template>
