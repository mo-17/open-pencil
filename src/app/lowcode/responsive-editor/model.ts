import type {
  ResponsiveBreakpoint,
  ResponsiveOverride,
  ResponsiveOverrides,
  SceneNode
} from '@open-pencil/scene-graph'

const MIN_WIDTH_BREAKPOINTS = ['sm', 'md', 'lg', 'xl'] as const

export const RESPONSIVE_PREVIEW_WIDTHS: Readonly<Record<ResponsiveBreakpoint, number>> = {
  compact: 390,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280
}

export const RESPONSIVE_NUMERIC_FIELDS = [
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'width',
  'height',
  'x',
  'y',
  'fontSize',
  'lineHeight',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'gridColumnGap',
  'gridRowGap',
  'layoutGrow'
] as const

export type ResponsiveNumericField = (typeof RESPONSIVE_NUMERIC_FIELDS)[number]

export const RESPONSIVE_NUMBER_LIMITS: Readonly<
  Record<ResponsiveNumericField, { min?: number; exclusiveMin?: boolean }>
> = {
  itemSpacing: { min: 0 },
  counterAxisSpacing: { min: 0 },
  paddingTop: { min: 0 },
  paddingRight: { min: 0 },
  paddingBottom: { min: 0 },
  paddingLeft: { min: 0 },
  width: { min: 0 },
  height: { min: 0 },
  x: {},
  y: {},
  fontSize: { min: 0, exclusiveMin: true },
  lineHeight: { min: 0 },
  minWidth: { min: 0 },
  maxWidth: { min: 0 },
  minHeight: { min: 0 },
  maxHeight: { min: 0 },
  gridColumnGap: { min: 0 },
  gridRowGap: { min: 0 },
  layoutGrow: { min: 0 }
}

/** Validates new numeric input without rewriting older authored values. */
export function responsiveNumberValid(key: ResponsiveNumericField, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const { min, exclusiveMin } = RESPONSIVE_NUMBER_LIMITS[key]
  return min === undefined || (exclusiveMin ? value > min : value >= min)
}

/**
 * The selected branch's authored/inherited field, not the rendered viewport value.
 * Min-width branches inherit preceding min-width branches; compact inherits base.
 * Overlapping compact and min-width CSS can resolve differently across targets.
 */
export function responsiveFieldState<K extends keyof ResponsiveOverride>(
  node: Pick<SceneNode, 'responsiveOverrides'> & ResponsiveOverride,
  breakpoint: ResponsiveBreakpoint,
  key: K
): { value: ResponsiveOverride[K]; source: 'base' | ResponsiveBreakpoint; overridden: boolean } {
  let value = node[key]
  let source: 'base' | ResponsiveBreakpoint = 'base'
  const chain: readonly ResponsiveBreakpoint[] =
    breakpoint === 'compact'
      ? ['compact']
      : MIN_WIDTH_BREAKPOINTS.slice(0, MIN_WIDTH_BREAKPOINTS.indexOf(breakpoint) + 1)
  for (const current of chain) {
    const override = node.responsiveOverrides?.[current]
    if (override && Object.hasOwn(override, key) && override[key] !== undefined) {
      value = override[key]
      source = current
    }
  }
  return { value, source, overridden: source === breakpoint }
}

/** undefined restores inheritance; null is an explicit authored reset. */
export function responsiveSetField<K extends keyof ResponsiveOverride>(
  overrides: ResponsiveOverrides | undefined,
  breakpoint: ResponsiveBreakpoint,
  key: K,
  value: ResponsiveOverride[K] | undefined
): ResponsiveOverrides {
  const current: ResponsiveOverride = overrides?.[breakpoint] ?? {}
  const { [key]: _removed, ...remaining } = current
  const branch = value === undefined ? remaining : { ...remaining, [key]: value }
  return Reflect.ownKeys(branch).length === 0
    ? responsiveClearBreakpoint(overrides, breakpoint)
    : { ...overrides, [breakpoint]: branch }
}

export function responsiveClearBreakpoint(
  overrides: ResponsiveOverrides | undefined,
  breakpoint: ResponsiveBreakpoint
): ResponsiveOverrides {
  const { [breakpoint]: _removed, ...next } = overrides ?? {}
  return next
}
