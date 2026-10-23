<script setup lang="ts">
import { computed } from 'vue'

import { readShaderPaints } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'

import ShaderPaintDetails from './ShaderPaintDetails.vue'

const { nodeIds } = defineProps<{ nodeIds: readonly string[] }>()
const store = useEditorStore()
const first = computed(() => {
  void store.state.sceneVersion
  const node = nodeIds
    .map((id) => store.graph.getNode(id))
    .find((node) => node && readShaderPaints(node).some((paint) => paint.input))
  const shader = node && readShaderPaints(node).find((paint) => paint.input)
  const index = node?.fills.findIndex((paint) => paint.imageHash === shader?.image) ?? -1
  return node && shader && index >= 0 ? { node, shader, index } : null
})
</script>

<template>
  <ShaderPaintDetails
    v-if="first"
    :node="first.node"
    :shader="first.shader"
    list="fills"
    :index="first.index"
    :selected-node-ids="nodeIds"
  />
</template>
