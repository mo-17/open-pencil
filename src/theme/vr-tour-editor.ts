export default {
  root: 'flex min-w-0 flex-col gap-3 text-xs',
  toolbar: 'flex items-center justify-between gap-2',
  button:
    'min-h-9 rounded border border-border bg-panel-field px-2 text-xs text-surface outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40',
  scene: 'min-w-0 rounded-md border border-border bg-panel-field p-2',
  summary:
    'cursor-pointer py-2 text-xs font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent',
  fields: 'flex min-w-0 flex-col gap-3 pt-2',
  field: 'flex min-w-0 flex-col gap-1.5 text-[11px] text-muted',
  input:
    'h-9 w-full min-w-0 rounded border border-border bg-input px-2 text-xs text-surface outline-none focus:border-accent',
  hotspot: 'flex min-w-0 flex-col gap-2 rounded border border-border p-2',
  angles: 'grid grid-cols-2 gap-2',
  hint: 'text-[11px] leading-relaxed text-muted'
} as const
