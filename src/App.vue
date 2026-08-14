<script setup lang="ts">
import { defineAsyncComponent, onMounted, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'

import { provideEditor, useI18n } from '@open-pencil/vue'
import {
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  storageProviderPluginState
} from '@/app/integrations/storage'
import AppShell from '@/components/Shell/AppShell.vue'
import AppToast from '@/components/Shell/AppToast.vue'
import RecoveryDialog from '@/components/recovery/RecoveryDialog.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import { useEditorStore } from '@/app/editor/active-store'
import { applicationRuntimeGuideOpen } from '@/app/help/application-runtime-guide'
import { useApplicationRuntimeGuideMenu } from '@/app/shell/menu/help-actions'
import { toast } from '@/app/shell/ui'
import { useAppTheme } from '@/app/shell/theme'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'
import { kickSyncEngine, resumeStorageSync } from '@/app/storage/sync'
import { prepareForReload } from '@/app/tabs'

const store = useEditorStore()
const { dialogs, locale } = useI18n()
const ApplicationRuntimeGuideDialog = defineAsyncComponent(
  () => import('@/components/help/ApplicationRuntimeGuideDialog.vue')
)

useHead({
  titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil'),
  htmlAttrs: { lang: locale }
})

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

useEventListener(window, 'pagehide', () => {
  void prepareForReload()
})

onMounted(() => {
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(dialogs)
  void kickSyncEngine()
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <AppShell>
      <RouterView />
    </AppShell>
    <SettingsDialog />
    <ApplicationRuntimeGuideDialog v-if="applicationRuntimeGuideOpen" />
    <RecoveryDialog />
    <AppToast />
  </TooltipProvider>
</template>
