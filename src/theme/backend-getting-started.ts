export default {
  slots: {
    card: 'mb-3 space-y-2 rounded-lg border border-border bg-panel-field p-3',
    title: 'text-xs font-semibold text-surface',
    paragraph: 'text-xs leading-relaxed text-muted',
    body: 'min-h-0 flex-1 space-y-5 overflow-y-auto p-4',
    section: 'space-y-3 rounded-lg border border-border p-4',
    heading: 'text-sm font-semibold text-surface',
    notice: 'rounded-md border border-border bg-panel-field p-3 text-xs leading-relaxed text-muted',
    warning:
      'rounded-md border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed text-warning',
    fields: 'grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]',
    label: 'text-muted',
    value: 'min-w-0 break-all font-mono text-surface',
    tags: 'flex flex-wrap gap-1.5',
    tag: 'max-w-full break-all rounded border border-border px-2 py-1 font-mono text-[11px] text-surface',
    module: 'space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0',
    summary: 'cursor-pointer text-xs font-medium text-surface',
    steps: 'list-inside list-decimal space-y-1.5 text-xs leading-relaxed text-muted',
    list: 'list-inside list-disc space-y-1.5 text-xs leading-relaxed text-muted',
    actions: 'flex flex-wrap gap-2',
    pages: 'grid grid-cols-1 gap-2 sm:grid-cols-2',
    page: 'min-w-0 justify-start text-left',
    pageText: 'min-w-0 whitespace-normal break-words',
    path: 'block break-all font-mono text-[10px] text-muted'
  }
} as const
