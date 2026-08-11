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
