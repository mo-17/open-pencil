<script setup lang="ts">
import { defineAsyncComponent, onMounted, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'

import { provideEditor, useI18n } from '@open-pencil/vue'
import {
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  storageProviderPluginState
} from '@/app/integrations/storage'
import AppToast from '@/components/Shell/AppToast.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import { useEditorStore } from '@/app/editor/active-store'
import { applicationRuntimeGuideOpen } from '@/app/help/application-runtime-guide'
import { useApplicationRuntimeGuideMenu } from '@/app/shell/menu/help-actions'
import { toast } from '@/app/shell/ui'
import { useAppTheme } from '@/app/shell/theme'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'
import { kickSyncEngine, resumeStorageSync } from '@/app/storage/sync'

useHead({ titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil') })

const store = useEditorStore()
const { dialogs } = useI18n()
const ApplicationRuntimeGuideDialog = defineAsyncComponent(
  () => import('@/components/help/ApplicationRuntimeGuideDialog.vue')
)
provideEditor(store)
useAppTheme()
useApplicationRuntimeGuideMenu()

watch(
  () => storageProviderPluginState(GOOGLE_DRIVE_STORAGE_PROVIDER_ID),
  (state, previous) => {
    if (state === 'enabled' && previous !== 'enabled') void resumeStorageSync()
  },
  { immediate: true }
)

onMounted(() => {
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(dialogs)
  void kickSyncEngine()
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <RouterView />
    <SettingsDialog />
    <ApplicationRuntimeGuideDialog v-if="applicationRuntimeGuideOpen" />
    <AppToast />
  </TooltipProvider>
</template>
