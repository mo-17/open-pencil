<script setup lang="ts">
import { onMounted } from 'vue'
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'

import { provideEditor } from '@open-pencil/vue'
import AppToast from '@/components/Shell/AppToast.vue'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import { useAppTheme } from '@/app/shell/theme'

useHead({ titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil') })

const store = useEditorStore()
provideEditor(store)
useAppTheme()

onMounted(() => {
  toast.setupGlobalErrorHandler()
  // Startup auto-update check is paused — re-enable by restoring the import
  // of `scheduleStartupUpdateCheck` from '@/app/shell/updater' and calling
  // `scheduleStartupUpdateCheck(dialogs)` here.
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <RouterView />
    <AppToast />
  </TooltipProvider>
</template>
