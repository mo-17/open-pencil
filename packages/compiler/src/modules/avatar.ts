import type { IRAsset, IRModule, IRWarning } from '#compiler/ir/types'

import {
  avatarSupportsImageBytes,
  AVATAR_MODULE_TYPE,
  AVATAR_PLUGIN_ID,
  resolveAvatarModule
} from '@open-pencil/core/plugins'
import type { Fill, SceneNode } from '@open-pencil/scene-graph'

import { createContractModuleLowerer } from './contract-lowerer'

export const AVATAR_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: AVATAR_PLUGIN_ID,
  moduleType: AVATAR_MODULE_TYPE,
  warningCodePrefix: 'avatar-module',
  displayName: 'Avatar',
  resolve: resolveAvatarModule,
  payload: (config) => ({ ...config })
})
export function isAvatarModule(module: IRModule | null): boolean {
  return module?.pluginId === AVATAR_PLUGIN_ID && module.moduleType === AVATAR_MODULE_TYPE
}
/** Compiler-only asset fields are never accepted in authored module config. */
export function collectAvatarImage(
  node: SceneNode,
  module: IRModule | null,
  register: (fill: Fill) => IRAsset | undefined,
  warnings: IRWarning[]
): void {
  if (!module || !isAvatarModule(module)) return
  if (node.interactiveProps?.image !== undefined)
    warnings.push({
      code: 'avatar-generic-image-ignored',
      nodeId: node.id,
      message: 'Avatar uses document IMAGE fills; generic image configuration is ignored.'
    })
  const fill = node.fills.find(
    (candidate) => candidate.visible && candidate.opacity > 0 && candidate.type === 'IMAGE'
  )
  if (!fill) return
  const asset = register(fill)
  if (!asset) return
  if (!avatarSupportsImageBytes(asset.bytes)) {
    warnings.push({
      code: 'avatar-image-format-unsupported',
      nodeId: node.id,
      message: 'Avatar supports local PNG, JPEG, and WebP images; initials fallback is used.'
    })
    return
  }
  module.payload.imageAsset = asset.path
  module.payload.imageOpacity = Math.max(
    0,
    Math.min(1, Number.isFinite(fill.opacity) ? fill.opacity : 1)
  )
}

/** The module owns image clipping and background; generic image props cannot replace its local asset contract. */
export function avatarHostStyleNode(node: SceneNode, module: IRModule | null): SceneNode {
  return isAvatarModule(module)
    ? { ...node, fills: [], interactiveProps: { ...node.interactiveProps, image: undefined } }
    : node
}
