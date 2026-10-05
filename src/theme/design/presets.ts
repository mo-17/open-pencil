import { tv } from 'tailwind-variants'

export const designPresets = tv({
  slots: {
    options: 'grid gap-2 sm:grid-cols-3',
    option:
      'flex min-h-20 cursor-pointer flex-col gap-1 rounded border border-border p-3 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent/10',
    name: 'font-medium text-surface',
    description: 'text-xs leading-relaxed text-muted',
    preview: 'overflow-auto rounded border border-border',
    table: 'w-full border-collapse text-left text-xs',
    header: 'sticky top-0 bg-panel text-muted',
    cell: 'border-b border-border px-3 py-2',
    value: 'flex items-center gap-2 whitespace-nowrap font-mono',
    swatch: 'size-4 shrink-0 rounded border border-border'
  }
})
