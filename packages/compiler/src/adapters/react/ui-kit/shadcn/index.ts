import { controlledWriteCall } from '#compiler/adapters/react/emit/element'
import { motionDriverToken } from '#compiler/adapters/react/motion/drivers'
import { motionToken } from '#compiler/adapters/react/motion/key'
import type { IRAttrValue, IRControlledInput, IRElement, IRNode } from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/core/lowcode-validation'

import type { KitEmitCtx, UiKitAdapter, UiKitMapping } from '../types'
import {
  ACCORDION_TSX,
  ALERT_TSX,
  AVATAR_TSX,
  BADGE_TSX,
  BUTTON_TSX,
  CARD_TSX,
  CHECKBOX_TSX,
  COMPONENTS_JSON,
  INPUT_TSX,
  LABEL_TSX,
  PROGRESS_TSX,
  RADIO_GROUP_TSX,
  SELECT_TSX,
  SEPARATOR_TSX,
  SHADCN_THEME_CSS,
  SKELETON_TSX,
  SWITCH_TSX,
  TABS_TSX,
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
  '@radix-ui/react-select': '^2.1.4',
  '@radix-ui/react-avatar': '^1.2.0',
  '@radix-ui/react-progress': '^1.1.10',
  '@radix-ui/react-separator': '^1.1.10',
  '@radix-ui/react-tabs': '^1.1.12',
  '@radix-ui/react-accordion': '^1.2.11'
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
  Card: { file: 'src/components/ui/card.tsx', source: CARD_TSX, deps: [] },
  // Phase 4 §22 — display primitives.
  Badge: {
    file: 'src/components/ui/badge.tsx',
    source: BADGE_TSX,
    deps: ['class-variance-authority']
  },
  Alert: {
    file: 'src/components/ui/alert.tsx',
    source: ALERT_TSX,
    deps: ['class-variance-authority']
  },
  Separator: {
    file: 'src/components/ui/separator.tsx',
    source: SEPARATOR_TSX,
    deps: ['@radix-ui/react-separator']
  },
  Skeleton: { file: 'src/components/ui/skeleton.tsx', source: SKELETON_TSX, deps: [] },
  Progress: {
    file: 'src/components/ui/progress.tsx',
    source: PROGRESS_TSX,
    deps: ['@radix-ui/react-progress']
  },
  Avatar: {
    file: 'src/components/ui/avatar.tsx',
    source: AVATAR_TSX,
    deps: ['@radix-ui/react-avatar']
  },
  Tabs: {
    file: 'src/components/ui/tabs.tsx',
    source: TABS_TSX,
    deps: ['@radix-ui/react-tabs']
  },
  Accordion: {
    file: 'src/components/ui/accordion.tsx',
    source: ACCORDION_TSX,
    deps: ['@radix-ui/react-accordion']
  }
}

/** Phase 4 §15.1 — `containerKind` → the kit mapping for a card-like container
 *  FRAME. Card only renames the tag (`<div>` → `<Card>`) and keeps its children;
 *  no composed markup / extra imports. */
const CONTAINER_TO_MAPPING: Partial<Record<NonNullable<IRElement['containerKind']>, UiKitMapping>> =
  {
    card: { component: 'Card', from: '@/components/ui/card' }
  }

const DISPLAY_TO_MAPPING: Partial<Record<NonNullable<IRElement['displayKind']>, UiKitMapping>> = {
  badge: { component: 'Badge', from: '@/components/ui/badge' },
  alert: { component: 'Alert', from: '@/components/ui/alert' },
  separator: { component: 'Separator', from: '@/components/ui/separator' },
  skeleton: { component: 'Skeleton', from: '@/components/ui/skeleton' },
  progress: { component: 'Progress', from: '@/components/ui/progress' },
  avatar: {
    component: 'Avatar',
    from: '@/components/ui/avatar',
    imports: ['Avatar', 'AvatarFallback', 'AvatarImage']
  },
  tabs: {
    component: 'Tabs',
    from: '@/components/ui/tabs',
    imports: ['Tabs', 'TabsContent', 'TabsList', 'TabsTrigger']
  },
  accordion: {
    component: 'Accordion',
    from: '@/components/ui/accordion',
    imports: ['Accordion', 'AccordionContent', 'AccordionItem', 'AccordionTrigger']
  }
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
  valueExpr?: string
  labelNode: IRNode | undefined
}

function optionValue(value: IRAttrValue | undefined): { value: string; valueExpr?: string } {
  if (typeof value === 'string') return { value }
  if (typeof value === 'object' && value.kind === 'exprAttr') {
    return { value: '', valueExpr: emitExpression(value.ast) }
  }
  return { value: '' }
}

function optionValueCode(o: SelectOption): string {
  return o.valueExpr ?? JSON.stringify(o.value)
}

function selectItemValueAttr(o: SelectOption, ctx: KitEmitCtx): string {
  return o.valueExpr !== undefined ? `value={${o.valueExpr}}` : `value="${ctx.escapeAttr(o.value)}"`
}

/** SELECT children are `<option value>{label}</option>` — extract value + label. */
function selectOptions(children: readonly IRNode[]): SelectOption[] {
  const out: SelectOption[] = []
  for (const child of children) {
    if (child.kind !== 'element' || child.tag !== 'option') continue
    out.push({
      ...optionValue(child.attrs.value),
      labelNode: child.children[0]
    })
  }
  return out
}

function selectOptionFromTemplate(node: IRNode): SelectOption | null {
  if (node.kind !== 'element' || node.tag !== 'option') return null
  return { ...optionValue(node.attrs.value), labelNode: node.children[0] }
}

function selectOptionLists(children: readonly IRNode[], ctx: KitEmitCtx, pad: string): string[] {
  const out: string[] = []
  const innerPad = `${pad}  `
  for (const child of children) {
    if (child.kind !== 'list') continue
    const option = selectOptionFromTemplate(child.template)
    if (!option) continue
    const label = option.labelNode ? ctx.emitChild(option.labelNode, 0) : ''
    out.push(
      `${pad}{(${child.arrayName}).map((${child.itemName}, ${child.indexName}) => (`,
      `${innerPad}<SelectItem key={${child.indexName}} ${selectItemValueAttr(option, ctx)}>${label}</SelectItem>`,
      `${pad}))}`
    )
  }
  return out
}

interface OptionLeaf extends SelectOption {
  defaultChecked: boolean
  controlled: IRControlledInput | undefined
}

function optionLeafFromLabel(label: IRNode): OptionLeaf | null {
  if (label.kind !== 'element' || label.tag !== 'label') return null
  const input = label.children.find(
    (c): c is IRElement => c.kind === 'element' && c.tag === 'input'
  )
  if (!input) return null
  return {
    ...optionValue(input.attrs.value),
    labelNode: label.children.find((c) => c !== input),
    defaultChecked: input.attrs.defaultChecked === true,
    controlled: input.controlled
  }
}

/** RADIO / CHECKBOX-group wrapper children are
 *  `<label><input type=radio|checkbox value/> {label}</label>` — extract the
 *  per-option value, label, default-selection and controlled wiring (the collect
 *  pass copies the descriptor onto the option leaf, not the wrapper). Shared by
 *  `emitRadioGroup` (§15 Phase B) and `emitCheckboxGroup` (§15 Phase C). */
function optionLeaves(children: readonly IRNode[]): OptionLeaf[] {
  const out: OptionLeaf[] = []
  for (const label of children) {
    const option = optionLeafFromLabel(label)
    if (option) out.push(option)
  }
  return out
}

function firstOptionControlled(children: readonly IRNode[]): IRControlledInput | undefined {
  for (const option of optionLeaves(children)) {
    if (option.controlled) return option.controlled
  }
  for (const child of children) {
    if (child.kind !== 'list') continue
    const option = optionLeafFromLabel(child.template)
    if (option?.controlled) return option.controlled
  }
  return undefined
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

function emitDynamicOptionRow(
  controlLine: string,
  idExpr: string,
  labelNode: IRNode | undefined,
  i1: string,
  i2: string,
  ctx: KitEmitCtx
): string[] {
  return [
    `${i1}<div className="flex items-center gap-2">`,
    controlLine,
    `${i2}<label htmlFor={${idExpr}}>${labelNode ? ctx.emitChild(labelNode, 0) : ''}</label>`,
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

function rootAttrParts(node: IRElement, ctx: KitEmitCtx): string[] {
  const parts: string[] = []
  if (node.className) parts.push(`className="${ctx.escapeAttr(node.className)}"`)
  const style = node.attrs.style
  if (typeof style === 'object' && style.kind === 'styleAttr') {
    parts.push(`style={${formatStyleAttr(style.declarations)}}`)
  }
  if (
    ctx.devMode ||
    node.motion ||
    node.motionScene ||
    node.motionDriverMarker ||
    node.motionDrivers
  ) {
    parts.push(`data-node-id="${ctx.escapeAttr(node.sourceId)}"`)
  }
  if (node.motion) parts.push(`data-op-motion="${motionToken(node.motion)}"`)
  if (node.motionScene) {
    parts.push(`data-op-motion-scene-owner="${ctx.escapeAttr(node.sourceId)}"`)
  }
  if (node.motionDrivers) {
    parts.push(`data-op-motion-drivers="${motionDriverToken(node.motionDrivers)}"`)
    parts.push('data-op-motion-scope')
  }
  return parts
}

function formatStyleAttr(declarations: Record<string, string>): string {
  const entries = Object.entries(declarations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prop, value]) => `${prop}: ${JSON.stringify(value)}`)
  return `{ ${entries.join(', ')} }`
}

/** Emit a boolean toggle (Checkbox / Switch): `checked` + `onCheckedChange`, or
 *  uncontrolled `defaultChecked`. Checkbox's change yields `boolean |
 *  'indeterminate'` so it coerces to a strict boolean. */
function emitToggle(node: IRElement, ctx: KitEmitCtx, component: 'Checkbox' | 'Switch'): string {
  const pad = '  '.repeat(ctx.indent)
  const parts = rootAttrParts(node, ctx)
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
  const triggerParts = rootAttrParts(node, ctx)
  const staticItems = selectOptions(node.children).map(
    (o) =>
      `${i2}<SelectItem ${selectItemValueAttr(o, ctx)}>${o.labelNode ? ctx.emitChild(o.labelNode, 0) : ''}</SelectItem>`
  )
  const dynamicItems = selectOptionLists(node.children, ctx, i2)
  return [
    `${pad}<Select${attrSuffix(rootParts)}>`,
    `${i1}<SelectTrigger${attrSuffix(triggerParts)}>`,
    `${i2}<SelectValue />`,
    `${i1}</SelectTrigger>`,
    `${i1}<SelectContent>`,
    ...staticItems,
    ...dynamicItems,
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
  const rootParts = rootAttrParts(node, ctx)
  const options = optionLeaves(node.children)
  return {
    pad: '  '.repeat(ctx.indent),
    i1: '  '.repeat(ctx.indent + 1),
    i2: '  '.repeat(ctx.indent + 2),
    options,
    controlled: firstOptionControlled(node.children),
    rootParts
  }
}

function optionGroupLists(
  node: IRElement,
  ctx: KitEmitCtx,
  i1: string,
  renderControl: (option: OptionLeaf, idExpr: string, controlPad: string) => string
): string[] {
  const rows: string[] = []
  const innerPad = `${i1}  `
  const controlPad = `${innerPad}  `
  for (const child of node.children) {
    if (child.kind !== 'list') continue
    const option = optionLeafFromLabel(child.template)
    if (!option) continue
    const idExpr = `${JSON.stringify(node.sourceId)} + "-" + ${child.indexName}`
    rows.push(
      `${i1}{(${child.arrayName}).map((${child.itemName}, ${child.indexName}) => (`,
      ...emitDynamicOptionRow(
        renderControl(option, idExpr, controlPad),
        idExpr,
        option.labelNode,
        innerPad,
        controlPad,
        ctx
      ),
      `${i1}))}`
    )
  }
  return rows
}

/** Emit a shadcn `<RadioGroup>`; the controlled descriptor lives on the radio
 *  leaves, each option becomes a `<RadioGroupItem>` + `<label htmlFor>`. */
function emitRadioGroup(node: IRElement, ctx: KitEmitCtx): string {
  const { pad, i1, i2, options, controlled, rootParts } = optionGroupBase(node, ctx)
  const defaultValue = controlled ? undefined : options.find((o) => o.defaultChecked)?.value
  rootParts.push(...valueBindingParts(controlled, defaultValue, ctx))
  const rows = options.flatMap((o, i) => {
    const id = `${node.sourceId}-${i}`
    const control = `${i2}<RadioGroupItem ${selectItemValueAttr(o, ctx)} id="${ctx.escapeAttr(id)}" />`
    return emitOptionRow(control, id, o.labelNode, i1, i2, ctx)
  })
  const dynamicRows = optionGroupLists(
    node,
    ctx,
    i1,
    (o, idExpr, controlPad) =>
      `${controlPad}<RadioGroupItem ${selectItemValueAttr(o, ctx)} id={${idExpr}} />`
  )
  return [
    `${pad}<RadioGroup${attrSuffix(rootParts)}>`,
    ...rows,
    ...dynamicRows,
    `${pad}</RadioGroup>`
  ].join('\n')
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
      ? `${i2}<Checkbox ${idAttr} ${checkboxToggleParts(controlled, o)} />`
      : `${i2}<Checkbox ${idAttr} />`
    return emitOptionRow(control, id, o.labelNode, i1, i2, ctx)
  })
  const dynamicRows = optionGroupLists(node, ctx, i1, (o, idExpr, controlPad) =>
    controlled
      ? `${controlPad}<Checkbox id={${idExpr}} ${checkboxToggleParts(controlled, o)} />`
      : `${controlPad}<Checkbox id={${idExpr}} />`
  )
  return [`${pad}<div${attrSuffix(rootParts)}>`, ...rows, ...dynamicRows, `${pad}</div>`].join('\n')
}

function emitProgress(node: IRElement, ctx: KitEmitCtx): string {
  const pad = '  '.repeat(ctx.indent)
  const parts = rootAttrParts(node, ctx)
  if (node.display?.value !== undefined) parts.push(`value={${node.display.value}}`)
  return `${pad}<Progress${attrSuffix(parts)} />`
}

function emitAvatar(node: IRElement, ctx: KitEmitCtx): string {
  const pad = '  '.repeat(ctx.indent)
  const i1 = '  '.repeat(ctx.indent + 1)
  const parts = rootAttrParts(node, ctx)
  const src = node.display?.src
  const alt = node.display?.alt ?? ''
  const fallback = node.display?.fallback ?? ''
  const lines = [`${pad}<Avatar${attrSuffix(parts)}>`]
  if (src !== undefined) {
    lines.push(`${i1}<AvatarImage src="${ctx.escapeAttr(src)}" alt="${ctx.escapeAttr(alt)}" />`)
  }
  if (fallback !== '') {
    lines.push(`${i1}<AvatarFallback>{${JSON.stringify(fallback)}}</AvatarFallback>`)
  }
  lines.push(`${pad}</Avatar>`)
  return lines.join('\n')
}

function displayItems(node: IRElement): NonNullable<IRElement['display']>['items'] | null {
  const items = node.display?.items
  return items && items.length > 0 ? items : null
}

function indentParts(ctx: KitEmitCtx): { pad: string; i1: string; i2: string; i3: string } {
  return {
    pad: '  '.repeat(ctx.indent),
    i1: '  '.repeat(ctx.indent + 1),
    i2: '  '.repeat(ctx.indent + 2),
    i3: '  '.repeat(ctx.indent + 3)
  }
}

function emitTabs(node: IRElement, ctx: KitEmitCtx): string | null {
  const items = displayItems(node)
  if (!items) return null
  const { pad, i1, i2 } = indentParts(ctx)
  const parts = rootAttrParts(node, ctx)
  if (node.display?.valueBinding) {
    parts.push(`value={${node.display.valueBinding.read}}`)
    parts.push(
      `onValueChange={(value) => ${controlledWriteCall(node.display.valueBinding, 'value')}}`
    )
  } else {
    const defaultValue = node.display?.defaultValue ?? items[0]?.value
    if (defaultValue) parts.push(`defaultValue="${ctx.escapeAttr(defaultValue)}"`)
  }
  const lines = [`${pad}<Tabs${attrSuffix(parts)}>`]
  lines.push(`${i1}<TabsList>`)
  for (const item of items) {
    lines.push(
      `${i2}<TabsTrigger value="${ctx.escapeAttr(item.value)}">${ctx.escapeAttr(item.label)}</TabsTrigger>`
    )
  }
  lines.push(`${i1}</TabsList>`)
  for (const item of items) {
    lines.push(`${i1}<TabsContent value="${ctx.escapeAttr(item.value)}">`)
    lines.push(`${i2}{${JSON.stringify(item.content)}}`)
    lines.push(`${i1}</TabsContent>`)
  }
  lines.push(`${pad}</Tabs>`)
  return lines.join('\n')
}

function emitAccordion(node: IRElement, ctx: KitEmitCtx): string | null {
  const items = displayItems(node)
  if (!items) return null
  const { pad, i1, i2, i3 } = indentParts(ctx)
  const parts = rootAttrParts(node, ctx)
  const type = node.display?.type === 'multiple' ? 'multiple' : 'single'
  parts.push(`type="${type}"`)
  if (type === 'single' && node.display?.collapsible !== false) parts.push('collapsible')
  if (node.display?.valueBinding) {
    parts.push(`value={${node.display.valueBinding.read}}`)
    parts.push(
      `onValueChange={(value) => ${controlledWriteCall(node.display.valueBinding, 'value')}}`
    )
  } else if (type === 'single' && node.display?.defaultValue) {
    parts.push(`defaultValue="${ctx.escapeAttr(node.display.defaultValue)}"`)
  }
  const lines = [`${pad}<Accordion${attrSuffix(parts)}>`]
  for (const item of items) {
    lines.push(`${i1}<AccordionItem value="${ctx.escapeAttr(item.value)}">`)
    lines.push(`${i2}<AccordionTrigger>${ctx.escapeAttr(item.label)}</AccordionTrigger>`)
    lines.push(`${i2}<AccordionContent>`)
    lines.push(`${i3}{${JSON.stringify(item.content)}}`)
    lines.push(`${i2}</AccordionContent>`)
    lines.push(`${i1}</AccordionItem>`)
  }
  lines.push(`${pad}</Accordion>`)
  return lines.join('\n')
}

/** The `checked` + `onCheckedChange` props for one option of a controlled
 *  array checkbox-group: read `selected.includes(opt)`, write the array with the
 *  option spread in / filtered out depending on the new checked value. */
function checkboxToggleParts(controlled: IRControlledInput, option: SelectOption): string {
  const value = optionValueCode(option)
  const next = `checked === true ? [...${controlled.read}, ${value}] : ${controlled.read}.filter((v) => v !== ${value})`
  return `checked={${controlled.read}.includes(${value})} onCheckedChange={(checked) => ${controlledWriteCall(controlled, next)}}`
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

  mapDisplay(kind: NonNullable<IRElement['displayKind']>): UiKitMapping | null {
    return DISPLAY_TO_MAPPING[kind] ?? null
  },

  emitDisplay(node: IRElement, ctx: KitEmitCtx): string | null {
    switch (node.displayKind) {
      case 'progress':
        return emitProgress(node, ctx)
      case 'avatar':
        return emitAvatar(node, ctx)
      case 'tabs':
        return emitTabs(node, ctx)
      case 'accordion':
        return emitAccordion(node, ctx)
      default:
        return null
    }
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
