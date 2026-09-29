import { tv } from 'tailwind-variants'

export const componentTemplates = tv({
  slots: {
    root: 'mb-3 min-w-0',
    heading: 'mb-1 px-1 text-[10px] font-medium text-muted',
    hint: 'mb-2 px-1 text-[11px] leading-4 text-muted',
    list: 'flex flex-col gap-2',
    card: 'min-w-0 rounded border border-border p-2',
    header: 'flex items-start gap-2',
    title: 'min-w-0 flex-1 text-xs font-medium text-surface',
    badge: 'mt-1 text-[10px] leading-4 text-muted',
    description: 'mt-2 text-[11px] leading-4 text-muted',
    details: 'mt-2 text-[11px] leading-4 text-muted',
    summary:
      'cursor-pointer rounded text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent',
    limitations: 'mt-1 list-disc space-y-1 pl-4',
    actions: 'mt-2 flex flex-col gap-2',
    star: 'size-3.5 data-[selected=true]:fill-current'
  }
})
