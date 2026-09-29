import type { IRElement } from '#compiler/ir/types'

export const VUE_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

export function safeVueTag(value: string): string {
  return /^[a-z][a-z0-9-]*$/.test(value) ? value : 'div'
}

/** Field events retain the real DOM event, with a checked target for authored reads. */
export function vueFieldEventLocals(tag: string | undefined): string[] {
  const targetType = new Map([
    ['input', 'HTMLInputElement'],
    ['select', 'HTMLSelectElement'],
    ['textarea', 'HTMLTextAreaElement']
  ]).get(tag ?? '')
  if (!targetType) return ['const $event = __opEvent']
  return [
    `if (!(__opEvent.target instanceof ${targetType})) return`,
    `const $event = __opEvent as Event & { readonly target: ${targetType} }`
  ]
}

export function vueControlledEventValue(
  type: NonNullable<IRElement['controlled']>['write']['targetType']
): string {
  if (type === 'boolean') return '(__opEvent.target as HTMLInputElement).checked'
  if (type === 'number')
    return 'Number((__opEvent.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)'
  return '(__opEvent.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value'
}
