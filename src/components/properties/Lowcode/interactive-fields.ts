import { type DatePickerIssue, validateDatePickerProps } from '@open-pencil/core/lowcode-validation'
import type { SceneNode } from '@open-pencil/core/scene-graph'

// Phase 3 §3.v6 — declarative schema for the generic InteractiveProps editor.
//
// One entry per interactive NodeType lists the `interactiveProps` fields a
// user can author in the Properties panel. This is the single source that
// `InteractivePropsPanel.vue` renders from; adding a field = editing one
// array here instead of writing a bespoke panel (the recurring "interactiveProps
// has no UI" gap class from §3.v2 / §3.v4).
//
// Field set is kept aligned with the compiler's emit consumers in
// `packages/compiler/src/ir/collect/tree.ts` (`applyTextInputProps`,
// `applyToggleProps`, `applyDatePickerProps`, `applySelectOptions`,
// `applyRadioOptions`). When the compiler starts reading a new
// `interactiveProps` key, mirror it here so the field gets an editor.
//
// BUTTON.text is intentionally NOT here: it's the literal fallback for
// `bindings.text` (the binding wins when set) and lives next to the binding
// source selector in TextBindingPanel.vue (§3.v6 decision e).

export type FieldKind = 'text' | 'boolean' | 'date' | 'string-array' | 'enum'

export interface InteractiveField {
  /** The `interactiveProps` key this field reads/writes. */
  key: string
  kind: FieldKind
  /** i18n `panels` key for the field label. */
  labelKey: string
  /** i18n `panels` key for an input placeholder (text fields). */
  placeholderKey?: string
  /** i18n `panels` key for a helper line under the field. */
  hintKey?: string
  /** For `enum`: the sibling field key holding the `string[]` to choose from. */
  optionsFrom?: string
  /** When present, the field renders only if this returns true for the node's props. */
  visibleWhen?: (ip: Record<string, unknown>) => boolean
}

function hasOptions(ip: Record<string, unknown>): boolean {
  return Array.isArray(ip.options) && ip.options.length > 0
}

const TEXT_INPUT_FIELDS: InteractiveField[] = [
  { key: 'placeholder', kind: 'text', labelKey: 'lowcodeInteractivePlaceholder' },
  { key: 'value', kind: 'text', labelKey: 'lowcodeInteractiveValue' }
]

export const INTERACTIVE_PROP_FIELDS: Partial<Record<SceneNode['type'], InteractiveField[]>> = {
  INPUT: TEXT_INPUT_FIELDS,
  TEXTAREA: TEXT_INPUT_FIELDS,
  CHECKBOX: [
    {
      key: 'options',
      kind: 'string-array',
      labelKey: 'lowcodeInteractiveOptions',
      hintKey: 'lowcodeInteractiveOptionsHint'
    },
    {
      key: 'checked',
      kind: 'boolean',
      labelKey: 'lowcodeInteractiveDefaultChecked',
      visibleWhen: (ip) => !hasOptions(ip)
    }
  ],
  SWITCH: [{ key: 'checked', kind: 'boolean', labelKey: 'lowcodeInteractiveDefaultChecked' }],
  DATEPICKER: [
    { key: 'value', kind: 'date', labelKey: 'lowcodeInteractiveDateValue' },
    { key: 'min', kind: 'date', labelKey: 'lowcodeInteractiveMin' },
    { key: 'max', kind: 'date', labelKey: 'lowcodeInteractiveMax' }
  ],
  SELECT: [{ key: 'options', kind: 'string-array', labelKey: 'lowcodeInteractiveOptions' }],
  RADIO: [
    { key: 'options', kind: 'string-array', labelKey: 'lowcodeInteractiveOptions' },
    {
      key: 'groupName',
      kind: 'text',
      labelKey: 'lowcodeInteractiveGroupName',
      placeholderKey: 'lowcodeInteractiveGroupNamePlaceholder'
    },
    {
      key: 'value',
      kind: 'enum',
      labelKey: 'lowcodeInteractiveDefaultSelected',
      optionsFrom: 'options'
    }
  ]
}

// Phase 3 §3.v7 — per-NodeType interactiveProps validators. The panel runs
// the one registered for the selected node type and renders the returned
// issues as a warning bar (node-type-gated, so the generic field renderer
// stays untouched). The validators live in `@open-pencil/core/lowcode-validation`
// so the AI tool boundary and the compiler IR pass share them (经验 I).
export const INTERACTIVE_PROP_VALIDATORS: Partial<
  Record<SceneNode['type'], (ip: Record<string, unknown>) => DatePickerIssue[]>
> = {
  DATEPICKER: validateDatePickerProps
}

// Issue code → `panels` i18n key. Lives app-side because core validators are
// i18n-agnostic (they return stable codes, not user-facing strings).
export const INTERACTIVE_WARNING_KEYS: Record<string, string> = {
  'datepicker-invalid-value': 'lowcodeInteractiveDateInvalidValue',
  'datepicker-invalid-min': 'lowcodeInteractiveDateInvalidMin',
  'datepicker-invalid-max': 'lowcodeInteractiveDateInvalidMax',
  'datepicker-range-inverted': 'lowcodeInteractiveDateRangeInverted',
  'datepicker-value-out-of-range': 'lowcodeInteractiveDateValueOutOfRange'
}
