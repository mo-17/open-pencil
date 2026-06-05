import type { IRAttrValue } from '#compiler/ir/types'

import type { UiKitAdapter, UiKitMapping } from '../types'

import {
  BUTTON_TSX,
  COMPONENTS_JSON,
  INPUT_TSX,
  LABEL_TSX,
  SHADCN_THEME_CSS,
  TEXTAREA_TSX,
  UTILS_TS
} from './templates'

/** Pinned dependency versions for the inlined shadcn components. */
const DEP_VERSIONS = {
  clsx: '^2.1.1',
  'tailwind-merge': '^2.5.5',
  'class-variance-authority': '^0.7.1',
  '@radix-ui/react-slot': '^1.1.1',
  '@radix-ui/react-label': '^2.1.1'
} as const

interface ShadcnComponent {
  /** Output file path for the inlined source. */
  readonly file: string
  /** The component source. */
  readonly source: string
  /** npm deps this component pulls in (beyond the always-present clsx + tailwind-merge). */
  readonly deps: readonly (keyof typeof DEP_VERSIONS)[]
}

/** Registry of the Phase A interactive components, keyed by emitted name.
 *  `Partial` so an indexed lookup is `ShadcnComponent | undefined` (a missing
 *  key really can occur — `used` names come from `mapTag`). */
const COMPONENTS: Partial<Record<string, ShadcnComponent>> = {
  Button: {
    file: 'src/components/ui/button.tsx',
    source: BUTTON_TSX,
    deps: ['class-variance-authority', '@radix-ui/react-slot']
  },
  Input: { file: 'src/components/ui/input.tsx', source: INPUT_TSX, deps: [] },
  Textarea: { file: 'src/components/ui/textarea.tsx', source: TEXTAREA_TSX, deps: [] },
  Label: {
    file: 'src/components/ui/label.tsx',
    source: LABEL_TSX,
    deps: ['class-variance-authority', '@radix-ui/react-label']
  }
}

/** tag → kit component (the `from` is fixed because every component lives under
 *  `@/components/ui/<lower>`). `input` is resolved separately in `mapTag` so
 *  checkbox/radio inputs stay plain HTML. */
const TAG_TO_COMPONENT: Partial<Record<string, string>> = {
  button: 'Button',
  input: 'Input',
  textarea: 'Textarea',
  label: 'Label'
}

function mappingFor(name: string): UiKitMapping {
  const lower = name.toLowerCase()
  return { component: name, from: `@/components/ui/${lower}` }
}

/** The component templates store the `@/` path alias as `__AT__/…` so the
 *  arch-rule's text scan doesn't read the emitted-code `import … from "@/…"`
 *  strings as real app-layer imports of THIS package. Restore it at emit time. */
function restoreAlias(source: string): string {
  return source.replaceAll('__AT__/', '@/')
}

/** Phase 3 §15 — the shadcn/ui adapter. Phase A maps BUTTON/text-INPUT/
 *  TEXTAREA/LABEL; Radix-composition controls (Select/Checkbox/Switch/Radio)
 *  stay plain HTML until a later phase wires their distinct event APIs. */
export const shadcnAdapter: UiKitAdapter = {
  name: 'shadcn',

  mapTag(tag: string, attrs: Readonly<Record<string, IRAttrValue>>): UiKitMapping | null {
    const name = TAG_TO_COMPONENT[tag]
    if (name === undefined) return null
    // `input` covers text INPUT (mapped) plus CHECKBOX/SWITCH (type="checkbox")
    // and RADIO leaves (type="radio") — those need shadcn's Radix composition +
    // a different event API, deferred to Phase B. Keep them as plain <input>.
    if (tag === 'input') {
      const type = attrs.type
      if (type === 'checkbox' || type === 'radio') return null
    }
    return mappingFor(name)
  },

  componentFiles(used: ReadonlySet<string>): Map<string, string> {
    const files = new Map<string, string>()
    for (const name of used) {
      const comp = COMPONENTS[name]
      if (comp) files.set(comp.file, restoreAlias(comp.source))
    }
    return files
  },

  sharedFiles(): Map<string, string> {
    return new Map<string, string>([
      ['src/lib/utils.ts', UTILS_TS],
      ['components.json', COMPONENTS_JSON]
    ])
  },

  deps(used: ReadonlySet<string>): Record<string, string> {
    const names = new Set<keyof typeof DEP_VERSIONS>(['clsx', 'tailwind-merge'])
    for (const name of used) {
      for (const dep of COMPONENTS[name]?.deps ?? []) names.add(dep)
    }
    const out: Record<string, string> = {}
    // Stable, sorted order so repeated emits are byte-identical.
    for (const dep of [...names].sort()) out[dep] = DEP_VERSIONS[dep]
    return out
  },

  themeCss(): string {
    return SHADCN_THEME_CSS
  }
}
