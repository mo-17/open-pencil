import type { IRAttrValue, IRModule, IRWarning } from '#compiler/ir/types'

import {
  resolveUploadButtonModule,
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID
} from '@open-pencil/core/plugins'
import type { ExprAst } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createContractModuleLowerer } from './contract-lowerer'

export const UPLOAD_BUTTON_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: UPLOAD_BUTTON_PLUGIN_ID,
  moduleType: UPLOAD_BUTTON_MODULE_TYPE,
  warningCodePrefix: 'upload-button-module',
  displayName: 'Upload Button',
  resolve: resolveUploadButtonModule,
  payload: (config) => ({ ...config, accept: [...config.accept] })
})

/** Only the trusted local file chooser accepts this page/document read. Invalid bindings
 * remain disabled; they must not silently restore an enabled chooser. */
export function collectUploadButtonDisabledBinding(
  node: SceneNode,
  module: IRModule | null,
  attrs: Record<string, IRAttrValue>,
  warnings: IRWarning[],
  resolve: (source: string) => ExprAst | undefined
): void {
  if (
    module?.pluginId !== UPLOAD_BUTTON_PLUGIN_ID ||
    module.moduleType !== UPLOAD_BUTTON_MODULE_TYPE
  )
    return
  if (!node.bindings || !Object.hasOwn(node.bindings, 'disabled')) {
    if (node.interactiveProps?.disabled === true) attrs.disabled = true
    return
  }
  module.uploadDisabledExpr = { kind: 'ident', name: 'true' }
  const binding: unknown = Object.getOwnPropertyDescriptor(node.bindings, 'disabled')?.value
  if (
    !binding ||
    typeof binding !== 'object' ||
    !('kind' in binding) ||
    binding.kind !== 'expr' ||
    !('expr' in binding) ||
    typeof binding.expr !== 'string'
  ) {
    warnings.push({
      code: 'upload-button-binding-invalid',
      message:
        'Upload Button disabled requires a boolean read expression; selection remains disabled',
      nodeId: node.id
    })
    return
  }
  const ast = resolve(binding.expr)
  if (ast) module.uploadDisabledExpr = ast
}
