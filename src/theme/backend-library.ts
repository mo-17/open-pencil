export default {
  slots: {
    toolbar: 'flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3',
    categoryItem: 'flex-none px-3',
    body: 'grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(17rem,0.85fr)] md:overflow-hidden',
    list: 'min-w-0 space-y-3 p-4 md:overflow-y-auto',
    card: 'flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-border bg-panel-field p-4 text-left text-surface transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[selected=true]:border-accent data-[selected=true]:bg-accent/5',
    icon: 'flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-panel text-accent',
    detail:
      'min-w-0 space-y-5 border-t border-border bg-panel p-4 md:overflow-y-auto md:border-t-0 md:border-l',
    heading: 'text-[11px] font-semibold text-muted',
    paragraph: 'text-xs leading-relaxed text-muted',
    tags: 'flex flex-wrap gap-1.5',
    tag: 'max-w-full rounded border border-border px-1.5 py-0.5 text-[10px] break-all text-muted',
    select:
      'h-9 w-full min-w-0 rounded-md border border-border bg-input px-2 text-xs text-surface outline-none focus-visible:border-accent disabled:opacity-50',
    footer: 'flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3',
    notice: 'rounded-md border border-border bg-panel-field p-3 text-xs leading-relaxed text-muted',
    empty:
      'flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-xs text-muted'
  }
} as const
