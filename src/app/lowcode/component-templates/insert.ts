import type { EditorStore } from '@/app/editor/active-store'
import { appPluginStore, inspectInstalledPluginModuleCompatibility } from '@/app/plugins'

import { createComponentTemplate } from './build'
import { getComponentTemplates, isComponentTemplateId } from './catalog'
import { resolveComponentTemplatePage } from './target'
import { ComponentTemplateError } from './types'

/** Recheck live host authority; a saved favorite or a recipe never enables a plugin. */
export function componentTemplateAvailability(id: string): {
  ok: boolean
  missingModules: readonly string[]
} {
  const item = getComponentTemplates().find((entry) => entry.id === id)
  if (!item) return { ok: false, missingModules: [] }
  const missingModules = item.requiredModules
    .filter((required) => {
      const module = appPluginStore.module(required.pluginId, required.moduleType)
      return (
        module?.plugin.package.trustSource !== 'app-bundle' ||
        !inspectInstalledPluginModuleCompatibility(module).ok
      )
    })
    .map((required) => required.moduleType)
  return { ok: missingModules.length === 0, missingModules }
}

/** Synchronous insertion has no delayed callback that could target a switched document. */
export function insertComponentTemplate(editor: EditorStore, id: string, locale: string) {
  if (!isComponentTemplateId(id)) throw new ComponentTemplateError('unknown-template')
  if (!componentTemplateAvailability(id).ok) throw new ComponentTemplateError('unavailable-module')
  const pageId = editor.state.currentPageId
  const parentId = editor.state.enteredContainerId ?? pageId
  if (resolveComponentTemplatePage(editor.graph, parentId, id).id !== pageId)
    throw new ComponentTemplateError('invalid-target')
  const viewport = editor.viewportCanvasCenter()
  const center = editor.screenToCanvas(viewport.x, viewport.y)
  const offset = parentId === pageId ? { x: 0, y: 0 } : editor.graph.getAbsolutePosition(parentId)
  const result = createComponentTemplate(editor, id, locale, {
    parentId,
    x: center.x - offset.x - 180,
    y: center.y - offset.y - 120
  })
  editor.select([result.rootId])
  editor.requestRender()
  return result
}
