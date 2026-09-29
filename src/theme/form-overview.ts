import { tv } from 'tailwind-variants'

export const formOverviewTheme = tv({
  slots: {
    root: 'space-y-2 border-b border-border px-3 py-2 text-[11px]',
    heading: 'font-medium text-surface',
    steps: 'grid gap-1',
    step: 'h-auto min-h-7 w-full justify-between gap-2 whitespace-normal px-2 py-1 text-left text-[11px]',
    hint: 'text-[10px] leading-relaxed text-muted',
    stepLabel: 'block text-muted',
    count: 'shrink-0',
    details: 'cursor-pointer py-1 text-accent',
    fields: 'mt-1 max-h-64 space-y-2 overflow-y-auto',
    fieldName: 'block truncate text-surface',
    fieldActions: 'flex flex-wrap gap-x-2',
    link: 'h-auto whitespace-normal px-0 py-0.5 text-left text-[11px]',
    warning: 'space-y-1 text-muted'
  }
})
