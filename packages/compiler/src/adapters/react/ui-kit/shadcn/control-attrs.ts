import type { IRAttrValue, IRElement } from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import type { KitEmitCtx } from '../types'

/** Radix roots project only the host attributes their rendered elements own. */
export function controlAttrParts(node: IRElement, ctx: KitEmitCtx): string[] {
  const parts: string[] = []
  for (const name of [
    'id',
    'name',
    'disabled',
    'aria-label',
    'aria-disabled',
    'aria-required',
    'aria-describedby'
  ]) {
    const value = node.attrs[name]
    if (Object.hasOwn(node.attrs, name)) parts.push(controlAttr(name, value, ctx))
  }
  if (node.controlKind === 'checkbox-group') parts.push('role="group"')
  return parts
}

function controlAttr(name: string, value: IRAttrValue, ctx: KitEmitCtx): string {
  if (typeof value === 'string') return `${name}="${ctx.escapeAttr(value)}"`
  if (typeof value === 'boolean') return value ? name : `${name}={false}`
  if (typeof value === 'number') return `${name}={${value}}`
  if (value.kind === 'exprAttr') return `${name}={${emitExpression(value.ast)}}`
  if (value.kind === 'intlMessage') {
    return `${name}={intl.formatMessage({ id: ${JSON.stringify(value.messageId)}, defaultMessage: ${JSON.stringify(value.defaultMessage)} })}`
  }
  return ''
}

/** Radix value callbacks do not carry the DOM event promised by authored field
 * actions. Use the existing native emitter for these fields so $event/$value,
 * controlled writes, validation and request timing keep their exact contract.
 * Empty option values also retain the native HTML selection contract.
 */
export function nativeControlFallbackReason(node: IRElement): string | undefined {
  if (!node.controlKind) return undefined
  if (node.controlKind === 'select' && node.selectOptionsSource)
    return 'dynamic option values need the native HTML selection contract'
  if (
    (['onClick', 'onChange', 'onFocus', 'onBlur'] as const).some(
      (name) => (node.events?.[name]?.length ?? 0) > 0
    )
  ) {
    return 'authored click or field events need the native DOM event contract'
  }
  const emptyOption =
    node.controlKind === 'select' &&
    node.children.some(
      (child) => child.kind === 'element' && child.tag === 'option' && child.attrs.value === ''
    )
  return emptyOption ? 'empty option values need the native HTML selection contract' : undefined
}
