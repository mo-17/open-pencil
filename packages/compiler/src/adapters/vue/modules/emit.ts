import { vueModuleValueBindings } from '#compiler/adapters/module-values'
import { vuePaginationBindings } from '#compiler/adapters/pagination/bindings'
import type { IRElement, IRNode } from '#compiler/ir/types'
import { moduleContentNodes } from '#compiler/modules/content-slots'

import {
  scriptExpression,
  scriptJSON,
  templateExpression,
  type VueEmitContext,
  type VueLocalBinding
} from '../shared'
import type { VueModuleAdapter } from './types'

interface VueModuleElementParts {
  attrs: readonly string[]
  renderChildren: (nodes: readonly IRNode[], indent: number) => string
  locals: readonly VueLocalBinding[]
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
    `const ${configName} = ${scriptJSON(node.module?.payload ?? {})} as const`
  )
  const attrs = [`:config="${configName}"`, ...parts.attrs]
  if (node.module?.panoramaUrlExpr && adapter.pluginId === 'open-pencil.vr-tour') {
    const read = templateExpression(node.module.panoramaUrlExpr, context.identAliases, parts.locals)
    const expression = `(() => { try { return ${read} } catch { return undefined } })()`
    attrs.push(
      ':panorama-bound="true"',
      `:panorama-url="${expression.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
    )
  }
  attrs.push(...videoModuleBindings(node, context, parts.locals))
  attrs.push(...vuePaginationBindings(node.module, context, parts.locals))
  attrs.push(...vueModuleValueBindings(node.module, context, parts.locals))
  if (node.module?.uploadDisabledExpr && adapter.pluginId === 'open-pencil.upload-button') {
    const read = scriptExpression(
      node.module.uploadDisabledExpr,
      context.refNames,
      context.identAliases
    )
    const guard = `__opUploadDisabled_${context.expressionIndex}`
    context.templateBindings.push(
      `const ${guard} = __vueComputed(() => { try { return (${read} as unknown) !== false } catch { return true } })`
    )
    attrs.push(`:disabled="${guard}"`)
  }
  const opening = `${pad}<${adapter.componentName} ${attrs.join(' ')}`
  const slots = moduleContentNodes(node)
  if (slots) {
    const children = slots
      .map(
        (slot) =>
          `${pad}  <template #${slot.name}>\n${parts.renderChildren(slot.nodes, indent + 2)}${pad}  </template>\n`
      )
      .join('')
    return `${opening}>\n${children}${pad}</${adapter.componentName}>\n`
  }
  if (node.children.length === 0) return `${opening} />\n`
  return `${opening}>\n${parts.renderChildren(node.children, indent + 1)}${pad}</${adapter.componentName}>\n`
}

function videoModuleBindings(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  if (node.module?.pluginId !== 'open-pencil.video' || node.module.moduleType !== 'video') return []
  return (['src', 'poster'] as const).flatMap((key) => {
    const ast = key === 'src' ? node.module?.videoSrcExpr : node.module?.videoPosterExpr
    if (!ast) return []
    const read = templateExpression(ast, context.identAliases, locals)
    const expression = `(() => { try { return ${read} } catch { return undefined } })()`
    return [
      `:${key}-bound="true"`,
      `:video-${key}="${expression.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
    ]
  })
}
