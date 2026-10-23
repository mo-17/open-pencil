import { tv } from 'tailwind-variants'

export const checkpointUI = tv({
  slots: {
    body: 'flex flex-col gap-4',
    form: 'flex items-end gap-2',
    field: 'flex min-w-0 flex-1 flex-col gap-1 text-xs text-surface',
    checkbox: 'flex items-center gap-2 text-xs text-muted',
    list: 'flex max-h-48 flex-col gap-2 overflow-y-auto',
    row: 'flex items-start gap-2 rounded border border-border p-2 data-selected:border-accent',
    metadata: 'min-w-0 flex-1 text-xs text-muted',
    name: 'truncate font-medium text-surface',
    actions: 'flex shrink-0 items-center gap-1',
    details: 'flex flex-col gap-2 rounded border border-border p-3 text-xs text-surface',
    summary: 'flex flex-wrap gap-3 text-muted',
    differences: 'flex max-h-40 flex-col gap-2 overflow-y-auto',
    entry: 'break-words text-muted',
    note: 'text-xs leading-relaxed text-muted'
  }
})()
