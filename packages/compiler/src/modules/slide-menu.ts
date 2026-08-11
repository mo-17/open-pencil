import {
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  resolveSlideMenuModule
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const SLIDE_MENU_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: SLIDE_MENU_PLUGIN_ID,
  moduleType: SLIDE_MENU_MODULE_TYPE,
  warningCodePrefix: 'slide-menu-module',
  displayName: 'Slide Menu',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveSlideMenuModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      configVersion: resolved.instance.configVersion,
      payload: {
        presentation: config.presentation,
        direction: config.direction,
        triggerLabel: config.triggerLabel,
        showTriggerIcon: config.showTriggerIcon,
        showTriggerLabel: config.showTriggerLabel,
        title: config.title,
        description: config.description,
        items: config.items.map((item) => ({ label: item.label, href: item.href })),
        closeOnBackdrop: config.closeOnBackdrop,
        showCloseButton: config.showCloseButton,
        panelSize: config.panelSize,
        panelBackground: config.panelBackground,
        textColor: config.textColor,
        overlayOpacity: config.overlayOpacity
      }
    }
  }
})
