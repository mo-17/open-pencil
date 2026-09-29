import { tv } from 'tailwind-variants'

export const lowcodeEventsTheme = tv({
  slots: {
    actionFields:
      'flex min-w-0 flex-wrap items-center gap-1 [&>select]:min-w-0 [&>select]:max-w-full [&>input]:basis-24'
  }
})
