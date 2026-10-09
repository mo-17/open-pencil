import type { EditorStore } from '@/app/editor/active-store'
import {
  addInstalledPluginModuleToCanvas,
  appPluginStore,
  inspectInstalledPluginModuleCompatibility,
  withAppPluginPublisherPrivilege,
  type InstalledPluginModule
} from '@/app/plugins'

import { effectPickAssetModule } from './catalog'
import { captureAssetTarget } from './target'

export async function insertModuleAsset(
  editor: EditorStore,
  module: InstalledPluginModule,
  locale: string,
  staleMessage: string,
  effectId?: string
): Promise<string> {
  const isCurrent = captureAssetTarget(() => ({
    graph: editor.graph,
    pageId: editor.state.currentPageId,
    parentId: editor.state.enteredContainerId,
    sourceIdentity: editor.getSourceIdentity()
  }))
  const id = module.plugin.package.manifest.plugin.id
  const digest = module.plugin.package.digest
  const add = async () => {
    const current = appPluginStore.module(id, module.contribution.moduleType)
    if (!isCurrent() || !current || current.plugin.package.digest !== digest)
      throw new Error(staleMessage)
    const compatibility = inspectInstalledPluginModuleCompatibility(current)
    if (!compatibility.ok) throw new Error(compatibility.reason)
    return addInstalledPluginModuleToCanvas(
      editor,
      effectId ? effectPickAssetModule(current, effectId) : current,
      locale
    )
  }
  return module.plugin.package.trustSource === 'publisher-signature'
    ? withAppPluginPublisherPrivilege(add)
    : add()
}
