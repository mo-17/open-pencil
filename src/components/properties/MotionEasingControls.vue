<script setup lang="ts">
import { computed } from 'vue'

import {
  MOTION_LIMITS,
  type MotionCubicBezierEasing,
  type MotionEaseMode,
  type MotionEasing,
  type MotionInertiaEasing,
  type MotionSpec,
  type MotionSpringEasing,
  type MotionStepsEasing
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import {
  createMotionEasing,
  motionEasingKind,
  motionEasingKindsForVersion,
  type MotionEasingKind
} from '@/app/properties/motion/easing'
import NumberField from '@/components/inputs/NumberField.vue'
import MotionCubicBezierEditor from '@/components/properties/MotionCubicBezierEditor.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'

type SelectValue = MotionEasingKind | 'inherit'

defineOptions({ inheritAttrs: false })

const {
  easing,
  motionVersion,
  allowInherited = false,
  propertyPrefix
} = defineProps<{
  easing: MotionEasing | undefined
  motionVersion: MotionSpec['version']
  allowInherited?: boolean
  propertyPrefix: string
}>()

const emit = defineEmits<{
  update: [value: MotionEasing | undefined, coalesceKey?: string]
}>()

const { panels } = useI18n()
const selectValue = computed<SelectValue>(() => {
  if (easing === undefined && allowInherited) return 'inherit'
  return motionEasingKind(easing)
})
const labels = computed<Record<MotionEasingKind, string>>(() => ({
  linear: panels.value.motionEasingLinear,
  ease: panels.value.motionEasingEase,
  'ease-in': panels.value.motionEasingEaseIn,
  'ease-out': panels.value.motionEasingEaseOut,
  'ease-in-out': panels.value.motionEasingEaseInOut,
  cubicBezier: panels.value.motionEasingCubicBezier,
  power: panels.value.motionEasingPower,
  sine: panels.value.motionEasingSine,
  expo: panels.value.motionEasingExpo,
  circ: panels.value.motionEasingCirc,
  back: panels.value.motionEasingBack,
  bounce: panels.value.motionEasingBounce,
  elastic: panels.value.motionEasingElastic,
  hold: panels.value.motionEasingHold,
  steps: panels.value.motionEasingSteps,
  spring: panels.value.motionEasingSpring,
  inertia: panels.value.motionEasingInertia
}))
const options = computed<Array<{ value: SelectValue; label: string }>>(() => {
  const values = motionEasingKindsForVersion(motionVersion)
  return [
    ...(allowInherited
      ? [{ value: 'inherit' as const, label: panels.value.motionEasingInherit }]
      : []),
    ...values.map((value) => ({ value, label: labels.value[value] }))
  ]
})
const cubicBezier = computed<MotionCubicBezierEasing | undefined>(() =>
  typeof easing === 'object' && easing.type === 'cubicBezier' ? easing : undefined
)
type ModeEasing = Extract<MotionEasing, { mode: MotionEaseMode }>
type PowerEasing = Extract<MotionEasing, { type: 'power' }>
type BackEasing = Extract<MotionEasing, { type: 'back' }>
type ElasticEasing = Extract<MotionEasing, { type: 'elastic' }>

const modeEasing = computed<ModeEasing | undefined>(() =>
  typeof easing === 'object' && 'mode' in easing ? (easing as ModeEasing) : undefined
)
const power = computed<PowerEasing | undefined>(() =>
  typeof easing === 'object' && easing.type === 'power' ? easing : undefined
)
const back = computed<BackEasing | undefined>(() =>
  typeof easing === 'object' && easing.type === 'back' ? easing : undefined
)
const elastic = computed<ElasticEasing | undefined>(() =>
  typeof easing === 'object' && easing.type === 'elastic' ? easing : undefined
)
const steps = computed<MotionStepsEasing | undefined>(() =>
  typeof easing === 'object' && easing.type === 'steps' ? easing : undefined
)
const spring = computed<MotionSpringEasing | undefined>(() =>
  typeof easing === 'object' && easing.type === 'spring' ? easing : undefined
)
const inertia = computed<MotionInertiaEasing | undefined>(() =>
  typeof easing === 'object' && easing.type === 'inertia' ? easing : undefined
)
const stepPositionOptions = computed<
  Array<{ value: MotionStepsEasing['position']; label: string }>
>(() => [
  { value: 'start', label: panels.value.motionEasingStepStart },
  { value: 'end', label: panels.value.motionEasingStepEnd }
])
const modeOptions = computed<Array<{ value: MotionEaseMode; label: string }>>(() => [
  { value: 'in', label: panels.value.motionEasingModeIn },
  { value: 'out', label: panels.value.motionEasingModeOut },
  { value: 'inOut', label: panels.value.motionEasingModeInOut }
])

function updateSelect(value: SelectValue): void {
  if (value === 'inherit') {
    emit('update', undefined)
    return
  }
  emit('update', createMotionEasing(value))
}

function updateBezier(value: MotionCubicBezierEasing, coalesceKey?: string): void {
  emit('update', value, coalesceKey)
}

function updateMode(mode: MotionEaseMode): void {
  if (!modeEasing.value) return
  emit('update', { ...modeEasing.value, mode })
}

function updatePower(value: number): void {
  if (!power.value) return
  const normalized = Math.min(4, Math.max(1, Math.round(value))) as PowerEasing['power']
  emit('update', { ...power.value, power: normalized })
}

function updateBack(overshoot: number): void {
  if (!back.value) return
  emit('update', { ...back.value, overshoot })
}

function updateElastic(patch: Partial<Pick<ElasticEasing, 'amplitude' | 'period'>>): void {
  if (!elastic.value) return
  emit('update', { ...elastic.value, ...patch })
}

function updateSteps(patch: Partial<Pick<MotionStepsEasing, 'steps' | 'position'>>): void {
  if (!steps.value) return
  emit('update', { ...steps.value, ...patch })
}

function updateSpring(
  patch: Partial<Pick<MotionSpringEasing, 'mass' | 'stiffness' | 'damping' | 'velocity'>>
): void {
  if (!spring.value) return
  emit('update', { ...spring.value, ...patch })
}

function updateInertia(
  patch: Partial<Pick<MotionInertiaEasing, 'velocity' | 'deceleration'>>
): void {
  if (!inertia.value) return
  emit('update', { ...inertia.value, ...patch })
}
</script>

<template>
  <div class="space-y-2">
    <PanelFieldGroup :label="panels.motionEasing">
      <AppSelect
        v-bind="$attrs"
        :model-value="selectValue"
        :label="panels.motionEasing"
        :options="options"
        @update:model-value="updateSelect"
      />
    </PanelFieldGroup>
    <MotionCubicBezierEditor
      v-if="cubicBezier"
      :value="cubicBezier"
      :property-prefix="propertyPrefix"
      @update="updateBezier"
    />
    <PanelGrid v-else-if="modeEasing" :columns="2" :data-test-id="`${propertyPrefix}-curve`">
      <PanelFieldGroup :label="panels.motionEasingMode">
        <AppSelect
          :model-value="modeEasing.mode"
          :label="panels.motionEasingMode"
          :options="modeOptions"
          :data-test-id="`${propertyPrefix}-curve-mode`"
          @update:model-value="updateMode"
        />
      </PanelFieldGroup>
      <NumberField
        v-if="power"
        :model-value="power.power"
        :label="panels.motionEasingPowerLevel"
        :min="1"
        :max="4"
        :step="1"
        :data-property="`${propertyPrefix}-power-level`"
        @commit="updatePower"
      />
      <NumberField
        v-if="back"
        :model-value="back.overshoot"
        :label="panels.motionEasingOvershoot"
        :min="MOTION_LIMITS.backOvershoot.min"
        :max="MOTION_LIMITS.backOvershoot.max"
        :step="0.05"
        :data-property="`${propertyPrefix}-back-overshoot`"
        @commit="updateBack"
      />
      <template v-if="elastic">
        <NumberField
          :model-value="elastic.amplitude"
          :label="panels.motionEasingAmplitude"
          :min="MOTION_LIMITS.elasticAmplitude.min"
          :max="MOTION_LIMITS.elasticAmplitude.max"
          :step="0.05"
          :data-property="`${propertyPrefix}-elastic-amplitude`"
          @commit="updateElastic({ amplitude: $event })"
        />
        <NumberField
          :model-value="elastic.period"
          :label="panels.motionEasingPeriod"
          :min="MOTION_LIMITS.elasticPeriod.min"
          :max="MOTION_LIMITS.elasticPeriod.max"
          :step="0.05"
          :data-property="`${propertyPrefix}-elastic-period`"
          @commit="updateElastic({ period: $event })"
        />
      </template>
    </PanelGrid>
    <PanelGrid v-else-if="steps" :columns="2" :data-test-id="`${propertyPrefix}-steps`">
      <PanelFieldGroup :label="panels.motionEasingStepCount">
        <NumberField
          :model-value="steps.steps"
          :label="panels.motionEasingStepCount"
          :min="MOTION_LIMITS.steps.min"
          :max="MOTION_LIMITS.steps.max"
          :step="1"
          :data-property="`${propertyPrefix}-steps-count`"
          @commit="updateSteps({ steps: $event })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="panels.motionEasingStepPosition">
        <AppSelect
          :model-value="steps.position"
          :label="panels.motionEasingStepPosition"
          :options="stepPositionOptions"
          :data-test-id="`${propertyPrefix}-steps-position`"
          @update:model-value="updateSteps({ position: $event })"
        />
      </PanelFieldGroup>
    </PanelGrid>
    <PanelGrid v-else-if="spring" :columns="2" :data-test-id="`${propertyPrefix}-spring`">
      <NumberField
        :model-value="spring.mass"
        :label="panels.motionEasingMass"
        :min="MOTION_LIMITS.springMass.min"
        :max="MOTION_LIMITS.springMass.max"
        :step="0.01"
        :data-property="`${propertyPrefix}-spring-mass`"
        @commit="updateSpring({ mass: $event })"
      />
      <NumberField
        :model-value="spring.stiffness"
        :label="panels.motionEasingStiffness"
        :min="MOTION_LIMITS.springStiffness.min"
        :max="MOTION_LIMITS.springStiffness.max"
        :step="1"
        :data-property="`${propertyPrefix}-spring-stiffness`"
        @commit="updateSpring({ stiffness: $event })"
      />
      <NumberField
        :model-value="spring.damping"
        :label="panels.motionEasingDamping"
        :min="MOTION_LIMITS.springDamping.min"
        :max="MOTION_LIMITS.springDamping.max"
        :step="1"
        :data-property="`${propertyPrefix}-spring-damping`"
        @commit="updateSpring({ damping: $event })"
      />
      <NumberField
        :model-value="spring.velocity"
        :label="panels.motionEasingVelocity"
        :min="MOTION_LIMITS.physicalVelocity.min"
        :max="MOTION_LIMITS.physicalVelocity.max"
        :step="1"
        :data-property="`${propertyPrefix}-spring-velocity`"
        @commit="updateSpring({ velocity: $event })"
      />
    </PanelGrid>
    <PanelGrid v-else-if="inertia" :columns="2" :data-test-id="`${propertyPrefix}-inertia`">
      <NumberField
        :model-value="inertia.velocity"
        :label="panels.motionEasingVelocity"
        :min="MOTION_LIMITS.physicalVelocity.min"
        :max="MOTION_LIMITS.physicalVelocity.max"
        :step="1"
        :data-property="`${propertyPrefix}-inertia-velocity`"
        @commit="updateInertia({ velocity: $event })"
      />
      <NumberField
        :model-value="inertia.deceleration"
        :label="panels.motionEasingDeceleration"
        :min="MOTION_LIMITS.inertiaDeceleration.min"
        :max="MOTION_LIMITS.inertiaDeceleration.max"
        :step="0.0001"
        :data-property="`${propertyPrefix}-inertia-deceleration`"
        @commit="updateInertia({ deceleration: $event })"
      />
    </PanelGrid>
  </div>
</template>
