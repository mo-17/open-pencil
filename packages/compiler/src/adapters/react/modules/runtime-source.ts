/** Shared generated-source fragment used by trusted module adapters. */
export const REACT_MODULE_POSITIONED_HOST_SOURCE = `  const positionedByClass = className
    ?.split(' ')
    .some((token) => ['absolute', 'fixed', 'relative', 'sticky'].includes(token))
  const positionedByStyle = style?.position !== undefined && style.position !== 'static'
  const hostStyle =
    positionedByClass || positionedByStyle
      ? style
      : { ...style, position: 'relative' as const }`
