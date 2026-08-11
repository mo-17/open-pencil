import type { IRElement } from '#compiler/ir/types'

import { scriptJson, type VueEmitContext } from '../shared'
import type { VueModuleAdapter } from './types'

interface VueModuleElementParts {
  attrs: readonly string[]
  children: string
}

export function emitVueModuleElement(
  node: IRElement,
  adapter: VueModuleAdapter,
  context: VueEmitContext,
  indent: number,
  parts: VueModuleElementParts
): string {
  const pad = '  '.repeat(indent)
  context.expressionIndex += 1
  const configName = `__opModuleConfig_${context.expressionIndex}`
  context.templateBindings.push(
    `const ${configName} = ${scriptJson(node.module?.payload ?? {})} as const`
  )
  const attrs = [`:config="${configName}"`, ...parts.attrs]
  const opening = `${pad}<${adapter.componentName} ${attrs.join(' ')}`
  if (node.children.length === 0) return `${opening} />\n`
  return `${opening}>\n${parts.children}${pad}</${adapter.componentName}>\n`
}
