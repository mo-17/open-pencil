import { inputControlConfig } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

const CONTROL_VARIANTS: Readonly<Record<string, string | undefined>> = {
  focus: 'focus-within',
  'focus-visible': 'has-[>input:focus-visible]',
  disabled: 'has-[>input:disabled]',
  'read-only': 'has-[>input:read-only]',
  'read-write': 'has-[>input:read-write]',
  placeholder: '[&>input]:placeholder'
}

/** Keep arbitrary values/selectors intact when projecting top-level variants. */
function projectVariant(token: string, color = false): string {
  let depth = 0,
    start = 0,
    result = ''
  for (let index = 0; index < token.length; index++) {
    const character = token[index]
    if (character === '\\') {
      index++
      continue
    }
    if (character === '[' || character === '(') depth++
    else if (character === ']' || character === ')') depth--
    else if (character === ':' && depth === 0) {
      const variant = token.slice(start, index)
      const colorVariant =
        color && (variant === 'read-only' || variant === 'read-write')
          ? `data-[color-readonly=${variant === 'read-only'}]`
          : undefined
      result += `${colorVariant ?? CONTROL_VARIANTS[variant] ?? variant}:`
      start = index + 1
    }
  }
  return result + token.slice(start)
}

/** Emit full static utilities so Tailwind can scan the enhanced field's real state owner. */
export function inputControlClassName(classes: string, node: SceneNode): string {
  const props = node.interactiveProps ?? {}
  if (node.type !== 'INPUT' || props.upload !== undefined || !inputControlConfig(props))
    return classes
  return classes
    .split(/\s+/)
    .map((token) => projectVariant(token, props.inputType === 'color'))
    .join(' ')
}
