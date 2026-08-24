<script setup lang="ts">
import { computed } from 'vue'
import { tv } from 'tailwind-variants'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'

import IconChartColumn from '~icons/lucide/chart-column'
import IconCode2 from '~icons/lucide/code-2'
import IconFileAudio from '~icons/lucide/file-audio'
import IconFileText from '~icons/lucide/file-text'
import IconListCollapse from '~icons/lucide/list-collapse'
import IconMap from '~icons/lucide/map'
import IconMenu from '~icons/lucide/menu'
import IconPanelLeftOpen from '~icons/lucide/panel-left-open'
import IconPuzzle from '~icons/lucide/puzzle'
import IconQrCode from '~icons/lucide/qr-code'
import IconRows3 from '~icons/lucide/rows-3'
import IconType from '~icons/lucide/type'
import IconUpload from '~icons/lucide/upload'

import {
  addInstalledPluginModuleToCanvas,
  appPluginStore,
  appPluginStoreSnapshot,
  inspectInstalledPluginModuleCompatibility,
  withAppPluginPublisherPrivilege
} from '@/app/plugins'
import {
  localizedAppPluginContributionText,
  localizedAppPluginText
} from '@/app/plugins/localization'
import { useEditorStore } from '@/app/editor/active-store'
import { useActionToast } from '@/app/shell/toast/action'
import Tip from '@/components/ui/Tip.vue'
import { menu, useMenuUI } from '@/components/ui/menu'
import toolbarTheme from '@/theme/toolbar'
import {
  ACCORDION_MODULE_TYPE,
  AUDIO_PLAYER_MODULE_TYPE,
  CHART_MODULE_TYPE,
  CODE_BLOCK_MODULE_TYPE,
  DROPDOWN_MENU_MODULE_TYPE,
  MAP_MODULE_TYPE,
  MARKDOWN_MODULE_TYPE,
  PDF_VIEWER_MODULE_TYPE,
  QR_BARCODE_MODULE_TYPE,
  RICH_TEXT_MODULE_TYPE,
  SLIDE_MENU_MODULE_TYPE,
  TABS_MODULE_TYPE,
  UPLOAD_BUTTON_MODULE_TYPE
} from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

import type { Component } from 'vue'
import type { InstalledPluginModule } from '@/app/plugins'
import type { ToolbarUI } from '@/components/Toolbar/types'

const { ui, mobile = false } = defineProps<{
  ui?: ToolbarUI
  mobile?: boolean
}>()

const editor = useEditorStore()
const { showActionToast } = useActionToast()
const { dialogs, locale } = useI18n()
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

function moduleIcon(moduleType: string): Component {
  if (moduleType === MAP_MODULE_TYPE) return IconMap
  if (moduleType === CHART_MODULE_TYPE) return IconChartColumn
  if (moduleType === RICH_TEXT_MODULE_TYPE) return IconType
  if (moduleType === SLIDE_MENU_MODULE_TYPE) return IconPanelLeftOpen
  if (moduleType === DROPDOWN_MENU_MODULE_TYPE) return IconMenu
  if (moduleType === TABS_MODULE_TYPE) return IconRows3
  if (moduleType === ACCORDION_MODULE_TYPE) return IconListCollapse
  if (moduleType === QR_BARCODE_MODULE_TYPE) return IconQrCode
  if (moduleType === MARKDOWN_MODULE_TYPE) return IconFileText
  if (moduleType === CODE_BLOCK_MODULE_TYPE) return IconCode2
  if (moduleType === PDF_VIEWER_MODULE_TYPE) return IconFileText
  if (moduleType === AUDIO_PLAYER_MODULE_TYPE) return IconFileAudio
  if (moduleType === UPLOAD_BUTTON_MODULE_TYPE) return IconUpload
  return IconPuzzle
}

async function addModule(module: InstalledPluginModule): Promise<void> {
  const id = pluginId(module)
  try {
    const add = async (): Promise<InstalledPluginModule> => {
      // Re-resolve inside the privilege boundary so stale cross-window authority cannot run.
      const current = appPluginStore.module(id, module.contribution.moduleType)
      if (!current) throw new Error(dialogs.value.pluginDisabledHint)
      const compatibility = inspectInstalledPluginModuleCompatibility(current)
      if (!compatibility.ok) throw new Error(compatibility.reason)
      addInstalledPluginModuleToCanvas(editor, current)
      return current
    }
    const current =
      module.plugin.package.trustSource === 'publisher-signature'
        ? await withAppPluginPublisherPrivilege(add)
        : await add()
    showActionToast(`${dialogs.value.pluginAddToCanvas}: ${moduleDisplayName(current)}`)
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
        <button
          :data-test-id="`toolbar-plugin-modules${mobile ? '-mobile' : ''}`"
          :data-mobile="mobile || undefined"
          :aria-label="dialogs.settingsPlugins"
          :class="styles.button({ class: ui?.button })"
        >
          <IconPuzzle :class="styles.icon({ class: ui?.icon })" />
        </button>
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
            <component :is="moduleIcon(module.contribution.moduleType)" class="size-3.5 shrink-0" />
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
