import type { ComponentDef, IRComponentRef } from '#compiler/ir/types'

import type { MiniProgramWarningSink } from '../miniprogram-shared'

export function warnTaroComponentDefinitionRuntime(
  definition: ComponentDef,
  warn: MiniProgramWarningSink
): void {
  if (!definition.prototypeBody) return
  warn({
    code: 'taro-component-prototype-unsupported',
    message: `Taro rendered component ${JSON.stringify(definition.name)} without prototype runtime`,
    nodeId: definition.componentId
  })
}

export function warnTaroComponentReferenceRuntime(
  node: IRComponentRef,
  warn: MiniProgramWarningSink
): void {
  if (node.motion || node.motionDrivers || node.motionDriverMarker) {
    warn({
      code: 'taro-component-motion-unsupported',
      message: `Taro omitted Motion attached to component ${JSON.stringify(node.name)}`,
      nodeId: node.sourceId
    })
  }
  if (
    node.prototype ||
    node.transitionKey ||
    node.prototypeTarget ||
    node.prototypeOverlayTarget ||
    node.prototypeScope ||
    node.prototypeBody
  ) {
    warn({
      code: 'taro-component-prototype-unsupported',
      message: `Taro omitted prototype runtime attached to component ${JSON.stringify(node.name)}`,
      nodeId: node.sourceId
    })
  }
}
