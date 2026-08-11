import type { ArgsDef } from 'citty'

import type { UiKitName } from '@open-pencil/compiler'

/**
 * Phase 3 §15 — shared `--ui-kit` flag for the codegen commands (`compile`,
 * `build`). Emits interactive nodes (BUTTON/INPUT/TEXTAREA/LABEL) as a real code
 * UI-kit component (shadcn/ui) instead of hand-rolled Tailwind HTML. Shared so
 * both commands stay identical (and to avoid a jscpd clone), mirroring
 * `i18n-args.ts`.
 */
const UI_KITS = ['shadcn'] as const

export const uiKitArgs: ArgsDef = {
  'ui-kit': {
    type: 'string',
    description:
      'Emit React interactive nodes with a code UI kit (supported: shadcn; unavailable for Vue v1).',
    required: false
  }
}

/** The raw `--ui-kit` arg as citty parses it. */
export interface RawUiKitArgs {
  'ui-kit'?: string
}

/** Resolve `--ui-kit` to a kit name, or undefined when unset. An unknown value
 *  throws so a typo doesn't silently fall back to the plain-HTML emit. */
export function resolveUiKitFlag(args: RawUiKitArgs): UiKitName | undefined {
  const raw = args['ui-kit']
  if (raw === undefined || raw === '') return undefined
  if ((UI_KITS as readonly string[]).includes(raw)) return raw as UiKitName
  throw new Error(`Unknown --ui-kit "${raw}". Supported: ${UI_KITS.join(', ')}.`)
}
