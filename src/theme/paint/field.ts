export default {
  slots: {
    root: 'flex h-auto min-h-6 min-w-0 flex-1 flex-wrap items-center overflow-hidden rounded border border-transparent bg-panel-field text-[11px] transition-colors hover:bg-panel-field-hover focus-within:border-panel-focus focus-within:bg-panel-field-hover',
    main: 'flex min-w-[calc(6ch+1.75rem)] flex-1 items-center',
    controls: 'ml-auto flex min-h-5 shrink-0 items-center',
    preview: 'flex min-h-5 shrink-0 items-center pl-1',
    value: 'flex min-w-[6ch] flex-1 items-center pl-1 pr-1',
    divider: 'h-4 w-px shrink-0 bg-muted/40',
    opacity: 'min-h-5 w-13 flex-none shrink-0',
    binding: 'flex shrink-0 items-center pr-0.5'
  }
} as const
