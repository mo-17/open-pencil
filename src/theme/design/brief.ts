import { tv } from 'tailwind-variants'

export const designBrief = tv({
  slots: {
    controls: 'flex flex-wrap items-end gap-3',
    field: 'flex min-w-36 flex-1 flex-col gap-1.5 text-xs',
    body: 'flex flex-col gap-4',
    preview: 'min-h-48 font-mono text-[11px] leading-relaxed',
    hint: 'text-[11px] leading-relaxed text-muted',
    label: 'text-xs font-medium text-surface',
    footer: 'flex flex-wrap items-center gap-2',
    status: 'mr-auto text-xs text-muted'
  }
})
