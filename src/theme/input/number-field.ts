import { panelFieldBase } from '../panel/field'

const numberFieldTheme = {
  slots: {
    root: [
      panelFieldBase,
      'group flex h-auto min-h-6 flex-1 flex-wrap cursor-ew-resize items-center text-[11px] tabular-nums data-[disabled]:cursor-auto data-[editing]:cursor-auto'
    ],
    leading:
      'flex shrink-0 items-center justify-center self-stretch px-[5px] text-muted select-none [&>*]:pointer-events-none',
    field:
      'min-w-0 flex-1 cursor-text border-none bg-transparent pr-1.5 font-[inherit] text-[11px] text-surface outline-none',
    display:
      'flex min-w-max flex-1 items-center overflow-hidden data-[bound]:min-w-0 text-[11px] select-none',
    mixed: 'flex-1 text-muted',
    value: 'min-w-max flex-1 whitespace-nowrap text-surface',
    trailing: 'ml-auto flex min-h-5 shrink-0 items-center self-stretch',
    suffix: 'shrink-0 pr-1.5 text-muted'
  },
  variants: {
    /** A trailing control, such as the variable button, brings its own spacing after the unit. */
    suffix: {
      true: { display: 'pr-0', suffix: 'pr-0.5' },
      false: { display: 'pr-1.5' }
    }
  }
}

export type NumberFieldTheme = typeof numberFieldTheme
export default numberFieldTheme
