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
import IconMap from '~icons/lucide/map'
import IconPanelLeftOpen from '~icons/lucide/panel-left-open'
import IconPuzzle from '~icons/lucide/puzzle'
import IconType from '~icons/lucide/type'

import {
  addInstalledPluginModuleToCanvas,
  appPluginStore,
  appPluginStoreSnapshot,
  inspectInstalledPluginModuleCompatibility
} from '@/app/plugins'
import { useEditorStore } from '@/app/editor/active-store'
import { useActionToast } from '@/app/shell/toast/action'
import Tip from '@/components/ui/Tip.vue'
import { menu, useMenuUI } from '@/components/ui/menu'
import toolbarTheme from '@/theme/toolbar'
import {
  CHART_MODULE_TYPE,
  MAP_MODULE_TYPE,
  RICH_TEXT_MODULE_TYPE,
  SLIDE_MENU_MODULE_TYPE
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
const { dialogs } = useI18n()
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
      const byName = left.contribution.name.localeCompare(right.contribution.name)
      return byName || pluginId(left).localeCompare(pluginId(right))
    })
})

function pluginId(module: InstalledPluginModule): string {
  return module.plugin.package.manifest.plugin.id
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
  return IconPuzzle
}

function addModule(module: InstalledPluginModule): void {
  const id = pluginId(module)
  try {
    // Re-resolve at execution time so a plugin disabled while the menu was open cannot run.
    const current = appPluginStore.module(id, module.contribution.moduleType)
    if (!current) throw new Error(dialogs.value.pluginDisabledHint)
    const compatibility = inspectInstalledPluginModuleCompatibility(current)
    if (!compatibility.ok) throw new Error(compatibility.reason)
    addInstalledPluginModuleToCanvas(editor, current)
    showActionToast(`${dialogs.value.pluginAddToCanvas}: ${current.contribution.name}`)
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
              <span class="block truncate">{{ module.contribution.name }}</span>
              <span class="block truncate text-[9px] text-muted">
                {{ module.plugin.package.manifest.plugin.name }}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </Tip>
</template>
