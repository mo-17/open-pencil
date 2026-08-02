import type { Fill } from '@open-pencil/scene-graph'

/**
 * CanvasKit text styles accept one foreground color. Match its selection rule
 * everywhere that needs to reason about rich-text paint: ignore hidden and
 * non-solid fills, then use the first remaining solid fill.
 */
export function firstVisibleSolidTextFill(fills: readonly Fill[] | undefined): Fill | undefined {
  return fills?.find((fill) => fill.visible && fill.type === 'SOLID')
}
