import type { CubicBezierCurveUI } from '@open-pencil/vue'

export const motionBezierCurveUI = {
  root: 'h-24 w-full touch-none rounded border border-border bg-input/70',
  grid: 'text-border',
  guide: 'text-muted',
  curve: 'text-accent',
  endpoint: 'text-surface',
  control:
    'size-2 cursor-grab rounded-full border-2 border-accent bg-panel outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing'
} satisfies CubicBezierCurveUI
