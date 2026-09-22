import { tv } from 'tailwind-variants'

export const contextUsageTheme = tv({
  slots: {
    root: 'shrink-0 border-t border-border px-3 py-1 text-[11px] text-muted',
    summary: 'cursor-pointer select-none',
    details: 'space-y-1 py-2',
    time: 'block'
  }
})
