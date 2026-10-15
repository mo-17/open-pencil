<script setup lang="ts">
import { ref } from 'vue'

import type { MotionCubicBezierEasing } from '@open-pencil/scene-graph'

import CubicBezierCurve from '#vue/primitives/CubicBezierCurve/CubicBezierCurve.vue'

const value = ref<MotionCubicBezierEasing>({
  type: 'cubicBezier',
  x1: 0.25,
  y1: 0.1,
  x2: 0.25,
  y2: 1
})
const ui = {
  root: 'h-36 w-72 rounded border border-border bg-panel',
  grid: 'text-border',
  guide: 'text-muted',
  curve: 'text-accent',
  endpoint: 'text-surface',
  control:
    'size-2 rounded-full border-2 border-accent bg-panel focus-visible:ring-2 focus-visible:ring-accent'
}
</script>

<template>
  <CubicBezierCurve
    v-model="value"
    label="Easing curve"
    control-point-label="Control point"
    :min-y="-10"
    :max-y="10"
    :ui="ui"
  />
  <output role="status">{{ value.x1 }}, {{ value.y1 }}</output>
</template>
