import type { IRAttrValue, IRControlledInput, IRElement, IRNode } from '#compiler/ir/types'

import { controlledWriteCall } from '#compiler/adapters/react/emit/element'
import type { KitEmitCtx, UiKitAdapter, UiKitMapping } from '../types'

import {
  BUTTON_TSX,
  CARD_TSX,
  CHECKBOX_TSX,
  COMPONENTS_JSON,
  INPUT_TSX,
  LABEL_TSX,
  RADIO_GROUP_TSX,
  SELECT_TSX,
  SHADCN_THEME_CSS,
  SWITCH_TSX,
  TEXTAREA_TSX,
  UTILS_TS
} from './templates'

/** Pinned dependency versions for the inlined shadcn components. */
const DEP_VERSIONS = {
  clsx: '^2.1.1',
  'tailwind-merge': '^2.5.5',
  'class-variance-authority': '^0.7.1',
  '@radix-ui/react-slot': '^1.1.1',
  '@radix-ui/react-label': '^2.1.1',
  '@radix-ui/react-checkbox': '^1.1.3',
  '@radix-ui/react-switch': '^1.1.2',
  '@radix-ui/react-radio-group': '^1.2.2',
  '@radix-ui/react-select': '^2.1.4'
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
  },
  // Phase B — Radix-composition controls.
  Checkbox: {
    file: 'src/components/ui/checkbox.tsx',
    source: CHECKBOX_TSX,
    deps: ['@radix-ui/react-checkbox']
  },
  Switch: {
    file: 'src/components/ui/switch.tsx',
    source: SWITCH_TSX,
    deps: ['@radix-ui/react-switch']
  },
  RadioGroup: {
    file: 'src/components/ui/radio-group.tsx',
    source: RADIO_GROUP_TSX,
    deps: ['@radix-ui/react-radio-group']
  },
  Select: {
    file: 'src/components/ui/select.tsx',
    source: SELECT_TSX,
    deps: ['@radix-ui/react-select']
  },
  // Phase 4 §15.1 — Card is a plain styled `<div>` (cn() only), no Radix dep.
  Card: { file: 'src/components/ui/card.tsx', source: CARD_TSX, deps: [] }
}

/** Phase 4 §15.1 — `containerKind` → the kit mapping for a card-like container
 *  FRAME. Card only renames the tag (`<div>` → `<Card>`) and keeps its children;
 *  no composed markup / extra imports. */
const CONTAINER_TO_MAPPING: Partial<Record<NonNullable<IRElement['containerKind']>, UiKitMapping>> = {
  card: { component: 'Card', from: '@/components/ui/card' }
}

/** Phase B — `controlKind` → the kit mapping for a composed form control. The
 *  composed Select/RadioGroup pull several named exports from one module. */
const CONTROL_TO_MAPPING: Partial<Record<NonNullable<IRElement['controlKind']>, UiKitMapping>> = {
  checkbox: { component: 'Checkbox', from: '@/components/ui/checkbox' },
  // Phase 4 §15 Phase C — the array multi-select group reuses the single
  // Checkbox component (one `<Checkbox>` per option); no native group component.
  'checkbox-group': { component: 'Checkbox', from: '@/components/ui/checkbox' },
  switch: { component: 'Switch', from: '@/components/ui/switch' },
  'radio-group': {
    component: 'RadioGroup',
    from: '@/components/ui/radio-group',
    imports: ['RadioGroup', 'RadioGroupItem']
  },
  select: {
    component: 'Select',
    from: '@/components/ui/select',
    imports: ['Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue']
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

/** Space-prefixed attribute list, or '' when empty. */
function attrSuffix(parts: readonly string[]): string {
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

interface SelectOption {
  value: string
  labelNode: IRNode | undefined
}

/** SELECT children are `<option value>{label}</option>` — extract value + label. */
function selectOptions(children: readonly IRNode[]): SelectOption[] {
  const out: SelectOption[] = []
  for (const child of children) {
    if (child.kind !== 'element' || child.tag !== 'option') continue
    out.push({
      value: typeof child.attrs.value === 'string' ? child.attrs.value : '',
      labelNode: child.children[0]
    })
  }
  return out
}

interface OptionLeaf extends SelectOption {
  defaultChecked: boolean
  controlled: IRControlledInput | undefined
}

/** RADIO / CHECKBOX-group wrapper children are
 *  `<label><input type=radio|checkbox value/> {label}</label>` — extract the
 *  per-option value, label, default-selection and controlled wiring (the collect
 *  pass copies the descriptor onto the option leaf, not the wrapper). Shared by
 *  `emitRadioGroup` (§15 Phase B) and `emitCheckboxGroup` (§15 Phase C). */
function optionLeaves(children: readonly IRNode[]): OptionLeaf[] {
  const out: OptionLeaf[] = []
  for (const label of children) {
    if (label.kind !== 'element' || label.tag !== 'label') continue
    const input = label.children.find(
      (c): c is IRElement => c.kind === 'element' && c.tag === 'input'
    )
    if (!input) continue
    out.push({
      value: typeof input.attrs.value === 'string' ? input.attrs.value : '',
      labelNode: label.children.find((c) => c !== input),
      defaultChecked: input.attrs.defaultChecked === true,
      controlled: input.controlled
    })
  }
  return out
}

/** A composed option row shared by RADIO + CHECKBOX-group:
 *  `<div className="flex items-center gap-2">{control}<label htmlFor>label</label></div>`.
 *  `controlLine` is the already-padded `<RadioGroupItem>` / `<Checkbox>` line. */
function emitOptionRow(
  controlLine: string,
  id: string,
  labelNode: IRNode | undefined,
  i1: string,
  i2: string,
  ctx: KitEmitCtx
): string[] {
  return [
    `${i1}<div className="flex items-center gap-2">`,
    controlLine,
    `${i2}<label htmlFor="${ctx.escapeAttr(id)}">${labelNode ? ctx.emitChild(labelNode, 0) : ''}</label>`,
    `${i1}</div>`
  ]
}

/** Inline a controlled `string` two-way binding as shadcn's `value` +
 *  `onValueChange` (Select / RadioGroup), or fall back to `defaultValue`. */
function valueBindingParts(
  controlled: IRControlledInput | undefined,
  defaultValue: string | undefined,
  ctx: KitEmitCtx
): string[] {
  if (controlled) {
    return [
      `value={${controlled.read}}`,
      `onValueChange={(value) => ${controlledWriteCall(controlled, 'value')}}`
    ]
  }
  return defaultValue !== undefined ? [`defaultValue="${ctx.escapeAttr(defaultValue)}"`] : []
}

/** Emit a boolean toggle (Checkbox / Switch): `checked` + `onCheckedChange`, or
 *  uncontrolled `defaultChecked`. Checkbox's change yields `boolean |
 *  'indeterminate'` so it coerces to a strict boolean. */
function emitToggle(node: IRElement, ctx: KitEmitCtx, component: 'Checkbox' | 'Switch'): string {
  const pad = '  '.repeat(ctx.indent)
  const parts: string[] = []
  if (node.className) parts.push(`className="${ctx.escapeAttr(node.className)}"`)
  if (ctx.devMode) parts.push(`data-node-id="${ctx.escapeAttr(node.sourceId)}"`)
  if (node.controlled) {
    const value = component === 'Checkbox' ? 'checked === true' : 'checked'
    parts.push(`checked={${node.controlled.read}}`)
    parts.push(`onCheckedChange={(checked) => ${controlledWriteCall(node.controlled, value)}}`)
  } else if (node.attrs.defaultChecked === true) {
    parts.push('defaultChecked')
  }
  return `${pad}<${component}${attrSuffix(parts)} />`
}

/** Emit a shadcn `<Select>` composition; the design className lands on the
 *  trigger, each option becomes a `<SelectItem>` (label kept i18n-aware). */
function emitSelect(node: IRElement, ctx: KitEmitCtx): string {
  const pad = '  '.repeat(ctx.indent)
  const i1 = '  '.repeat(ctx.indent + 1)
  const i2 = '  '.repeat(ctx.indent + 2)
  const defaultValue =
    typeof node.attrs.defaultValue === 'string' ? node.attrs.defaultValue : undefined
  const rootParts = valueBindingParts(node.controlled, defaultValue, ctx)
  const triggerParts: string[] = []
  if (node.className) triggerParts.push(`className="${ctx.escapeAttr(node.className)}"`)
  if (ctx.devMode) triggerParts.push(`data-node-id="${ctx.escapeAttr(node.sourceId)}"`)
  const items = selectOptions(node.children).map(
    (o) =>
      `${i2}<SelectItem value="${ctx.escapeAttr(o.value)}">${o.labelNode ? ctx.emitChild(o.labelNode, 0) : ''}</SelectItem>`
  )
  return [
    `${pad}<Select${attrSuffix(rootParts)}>`,
    `${i1}<SelectTrigger${attrSuffix(triggerParts)}>`,
    `${i2}<SelectValue />`,
    `${i1}</SelectTrigger>`,
    `${i1}<SelectContent>`,
    ...items,
    `${i1}</SelectContent>`,
    `${pad}</Select>`
  ].join('\n')
}

/** Shared opening for the two composed option-group controls (RadioGroup +
 *  checkbox-group): indent units, the parsed option leaves + their shared
 *  controlled descriptor, and the root attrs common to both (the design
 *  `className` + dev-mode `data-node-id`). RadioGroup additionally appends the
 *  value binding; the checkbox-group uses `rootParts` as-is. */
interface OptionGroupBase {
  pad: string
  i1: string
  i2: string
  options: OptionLeaf[]
  controlled: IRControlledInput | undefined
  rootParts: string[]
}

function optionGroupBase(node: IRElement, ctx: KitEmitCtx): OptionGroupBase {
  const rootParts: string[] = []
  if (node.className) rootParts.push(`className="${ctx.escapeAttr(node.className)}"`)
  if (ctx.devMode) rootParts.push(`data-node-id="${ctx.escapeAttr(node.sourceId)}"`)
  const options = optionLeaves(node.children)
  return {
    pad: '  '.repeat(ctx.indent),
    i1: '  '.repeat(ctx.indent + 1),
    i2: '  '.repeat(ctx.indent + 2),
    options,
    controlled: options.find((o) => o.controlled)?.controlled,
    rootParts
  }
}

/** Emit a shadcn `<RadioGroup>`; the controlled descriptor lives on the radio
 *  leaves, each option becomes a `<RadioGroupItem>` + `<label htmlFor>`. */
function emitRadioGroup(node: IRElement, ctx: KitEmitCtx): string {
  const { pad, i1, i2, options, controlled, rootParts } = optionGroupBase(node, ctx)
  const defaultValue = controlled ? undefined : options.find((o) => o.defaultChecked)?.value
  rootParts.push(...valueBindingParts(controlled, defaultValue, ctx))
  const rows = options.flatMap((o, i) => {
    const id = `${node.sourceId}-${i}`
    const control = `${i2}<RadioGroupItem value="${ctx.escapeAttr(o.value)}" id="${ctx.escapeAttr(id)}" />`
    return emitOptionRow(control, id, o.labelNode, i1, i2, ctx)
  })
  return [`${pad}<RadioGroup${attrSuffix(rootParts)}>`, ...rows, `${pad}</RadioGroup>`].join('\n')
}

/** Phase 4 §15 Phase C — emit an array multi-select CHECKBOX group. shadcn has
 *  no native group component, so the wrapper stays a plain `<div>` (keeping the
 *  design's layout className) holding one `<Checkbox>` row per option. Each
 *  option's checked state is `selected.includes(opt)`; toggling spreads/filters
 *  the bound array (mirrors the plain-HTML `arrayCheckboxOnChangeBody`, adapted
 *  to shadcn's `onCheckedChange` whose arg is `boolean | 'indeterminate'`).
 *  Uncontrolled (no value binding) → bare `<Checkbox>` (multi-select has no
 *  single default-checked concept). */
function emitCheckboxGroup(node: IRElement, ctx: KitEmitCtx): string {
  const { pad, i1, i2, options, controlled, rootParts } = optionGroupBase(node, ctx)
  const rows = options.flatMap((o, i) => {
    const id = `${node.sourceId}-${i}`
    const idAttr = `id="${ctx.escapeAttr(id)}"`
    const control = controlled
      ? `${i2}<Checkbox ${idAttr} ${checkboxToggleParts(controlled, o.value)} />`
      : `${i2}<Checkbox ${idAttr} />`
    return emitOptionRow(control, id, o.labelNode, i1, i2, ctx)
  })
  return [`${pad}<div${attrSuffix(rootParts)}>`, ...rows, `${pad}</div>`].join('\n')
}

/** The `checked` + `onCheckedChange` props for one option of a controlled
 *  array checkbox-group: read `selected.includes(opt)`, write the array with the
 *  option spread in / filtered out depending on the new checked value. */
function checkboxToggleParts(controlled: IRControlledInput, optValue: string): string {
  const literal = JSON.stringify(optValue)
  const next = `checked === true ? [...${controlled.read}, ${literal}] : ${controlled.read}.filter((v) => v !== ${literal})`
  return `checked={${controlled.read}.includes(${literal})} onCheckedChange={(checked) => ${controlledWriteCall(controlled, next)}}`
}

/** Phase 3 §15 — the shadcn/ui adapter. Phase A maps BUTTON/text-INPUT/
 *  TEXTAREA/LABEL via `mapTag`; Phase B maps the Radix-composition controls
 *  (Select/Checkbox/Switch/RadioGroup) via `mapControl` + `emitControl` (their
 *  distinct event APIs + composed markup). Phase 4 §15 Phase C adds the array
 *  multi-select checkbox-group (N `<Checkbox>` rows + manual array toggle, since
 *  shadcn has no native group component). */
export const shadcnAdapter: UiKitAdapter = {
  name: 'shadcn',

  mapTag(tag: string, attrs: Readonly<Record<string, IRAttrValue>>): UiKitMapping | null {
    const name = TAG_TO_COMPONENT[tag]
    if (name === undefined) return null
    // `input` covers text INPUT (mapped) plus CHECKBOX/SWITCH (type="checkbox")
    // and RADIO leaves (type="radio"); those are handled via `mapControl` on
    // their control root, so the leaf inputs themselves stay plain <input>.
    if (tag === 'input') {
      const type = attrs.type
      if (type === 'checkbox' || type === 'radio') return null
    }
    return mappingFor(name)
  },

  mapControl(kind: NonNullable<IRElement['controlKind']>): UiKitMapping | null {
    return CONTROL_TO_MAPPING[kind] ?? null
  },

  mapContainer(kind: NonNullable<IRElement['containerKind']>): UiKitMapping | null {
    return CONTAINER_TO_MAPPING[kind] ?? null
  },

  emitControl(node: IRElement, ctx: KitEmitCtx): string | null {
    switch (node.controlKind) {
      case 'checkbox':
        return emitToggle(node, ctx, 'Checkbox')
      case 'switch':
        return emitToggle(node, ctx, 'Switch')
      case 'select':
        return emitSelect(node, ctx)
      case 'radio-group':
        return emitRadioGroup(node, ctx)
      case 'checkbox-group':
        return emitCheckboxGroup(node, ctx)
      default:
        return null
    }
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
