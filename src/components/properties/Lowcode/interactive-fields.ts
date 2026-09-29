import {
  DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
  DEFAULT_LOWCODE_TEXT_COLOR,
  LOWCODE_INPUT_TYPES,
  LOWCODE_INPUT_MODES,
  LOWCODE_AUTOCOMPLETE_VALUES,
  type DatePickerIssue,
  type TimeInputIssue,
  type DateTimeInputIssue,
  type ColorInputIssue,
  validateColorInputProps,
  validateTimeInputProps,
  validateDateTimeInputProps,
  validateDatePickerProps
} from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

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

export type FieldKind =
  | 'text'
  | 'boolean'
  | 'color'
  | 'date'
  | 'time'
  | 'datetime'
  | 'color-value'
  | 'optional-boolean'
  | 'suggestions'
  | 'string-array'
  | 'enum'
  | 'number'
  | 'select-options'
  | 'radio-options'

export interface InteractiveField {
  /** The `interactiveProps` key this field reads/writes. */
  key: string
  kind: FieldKind
  /** i18n `panels` key for the field label. */
  labelKey: string
  /** i18n `panels` key for an input placeholder (text fields). */
  placeholderKey?: string
  /** Default value shown when the field is absent (color fields). */
  defaultValue?: string
  /** i18n `panels` key for a helper line under the field. */
  hintKey?: string
  /** For `enum`: the sibling field key holding the `string[]` to choose from. */
  optionsFrom?: string
  choices?: readonly string[]
  choiceLabelKeys?: Readonly<Record<string, string>>
  min?: number
  step?: number
  /** When present, the field renders only if this returns true for the node's props. */
  visibleWhen?: (ip: Record<string, unknown>) => boolean
}

function hasOptions(ip: Record<string, unknown>): boolean {
  return Array.isArray(ip.options) && ip.options.length > 0
}

const COMMON_FIELDS: InteractiveField[] = [
  { key: 'ariaLabel', kind: 'text', labelKey: 'lowcodeControlAccessibleName' },
  { key: 'disabled', kind: 'boolean', labelKey: 'lowcodeControlDisabled' }
]
const AUTOCOMPLETE_FIELD: InteractiveField = {
  key: 'autoComplete',
  kind: 'enum',
  labelKey: 'lowcodeControlAutocomplete',
  choices: LOWCODE_AUTOCOMPLETE_VALUES
}
const READONLY_FIELD: InteractiveField = {
  key: 'readOnly',
  kind: 'boolean',
  labelKey: 'lowcodeControlReadOnly'
}
const TEXT_INPUT_FIELDS: InteractiveField[] = [
  { key: 'placeholder', kind: 'text', labelKey: 'lowcodeInteractivePlaceholder' },
  { key: 'value', kind: 'text', labelKey: 'lowcodeInteractiveValue' },
  {
    key: 'textColor',
    kind: 'color',
    labelKey: 'lowcodeInteractiveTextColor',
    defaultValue: DEFAULT_LOWCODE_TEXT_COLOR
  },
  {
    key: 'placeholderColor',
    kind: 'color',
    labelKey: 'lowcodeInteractivePlaceholderColor',
    defaultValue: DEFAULT_LOWCODE_PLACEHOLDER_COLOR
  },
  ...COMMON_FIELDS,
  READONLY_FIELD,
  {
    key: 'inputMode',
    kind: 'enum',
    labelKey: 'lowcodeControlInputMode',
    choices: LOWCODE_INPUT_MODES
  },
  AUTOCOMPLETE_FIELD,
  { key: 'minLength', kind: 'number', labelKey: 'lowcodeControlMinLength', min: 0, step: 1 },
  { key: 'maxLength', kind: 'number', labelKey: 'lowcodeControlMaxLength', min: 0, step: 1 }
]

export const INTERACTIVE_PROP_FIELDS: Partial<Record<SceneNode['type'], InteractiveField[]>> = {
  BUTTON: [
    ...COMMON_FIELDS,
    {
      key: 'textColor',
      kind: 'color',
      labelKey: 'lowcodeInteractiveTextColor',
      defaultValue: DEFAULT_LOWCODE_TEXT_COLOR
    }
  ],
  INPUT: [
    {
      key: 'inputType',
      kind: 'enum',
      labelKey: 'lowcodeControlInputType',
      choices: LOWCODE_INPUT_TYPES,
      hintKey: 'lowcodeInputTypeChangeHint'
    },
    ...TEXT_INPUT_FIELDS.map((field): InteractiveField => ({
      ...field,
      visibleWhen: (ip) =>
        !['time', 'datetime-local', 'color'].includes(String(ip.inputType)) ||
        ![
          'value',
          'placeholder',
          'placeholderColor',
          'inputMode',
          'minLength',
          'maxLength'
        ].includes(field.key)
    })),
    {
      key: 'value',
      kind: 'color-value',
      labelKey: 'lowcodeInteractiveValue',
      hintKey: 'lowcodeColorFormatHint',
      visibleWhen: (ip) => ip.inputType === 'color'
    },
    {
      key: 'suggestions',
      kind: 'suggestions',
      labelKey: 'lowcodeInputSuggestions',
      hintKey: 'lowcodeInputSuggestionsHint',
      visibleWhen: (ip) =>
        ip.inputType === undefined || ip.inputType === 'text' || ip.inputType === 'search'
    },
    ...(['value', 'min', 'max'] as const).map((key): InteractiveField => ({
      key,
      kind: 'time',
      labelKey: { value: 'lowcodeInteractiveValue', min: 'lowcodeTimeMin', max: 'lowcodeTimeMax' }[
        key
      ],
      hintKey: 'lowcodeTimeFormatHint',
      visibleWhen: (ip) => ip.inputType === 'time'
    })),
    ...(['value', 'min', 'max'] as const).map((key): InteractiveField => ({
      key,
      kind: 'datetime',
      labelKey: {
        value: 'lowcodeInteractiveValue',
        min: 'lowcodeDateTimeMin',
        max: 'lowcodeDateTimeMax'
      }[key],
      hintKey: 'lowcodeDateTimeFormatHint',
      visibleWhen: (ip) => ip.inputType === 'datetime-local'
    })),
    {
      key: 'step',
      kind: 'number',
      labelKey: 'lowcodeTimeStep',
      min: 1,
      step: 1,
      visibleWhen: (ip) => ip.inputType === 'time' || ip.inputType === 'datetime-local'
    },
    ...(['min', 'max', 'step'] as const).map((key): InteractiveField => ({
      key,
      kind: 'number',
      labelKey: `lowcodeControlNumber${key[0].toUpperCase()}${key.slice(1)}`,
      visibleWhen: (ip) => ip.inputType === 'number'
    })),
    {
      key: 'showStepper',
      kind: 'optional-boolean',
      labelKey: 'lowcodeInputStepper',
      hintKey: 'lowcodeInputStepperHint',
      visibleWhen: (ip) => ip.inputType === 'number'
    },
    {
      key: 'stepperPlacement',
      kind: 'enum',
      labelKey: 'lowcodeInputStepperPlacement',
      choices: ['end', 'sides'],
      choiceLabelKeys: {
        end: 'lowcodeInputStepperEnd',
        sides: 'lowcodeInputStepperSides'
      },
      visibleWhen: (ip) => ip.inputType === 'number' && ip.showStepper === true
    },
    {
      key: 'showPasswordToggle',
      kind: 'boolean',
      labelKey: 'lowcodePasswordToggle',
      hintKey: 'lowcodePasswordHint',
      visibleWhen: (ip) => ip.inputType === 'password'
    }
  ],
  TEXTAREA: TEXT_INPUT_FIELDS,
  CHECKBOX: [
    ...COMMON_FIELDS,
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
  SWITCH: [
    ...COMMON_FIELDS,
    { key: 'checked', kind: 'boolean', labelKey: 'lowcodeInteractiveDefaultChecked' }
  ],
  DATEPICKER: [
    ...COMMON_FIELDS,
    READONLY_FIELD,
    { key: 'value', kind: 'date', labelKey: 'lowcodeInteractiveDateValue' },
    { key: 'min', kind: 'date', labelKey: 'lowcodeInteractiveMin' },
    { key: 'max', kind: 'date', labelKey: 'lowcodeInteractiveMax' }
  ],
  SELECT: [
    { key: 'options', kind: 'select-options', labelKey: 'lowcodeInteractiveOptions' },
    { key: 'placeholder', kind: 'text', labelKey: 'lowcodeInteractivePlaceholder' },
    { key: 'allowClear', kind: 'boolean', labelKey: 'lowcodeSelectAllowClear' },
    {
      key: 'showSearch',
      kind: 'boolean',
      labelKey: 'lowcodeSelectShowSearch',
      hintKey: 'lowcodeSelectSearchHint'
    },
    {
      key: 'virtual',
      kind: 'boolean',
      labelKey: 'lowcodeSelectVirtual',
      hintKey: 'lowcodeSelectVirtualHint'
    },
    ...COMMON_FIELDS,
    AUTOCOMPLETE_FIELD,
    {
      key: 'textColor',
      kind: 'color',
      labelKey: 'lowcodeInteractiveTextColor',
      defaultValue: DEFAULT_LOWCODE_TEXT_COLOR
    },
    {
      key: 'placeholderColor',
      kind: 'color',
      labelKey: 'lowcodeInteractivePlaceholderColor',
      defaultValue: DEFAULT_LOWCODE_PLACEHOLDER_COLOR
    }
  ],
  RADIO: [
    { key: 'options', kind: 'radio-options', labelKey: 'lowcodeInteractiveOptions' },
    {
      key: 'groupName',
      kind: 'text',
      labelKey: 'lowcodeInteractiveGroupName',
      placeholderKey: 'lowcodeInteractiveGroupNamePlaceholder'
    },
    ...COMMON_FIELDS
  ]
}

// Phase 3 §3.v7 — per-NodeType interactiveProps validators. The panel runs
// the one registered for the selected node type and renders the returned
// issues as a warning bar (node-type-gated, so the generic field renderer
// stays untouched). The validators live in `@open-pencil/lowcode`
// so the AI tool boundary and the compiler IR pass share them (经验 I).
export const INTERACTIVE_PROP_VALIDATORS: Partial<
  Record<
    SceneNode['type'],
    (
      ip: Record<string, unknown>
    ) => (DatePickerIssue | TimeInputIssue | DateTimeInputIssue | ColorInputIssue)[]
  >
> = {
  INPUT: (ip) => {
    if (ip.inputType === 'color') return validateColorInputProps(ip)
    if (ip.inputType === 'datetime-local') return validateDateTimeInputProps(ip)
    return ip.inputType === 'time' ? validateTimeInputProps(ip) : []
  },
  DATEPICKER: validateDatePickerProps
}

// Issue code → `panels` i18n key. Lives app-side because core validators are
// i18n-agnostic (they return stable codes, not user-facing strings).
export const INTERACTIVE_WARNING_KEYS: Record<string, string> = {
  'color-input-invalid-value': 'lowcodeColorInvalid',
  'date-time-input-invalid-value': 'lowcodeDateTimeInvalid',
  'date-time-input-invalid-min': 'lowcodeDateTimeInvalid',
  'date-time-input-invalid-max': 'lowcodeDateTimeInvalid',
  'date-time-input-invalid-step': 'lowcodeTimeStepInvalid',
  'date-time-input-range-inverted': 'lowcodeDateTimeRangeInverted',
  'date-time-input-value-out-of-range': 'lowcodeDateTimeOutsideRange',
  'date-time-input-step-mismatch': 'lowcodeDateTimeStepMismatch',
  'time-input-invalid-value': 'lowcodeTimeInvalid',
  'time-input-invalid-min': 'lowcodeTimeInvalid',
  'time-input-invalid-max': 'lowcodeTimeInvalid',
  'time-input-invalid-step': 'lowcodeTimeStepInvalid',
  'time-input-value-out-of-range': 'lowcodeTimeOutsideRange',
  'time-input-step-mismatch': 'lowcodeTimeStepMismatch',
  'datepicker-invalid-value': 'lowcodeInteractiveDateInvalidValue',
  'datepicker-invalid-min': 'lowcodeInteractiveDateInvalidMin',
  'datepicker-invalid-max': 'lowcodeInteractiveDateInvalidMax',
  'datepicker-range-inverted': 'lowcodeInteractiveDateRangeInverted',
  'datepicker-value-out-of-range': 'lowcodeInteractiveDateValueOutOfRange'
}
