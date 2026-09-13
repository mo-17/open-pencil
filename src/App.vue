<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useEventListener } from '@vueuse/core'
import { MotionConfig } from 'motion-v'
import { TooltipProvider } from 'reka-ui'
import { defineAsyncComponent, onMounted, watch, computed } from 'vue'

import { provideEditor, useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
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
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'
import { kickSyncEngine, resumeStorageSync } from '@/app/storage/sync'
import { prepareForReload } from '@/app/tabs'
import PublishLibraryDialog from '@/components/libraries/PublishLibraryDialog.vue'
import LibraryUpdateReviewDialog from '@/components/libraries/review/LibraryUpdateReviewDialog.vue'
import RecoveryDialog from '@/components/recovery/RecoveryDialog.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import AppShell from '@/components/Shell/AppShell.vue'
import AppToast from '@/components/Shell/AppToast.vue'

const store = useEditorStore()
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

provideEditor(store)
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
      <RecoveryDialog />
      <PublishLibraryDialog />
      <LibraryUpdateReviewDialog />
      <AppToast />
    </TooltipProvider>
  </MotionConfig>
</template>
