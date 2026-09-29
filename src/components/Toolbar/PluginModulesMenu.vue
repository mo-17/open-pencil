<script setup lang="ts">
import { useStore } from '@nanostores/vue'
import {
  ToolbarButton,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { tv } from 'tailwind-variants'
import { computed } from 'vue'
import IconPuzzle from '~icons/lucide/puzzle'

import { locale as appLocale, usePanelMessages, useDialogMessages } from '@open-pencil/vue'

import { insertModuleAsset } from '@/app/assets/module-insertion'
import { useEditorStore } from '@/app/editor/active-store'
import { moduleIcon } from '@/app/editor/module-icons'
import {
  appPluginStore,
  appPluginStoreSnapshot,
  inspectInstalledPluginModuleCompatibility
} from '@/app/plugins'
import type { InstalledPluginModule } from '@/app/plugins'
import {
  localizedAppPluginContributionText,
  localizedAppPluginText
} from '@/app/plugins/localization'
import { useActionToast } from '@/app/shell/toast/action'
import type { ToolbarUI } from '@/components/Toolbar/types'
import { menu, useMenuUI } from '@/components/ui/menu/menu'
import Tip from '@/components/ui/overlay/Tip.vue'
import toolbarTheme from '@/theme/toolbar'

const { ui, mobile = false } = defineProps<{
  ui?: ToolbarUI
  mobile?: boolean
}>()

const editor = useEditorStore()
const { showActionToast } = useActionToast()
const panels = usePanelMessages()
const dialogs = useDialogMessages()
const locale = useStore(appLocale)
const toolbar = tv(toolbarTheme)
const styles = computed(() => toolbar({ mobile }))
const menuCls = useMenuUI({ content: 'min-w-48' })
const itemCls = menu({ justify: 'start' }).item({ class: 'gap-2' })

const modules = computed(() => {
  if (!appPluginStoreSnapshot.value.ready) return []
  return appPluginStore
    .installedModules()
    .filter((module) => inspectInstalledPluginModuleCompatibility(module).ok)
    .sort((left, right) => {
      const byName = moduleDisplayName(left).localeCompare(moduleDisplayName(right), locale.value)
      return byName || pluginId(left).localeCompare(pluginId(right))
    })
})

function pluginId(module: InstalledPluginModule): string {
  return module.plugin.package.manifest.plugin.id
}

function moduleDisplayName(module: InstalledPluginModule): string {
  return (
    localizedAppPluginContributionText(
      pluginId(module),
      module.contribution.moduleType,
      locale.value
    )?.name ?? module.contribution.name
  )
}

function pluginDisplayName(module: InstalledPluginModule): string {
  return (
    localizedAppPluginText(pluginId(module), locale.value)?.name ??
    module.plugin.package.manifest.plugin.name
  )
}

function itemTestId(module: InstalledPluginModule): string {
  const suffix = mobile ? '-mobile' : ''
  return `toolbar-plugin-module-${pluginId(module)}-${module.contribution.moduleType}${suffix}`
}

async function addModule(module: InstalledPluginModule): Promise<void> {
  try {
    await insertModuleAsset(editor, module, locale.value, panels.value.assetTargetChanged)
    showActionToast(`${dialogs.value.pluginAddToCanvas}: ${moduleDisplayName(module)}`)
  } catch (cause) {
    showActionToast(
      dialogs.value.pluginOperationFailed({
        error: cause instanceof Error ? cause.message : String(cause)
      })
    )
  }
}
</script>

<template>
  <Tip v-if="modules.length > 0" :label="dialogs.settingsPlugins">
    <DropdownMenuRoot>
      <DropdownMenuTrigger as-child>
        <ToolbarButton
          :data-test-id="`toolbar-plugin-modules${mobile ? '-mobile' : ''}`"
          :data-mobile="mobile || undefined"
          :aria-label="dialogs.settingsPlugins"
          :class="styles.button({ class: ui?.button })"
        >
          <IconPuzzle :class="styles.icon({ class: ui?.icon })" />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuPortal>
        <DropdownMenuContent side="top" :side-offset="8" align="end" :class="menuCls.content">
          <DropdownMenuItem
            v-for="module in modules"
            :key="`${pluginId(module)}/${module.contribution.moduleType}`"
            :data-test-id="itemTestId(module)"
            :class="itemCls"
            @select="addModule(module)"
          >
            <component
              :is="moduleIcon(pluginId(module), module.contribution.moduleType)"
              class="size-3.5 shrink-0"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate">{{ moduleDisplayName(module) }}</span>
              <span class="block truncate text-[9px] text-muted">
                {{ pluginDisplayName(module) }}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </Tip>
</template>
