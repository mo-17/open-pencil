import type { IRElement, IRStyleAttr } from '#compiler/ir/types'

import {
  emitControlledAttribute,
  emitEventAttributes,
  emitValidatedSubmitAttribute,
  emitValidationEventAttributes
} from './events'
import {
  attrName,
  escapeAttr,
  generatedAlias,
  sanitizeVueHrefLiteral,
  scopedIdentifier,
  scriptJson,
  templateExpression,
  vueAssetUrl,
  type VueEmitContext,
  type VueLocalBinding
} from './shared'

// oxlint-disable-next-line complexity -- Attribute emission exhaustively lowers the bounded IR attribute variants.
export function emitVueElementAttributes(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  const attrs: string[] = []
  if (node.classNameProp) {
    const prop = scopedIdentifier(node.classNameProp, context.identAliases, locals)
    const fallback = node.classNamePropFallback ? ` ?? ${scriptJson(node.className)}` : ''
    attrs.push(`:class="${escapeAttr(`${prop}${fallback}`)}"`)
  } else if (node.className) {
    attrs.push(`class="${escapeAttr(node.className)}"`)
  }
  const staticStyle = styleAttr(node.attrs.style)
  if (node.styleProp) {
    const prop = scopedIdentifier(node.styleProp, context.identAliases, locals)
    const fallback =
      node.stylePropFallback && staticStyle
        ? ` ?? ${emitVueStyleExpression(staticStyle, context)}`
        : ''
    attrs.push(`:style="${escapeAttr(`${prop}${fallback}`)}"`)
  } else if (staticStyle) {
    attrs.push(`:style="${escapeAttr(emitVueStyleExpression(staticStyle, context))}"`)
  }
  if (context.devMode) attrs.push(`data-node-id="${escapeAttr(node.sourceId)}"`)
  for (const [rawName, value] of Object.entries(node.attrs)) {
    if (rawName === 'style' || rawName === 'className' || rawName.startsWith('on')) continue
    if (node.controlled && (rawName === 'defaultValue' || rawName === 'defaultChecked')) continue
    if (node.image && ['src', 'alt', 'loading'].includes(rawName)) continue
    const name = attrName(rawName)
    if (!name) continue
    if (typeof value === 'boolean') {
      if (value) attrs.push(name)
    } else if (typeof value === 'number' || typeof value === 'string') {
      attrs.push(`${name}="${escapeAttr(String(value))}"`)
    } else if (value.kind === 'exprAttr') {
      attrs.push(
        `:${name}="${escapeAttr(templateExpression(value.ast, context.identAliases, locals))}"`
      )
    } else if (value.kind === 'intlMessage') {
      attrs.push(`${name}="${escapeAttr(value.defaultMessage)}"`)
    }
  }
  if (node.link) {
    const literalHref =
      node.link.hrefLiteral === undefined
        ? undefined
        : sanitizeVueHrefLiteral(node.link.hrefLiteral)
    if (literalHref !== undefined) {
      attrs.push(`href="${escapeAttr(literalHref)}"`)
    } else if (node.link.hrefExpr) {
      context.safeHrefRequired = true
      attrs.push(
        `:href="${escapeAttr(`__safeHref(${templateExpression(node.link.hrefExpr, context.identAliases, locals)})`)}"`
      )
    }
    attrs.push(`target="${node.link.target}"`)
    if (node.link.target === '_blank') attrs.push('rel="noopener noreferrer"')
  }
  if (node.image) {
    if (node.image.srcLiteral !== undefined) {
      attrs.push(`src="${escapeAttr(vueAssetUrl(node.image.srcLiteral))}"`)
    } else if (node.image.srcExpr) {
      attrs.push(
        `:src="${escapeAttr(templateExpression(node.image.srcExpr, context.identAliases, locals))}"`
      )
    }
    attrs.push(`alt="${escapeAttr(node.image.alt)}"`)
    if (node.image.loading) attrs.push(`loading="${node.image.loading}"`)
  }
  const controlled = emitControlledAttribute(node, context, locals)
  if (controlled) attrs.push(...controlled.attrs)
  attrs.push(...emitValidationEventAttributes(node, context, locals))
  const skippedEvents = new Set<string>()
  if (controlled) skippedEvents.add(controlled.skip)
  if (node.validation) skippedEvents.add('onBlur')
  if (node.formValidationKeys && node.formValidationKeys.length > 0) {
    attrs.push(emitValidatedSubmitAttribute(node, context, locals))
    skippedEvents.add('onSubmit')
  }
  attrs.push(...emitEventAttributes(node.events, context, node.sourceId, locals, skippedEvents))
  return attrs
}

export function emitVueStyleExpression(style: IRStyleAttr, context: VueEmitContext): string {
  const declarations = Object.entries(style.declarations).map(([property, value]) => {
    const emitted = styleValueExpression(value, context)
    return {
      source: `${scriptJson(property)}: ${emitted.source}`,
      usesAsset: emitted.usesAsset
    }
  })
  const source = `{ ${declarations.map((declaration) => declaration.source).join(', ')} }`
  if (!declarations.some((declaration) => declaration.usesAsset)) return source
  context.expressionIndex += 1
  const name = `__opStyle_${context.expressionIndex}`
  context.templateBindings.push(`const ${name} = ${source}`)
  return name
}

function styleAttr(value: IRElement['attrs'][string] | undefined): IRStyleAttr | null {
  return value && typeof value === 'object' && value.kind === 'styleAttr' ? value : null
}

function styleValueExpression(
  value: string,
  context: VueEmitContext
): { source: string; usesAsset: boolean } {
  const pattern = /url\(\s*(['"]?)(\.\/assets\/[^'"\s)]+|src\/assets\/[^'"\s)]+)\1\s*\)/g
  const matches = [...value.matchAll(pattern)]
  if (matches.length === 0) return { source: scriptJson(value), usesAsset: false }
  const parts: string[] = []
  let cursor = 0
  for (const match of matches) {
    const index = match.index
    const path = vueAssetUrl(match[2])
    let alias = context.assetImports.get(path)
    if (!alias) {
      alias = generatedAlias('Asset', path)
      context.assetImports.set(path, alias)
    }
    parts.push(scriptJson(`${value.slice(cursor, index)}url(`), alias, scriptJson(')'))
    cursor = index + match[0].length
  }
  const tail = value.slice(cursor)
  if (tail) parts.push(scriptJson(tail))
  return { source: parts.join(' + '), usesAsset: true }
}

export function vueStyleAssetImportLines(context: VueEmitContext): string[] {
  return [...context.assetImports.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, alias]) => `import ${alias} from ${scriptJson(path)}`)
}
