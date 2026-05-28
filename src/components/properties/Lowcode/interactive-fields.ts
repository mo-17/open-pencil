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
  DATEPICKER: [{ key: 'value', kind: 'date', labelKey: 'lowcodeInteractiveDateValue' }],
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
