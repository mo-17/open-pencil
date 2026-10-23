export default {
  slots: {
    body: 'min-h-0 flex-1 space-y-4 overflow-y-auto p-4',
    steps: 'flex flex-wrap gap-3 text-xs text-muted',
    fields: 'min-w-0 space-y-3',
    legend: 'mb-2 text-sm font-semibold text-surface',
    field: 'flex flex-col gap-1 text-xs text-muted',
    select: 'h-9 rounded border border-border bg-input px-2 text-sm text-surface',
    paragraph: 'text-xs leading-relaxed text-muted',
    list: 'list-inside list-disc space-y-1 text-xs leading-relaxed text-muted',
    features: 'list-inside list-disc space-y-1 text-xs text-surface',
    section: 'space-y-3',
    heading: 'text-sm font-semibold text-surface',
    subheading: 'text-xs font-medium text-surface',
    definition: 'space-y-2 break-all text-xs text-muted',
    value: 'break-all font-mono',
    readiness: 'space-y-4',
    checks: 'space-y-3',
    check: 'space-y-2 rounded-lg border border-border p-3',
    checkHeading: 'flex flex-wrap items-center justify-between gap-2',
    detail: 'space-y-2',
    requirements: 'list-inside list-disc space-y-2 text-xs leading-relaxed text-muted',
    pages: 'flex flex-wrap gap-2'
  }
} as const
