import type { IRElement, IRStyleAttr } from '#compiler/ir/types'

import { vueFormResetAttribute } from '../form-reset'
import {
  emitControlledAttribute,
  emitEventAttributes,
  emitVueUploadAttribute,
  emitValidatedSubmitAttribute,
  emitValidationEventAttributes
} from './events'
import { buildVueRequestStateAttributes } from './lowcode/request-gate'
import {
  selectTemplateBinding,
  vueSelectDefaultValue,
  vueSelectEmptyOptionGuard,
  vueSelectOptionValue
} from './select'
import {
  attrName,
  escapeAttr,
  generatedAlias,
  sanitizeVueHrefLiteral,
  scopedIdentifier,
  scriptExpression,
  scriptJSON,
  templateExpression,
  vueAssetURL,
  withLocalAliases,
  type VueEmitContext,
  type VueLocalBinding
} from './shared'

// oxlint-disable-next-line complexity -- Attribute emission exhaustively lowers the bounded IR attribute variants.
export function emitVueElementAttributes(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  const requestState = buildVueRequestStateAttributes(node, context, locals)
  const attrs: string[] = [...requestState.attrs]
  if (!node.controlled && node.selectDefaultValues) {
    const name = `__opSelectDefaults_${++context.expressionIndex}`
    context.templateBindings.push(`const ${name} = ${scriptJSON(node.selectDefaultValues)}`)
    attrs.push(`:default-value="${name}"`)
  }
  const emptyOptionGuard = vueSelectEmptyOptionGuard(node, context, locals)
  if (emptyOptionGuard) attrs.push(`v-if="${escapeAttr(emptyOptionGuard)}"`)
  if (node.classNameProp) {
    const prop = scopedIdentifier(node.classNameProp, context.identAliases, locals)
    const fallback = node.classNamePropFallback ? ` ?? ${scriptJSON(node.className)}` : ''
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
    if (requestState.overridden.has(rawName)) continue
    if (rawName === 'style' || rawName === 'className' || rawName.startsWith('on')) continue
    if (node.upload && (rawName === 'type' || rawName === 'accept')) continue
    if (node.controlled && (rawName === 'defaultValue' || rawName === 'defaultChecked')) continue
    if (node.image && ['src', 'alt', 'loading'].includes(rawName)) continue
    const name =
      (node.selectFeatures || node.inputSuggestions || node.inputControl) &&
      rawName === 'defaultValue'
        ? 'default-value'
        : attrName(rawName)
    if (!name) continue
    if (
      node.tag === 'select' &&
      !node.selectFeatures &&
      rawName === 'defaultValue' &&
      typeof value === 'string'
    ) {
      const defaultValue = vueSelectDefaultValue(value, node, context)
      if (defaultValue) attrs.push(`:value="${defaultValue}"`)
      continue
    }
    if (typeof value === 'boolean') {
      if (value) attrs.push(name)
    } else if (typeof value === 'number' || typeof value === 'string') {
      attrs.push(`${name}="${escapeAttr(String(value))}"`)
    } else if (value.kind === 'exprAttr') {
      const buttonDisabled =
        node.tag === 'button' && rawName === 'disabled'
          ? selectTemplateBinding(
              scriptExpression(
                value.ast,
                context.refNames,
                withLocalAliases(context.identAliases, locals)
              ),
              context,
              locals
            )
          : undefined
      const optionValue =
        rawName === 'value' ? vueSelectOptionValue(node, context, locals) : undefined
      attrs.push(
        `:${name}="${escapeAttr(buttonDisabled ?? optionValue ?? templateExpression(value.ast, context.identAliases, locals))}"`
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
      attrs.push(`src="${escapeAttr(vueAssetURL(node.image.srcLiteral))}"`)
    } else if (node.image.srcExpr) {
      attrs.push(
        `:src="${escapeAttr(templateExpression(node.image.srcExpr, context.identAliases, locals))}"`
      )
    }
    attrs.push(`alt="${escapeAttr(node.image.alt)}"`)
    if (node.image.loading) attrs.push(`loading="${node.image.loading}"`)
  }
  if (node.upload) {
    attrs.push('type="file"')
    if (node.upload.accept) attrs.push(`accept="${escapeAttr(node.upload.accept)}"`)
    if (context.supabaseAvailable) {
      attrs.push(emitVueUploadAttribute(node.upload, context, node.sourceId, locals))
    }
  }
  const controlled = emitControlledAttribute(node, context, locals)
  if (
    node.tag === 'input' &&
    node.controlled?.write.targetType === 'number' &&
    !('type' in node.attrs) &&
    !node.upload
  )
    attrs.push('type="number"')
  if (controlled) attrs.push(...controlled.attrs)
  attrs.push(...emitValidationEventAttributes(node, context, locals))
  const skippedEvents = new Set<string>()
  if (controlled) skippedEvents.add(controlled.skip)
  if (node.upload) skippedEvents.add('onChange')
  if (node.validation) skippedEvents.add('onBlur')
  if (node.formValidationKeys) {
    attrs.push(emitValidatedSubmitAttribute(node, context, locals))
    skippedEvents.add('onSubmit')
  }
  if (
    node.tag === 'form' &&
    ((node.formResetFields?.length ?? 0) > 0 || (node.formValidationKeys?.length ?? 0) > 0)
  )
    attrs.push(
      vueFormResetAttribute(node.formResetFields ?? [], node.formValidationKeys ?? [], context)
    )
  attrs.push(
    ...emitEventAttributes(
      node.events,
      context,
      node.sourceId,
      locals,
      skippedEvents,
      node.tag,
      node.module?.pluginId === 'open-pencil.stepper' && node.module.moduleType === 'stepper'
        ? 'stepschange'
        : undefined
    )
  )
  return attrs
}

export function emitVueStyleExpression(style: IRStyleAttr, context: VueEmitContext): string {
  const declarations = Object.entries(style.declarations).map(([property, value]) => {
    const emitted = styleValueExpression(value, context)
    return {
      source: `${scriptJSON(property)}: ${emitted.source}`,
      usesAsset: emitted.usesAsset
    }
  })
  const source = `{ ${declarations.map((declaration) => declaration.source).join(', ')} }`
  if (!context.hoistStyles && !declarations.some((declaration) => declaration.usesAsset))
    return source
  context.expressionIndex += 1
  const name = `__opStyle_${context.expressionIndex}`
  context.templateBindings.push(
    `const ${name} = ${source}${context.hoistStyles ? ' as const' : ''}`
  )
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
  if (matches.length === 0) return { source: scriptJSON(value), usesAsset: false }
  const parts: string[] = []
  let cursor = 0
  for (const match of matches) {
    const index = match.index
    const path = vueAssetURL(match[2])
    let alias = context.assetImports.get(path)
    if (!alias) {
      alias = generatedAlias('Asset', path)
      context.assetImports.set(path, alias)
    }
    parts.push(scriptJSON(`${value.slice(cursor, index)}url(`), alias, scriptJSON(')'))
    cursor = index + match[0].length
  }
  const tail = value.slice(cursor)
  if (tail) parts.push(scriptJSON(tail))
  return { source: parts.join(' + '), usesAsset: true }
}

export function vueStyleAssetImportLines(context: VueEmitContext): string[] {
  return [...context.assetImports.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, alias]) => `import ${alias} from ${scriptJSON(path)}`)
}
