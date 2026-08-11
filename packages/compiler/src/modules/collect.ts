import type { IRModule, IRWarning } from '#compiler/ir/types'

import { validateModuleInstance, type SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleRegistry } from './registry'
import type { CompilerModuleLoweringResult } from './types'

interface DeclaredModuleIdentity {
  pluginId: string
  moduleType: string
}

/** Read only own data properties so malformed/untrusted envelopes cannot run
 * getters merely to decide whether a diagnostic belongs to an installed module. */
function declaredModuleIdentity(value: unknown): DeclaredModuleIdentity | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const pluginId = Object.getOwnPropertyDescriptor(value, 'pluginId')
  const moduleType = Object.getOwnPropertyDescriptor(value, 'moduleType')
  if (
    !pluginId?.enumerable ||
    !('value' in pluginId) ||
    typeof pluginId.value !== 'string' ||
    !moduleType?.enumerable ||
    !('value' in moduleType) ||
    typeof moduleType.value !== 'string'
  ) {
    return null
  }
  return { pluginId: pluginId.value, moduleType: moduleType.value }
}

function warnInvalid(
  warnings: IRWarning[],
  node: SceneNode,
  warningCodePrefix: string,
  displayName: string,
  reason: string
): void {
  warnings.push({
    code: `${warningCodePrefix}-invalid`,
    message: `${displayName} module on ${node.id} is invalid: ${reason}`,
    nodeId: node.id
  })
}

/** Lower one installed trusted module. Unknown identities remain ordinary
 * authored nodes, preserving the document's fallback representation. */
export function collectCompilerModule(
  node: SceneNode,
  warnings: IRWarning[],
  registry: CompilerModuleRegistry
): IRModule | null {
  const value = node.interactiveProps?.module
  const validated = validateModuleInstance(value)
  const identity = validated.ok ? validated.value : declaredModuleIdentity(value)
  if (!identity) return null

  const lowerer = registry.getLowerer(identity.pluginId, identity.moduleType)
  if (!lowerer) return null
  if (!validated.ok) {
    warnInvalid(warnings, node, lowerer.warningCodePrefix, lowerer.displayName, validated.reason)
    return null
  }
  const instance = validated.value
  if (!lowerer.hostTypes.includes(node.type)) {
    warnings.push({
      code: `${lowerer.warningCodePrefix}-host-invalid`,
      message: `${lowerer.displayName} module on ${node.id} requires a ${lowerer.hostTypes.join(' or ')} host; module skipped`,
      nodeId: node.id
    })
    return null
  }

  let lowered: CompilerModuleLoweringResult
  try {
    lowered = lowerer.lower(value, node)
  } catch {
    warnInvalid(
      warnings,
      node,
      lowerer.warningCodePrefix,
      lowerer.displayName,
      'module lowerer failed'
    )
    return null
  }
  if (!lowered.ok) {
    warnInvalid(warnings, node, lowerer.warningCodePrefix, lowerer.displayName, lowered.reason)
    return null
  }
  const configVersion = lowered.configVersion ?? instance.configVersion
  const payload = validateModuleInstance({
    version: 1,
    pluginId: instance.pluginId,
    moduleType: instance.moduleType,
    configVersion,
    config: lowered.payload
  })
  if (!payload.ok) {
    warnInvalid(
      warnings,
      node,
      lowerer.warningCodePrefix,
      lowerer.displayName,
      `module lowerer produced an invalid payload: ${payload.reason}`
    )
    return null
  }
  return {
    pluginId: instance.pluginId,
    moduleType: instance.moduleType,
    configVersion: payload.value.configVersion,
    payload: payload.value.config
  }
}
