/** Keep authored positioning while supplying a containing block for media controls. */
export const VUE_MEDIA_HOST_SOURCE = `
const attrs = useAttrs()
const hostStyle = computed(() => {
  const normalized = normalizeStyle([attrs.style])
  const style = typeof normalized === 'object' && normalized !== null ? normalized : {}
  const position = style.position
  const positioned = normalizeClass(attrs.class).split(/\\s+/).some(token => ['absolute', 'fixed', 'relative', 'sticky'].includes(token))
  return positioned || (position !== undefined && position !== 'static') ? style : { ...style, position: 'relative' as const }
})
`
