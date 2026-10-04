<script setup lang="ts">
import { computed } from 'vue'

import type {
  ResponsiveBreakpoint,
  ResponsiveOverride,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'
import { MIXED, usePanelMessages } from '@open-pencil/vue'

import {
  responsiveFieldState,
  RESPONSIVE_NUMERIC_FIELDS,
  RESPONSIVE_NUMBER_LIMITS,
  responsiveNumberValid,
  responsiveSetField,
  type ResponsiveNumericField
} from '@/app/lowcode/responsive-editor/model'
import {
  useResponsiveFields,
  type ResponsiveEditContext
} from '@/app/lowcode/responsive-editor/use'
import NumberField from '@/components/inputs/NumberField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import ResponsiveFieldRow from './ResponsiveFieldRow.vue'

const { node, graph, breakpoint, context } = defineProps<{
  node: SceneNode
  graph: SceneGraph
  breakpoint: ResponsiveBreakpoint
  context: ResponsiveEditContext
}>()
const panels = usePanelMessages()
const { active, setField, clearBreakpoint } = useResponsiveFields({
  node: () => node,
  graph: graph,
  breakpoint: breakpoint,
  context: context
})
const labels = computed(
  () =>
    ({
      itemSpacing: panels.value.gap,
      counterAxisSpacing: panels.value.lowcodeResponsiveCounterSpacing,
      paddingTop: panels.value.lowcodeResponsivePaddingTop,
      paddingRight: panels.value.lowcodeResponsivePaddingRight,
      paddingBottom: panels.value.lowcodeResponsivePaddingBottom,
      paddingLeft: panels.value.lowcodeResponsivePaddingLeft,
      width: panels.value.width,
      height: panels.value.height,
      x: panels.value.xAxis,
      y: panels.value.yAxis,
      fontSize: panels.value.fontSize,
      lineHeight: panels.value.lineHeight,
      minWidth: panels.value.lowcodeResponsiveMinWidth,
      maxWidth: panels.value.lowcodeResponsiveMaxWidth,
      minHeight: panels.value.lowcodeResponsiveMinHeight,
      maxHeight: panels.value.lowcodeResponsiveMaxHeight,
      gridColumnGap: panels.value.lowcodeResponsiveGridColumnGap,
      gridRowGap: panels.value.lowcodeResponsiveGridRowGap,
      layoutGrow: panels.value.lowcodeResponsiveGrow
    }) satisfies Record<ResponsiveNumericField, string>
)
const selectFields = computed(
  () =>
    [
      { key: 'visible', label: panels.value.lowcodeResponsiveVisible, values: ['true', 'false'] },
      {
        key: 'layoutMode',
        label: panels.value.layout,
        values: ['NONE', 'FREE', 'HORIZONTAL', 'VERTICAL', 'GRID']
      },
      { key: 'layoutWrap', label: panels.value.lowcodeResponsiveWrap, values: ['NO_WRAP', 'WRAP'] },
      {
        key: 'primaryAxisSizing',
        label: panels.value.lowcodeResponsiveSizing,
        values: ['FIXED', 'HUG', 'FILL']
      },
      {
        key: 'counterAxisSizing',
        label: panels.value.lowcodeResponsiveCounterSizing,
        values: ['FIXED', 'HUG', 'FILL']
      },
      { key: 'layoutPositioning', label: panels.value.position, values: ['AUTO', 'ABSOLUTE'] },
      {
        key: 'primaryAxisAlign',
        label: panels.value.lowcodeResponsiveMainAlign,
        values: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']
      },
      {
        key: 'counterAxisAlign',
        label: panels.value.lowcodeResponsiveCrossAlign,
        values: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE']
      },
      { key: 'clipsContent', label: panels.value.clipContent, values: ['true', 'false'] }
    ] as const
)
type SelectField = (typeof selectFields.value)[number]['key']
const nullable = new Set<ResponsiveNumericField>([
  'lineHeight',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight'
])

function state<K extends keyof ResponsiveOverride>(key: K) {
  return responsiveFieldState(node, breakpoint, key)
}
function valueLabel(value: unknown): string {
  if (value === true) return panels.value.lowcodeResponsiveShow
  if (value === false) return panels.value.lowcodeResponsiveHide
  if (value === null) return panels.value.lowcodeResponsiveAuto
  return String(value)
}
function selectValue(key: SelectField): string {
  const own = node.responsiveOverrides?.[breakpoint]?.[key]
  return own === undefined ? 'inherit' : String(own)
}
function optionLabel(value: string): string {
  if (value === 'true') return valueLabel(true)
  if (value === 'false') return valueLabel(false)
  return valueLabel(value)
}
function selectOptions(field: (typeof selectFields.value)[number]) {
  const inherited = responsiveFieldState(
    {
      ...node,
      responsiveOverrides: responsiveSetField(
        node.responsiveOverrides,
        breakpoint,
        field.key,
        undefined
      )
    },
    breakpoint,
    field.key
  )
  return [
    {
      value: 'inherit',
      label: `${panels.value.lowcodeResponsiveInherit} · ${valueLabel(inherited.value)}`
    },
    ...field.values.map((value) => ({
      value,
      label: optionLabel(value)
    }))
  ]
}
function selectField(key: SelectField, value: string) {
  if (value === 'inherit') {
    setField(key, undefined)
    return
  }
  if (
    !selectFields.value.some(
      (field) => field.key === key && (field.values as readonly string[]).includes(value)
    )
  )
    return
  if (key === 'visible' || key === 'clipsContent') setField(key, value === 'true')
  else setField(key, value as ResponsiveOverride[Exclude<SelectField, 'visible' | 'clipsContent'>])
}
function numberValue(field: ResponsiveNumericField): number | symbol {
  const value = state(field).value
  return typeof value === 'number' ? value : MIXED
}
function numberCommit(field: ResponsiveNumericField, value: number) {
  if (responsiveNumberValid(field, value)) setField(field, value)
}
function resetLimit(field: ResponsiveNumericField) {
  if (
    field === 'lineHeight' ||
    field === 'minWidth' ||
    field === 'maxWidth' ||
    field === 'minHeight' ||
    field === 'maxHeight'
  )
    setField(field, null)
}
function gridColumns(value: number) {
  if (Number.isInteger(value) && value >= 1 && value <= 12)
    setField(
      'gridTemplateColumns',
      Array.from({ length: value }, () => ({ sizing: 'FR' as const, value: 1 }))
    )
}
function cancelActionDrafts(event: PointerEvent) {
  if (event.target instanceof HTMLElement && event.target.closest('[data-command]'))
    context.cancelDrafts()
}
</script>

<template>
  <div
    class="grid grid-cols-2 gap-x-2 gap-y-3"
    :data-breakpoint="breakpoint"
    @pointerdown.capture="cancelActionDrafts"
  >
    <AppButton
      class="col-span-2 justify-self-end"
      :disabled="!active || !node.responsiveOverrides?.[breakpoint]"
      data-command="clear-responsive-breakpoint"
      @click="clearBreakpoint"
      >{{ panels.lowcodeResponsiveClear }} · {{ breakpoint }}</AppButton
    >
    <ResponsiveFieldRow
      v-for="field in selectFields"
      :key="field.key"
      :label="field.label"
      :source="state(field.key).source"
      :overridden="state(field.key).overridden"
      :disabled="!active"
      :data-property="field.key"
      @restore="setField(field.key, undefined)"
      @override="setField(field.key, state(field.key).value)"
    >
      <AppSelect
        :model-value="selectValue(field.key)"
        :options="selectOptions(field)"
        :label="`${breakpoint} ${field.label}`"
        :disabled="!active"
        @update:model-value="selectField(field.key, $event)"
      />
    </ResponsiveFieldRow>
    <ResponsiveFieldRow
      :label="panels.gridColumns"
      :source="state('gridTemplateColumns').source"
      :overridden="state('gridTemplateColumns').overridden"
      :disabled="!active"
      data-property="gridTemplateColumns"
      @restore="setField('gridTemplateColumns', undefined)"
      @override="setField('gridTemplateColumns', state('gridTemplateColumns').value)"
    >
      <NumberField
        :model-value="state('gridTemplateColumns').value?.length || MIXED"
        :aria-label="`${breakpoint} ${panels.gridColumns}`"
        :placeholder="panels.lowcodeResponsiveAuto"
        :inherit-binding="false"
        :min="1"
        :max="12"
        :disabled="!active"
        @commit="gridColumns"
      />
      <p class="text-[10px] text-muted">{{ panels.lowcodeResponsiveEqualColumnsHint }}</p>
    </ResponsiveFieldRow>
    <ResponsiveFieldRow
      v-for="field in RESPONSIVE_NUMERIC_FIELDS"
      :key="field"
      :label="labels[field]"
      :source="state(field).source"
      :overridden="state(field).overridden"
      :disabled="!active"
      :data-property="field"
      @restore="setField(field, undefined)"
      @override="setField(field, state(field).value)"
    >
      <NumberField
        :model-value="numberValue(field)"
        :aria-label="`${breakpoint} ${labels[field]}`"
        :placeholder="
          field === 'lineHeight' ? panels.lowcodeResponsiveAuto : panels.lowcodeResponsiveNoLimit
        "
        :inherit-binding="false"
        :min="RESPONSIVE_NUMBER_LIMITS[field].min"
        :disabled="!active"
        @commit="numberCommit(field, $event)"
      />
      <AppButton
        v-if="nullable.has(field)"
        size="xs"
        :disabled="!active || (state(field).overridden && state(field).value === null)"
        data-command="clear-responsive-limit"
        @click="resetLimit(field)"
      >
        {{
          field === 'lineHeight' ? panels.lowcodeResponsiveAuto : panels.lowcodeResponsiveNoLimit
        }}
      </AppButton>
    </ResponsiveFieldRow>
  </div>
</template>
