<script setup lang="ts">
import MotionSceneCueControls from './motion-scene/MotionSceneCueControls.vue'
import MotionSceneHeaderControls from './motion-scene/MotionSceneHeaderControls.vue'
import MotionSceneTrackViewport from './motion-scene/MotionSceneTrackViewport.vue'
import { provideMotionSceneTimelineView } from './motion-scene/use-motion-scene-timeline-view'

const scene = provideMotionSceneTimelineView()
</script>

<template>
  <section
    v-if="scene.owner"
    data-test-id="motion-scene-timeline"
    class="mb-3 border-b border-border pb-3"
  >
    <MotionSceneHeaderControls />
    <MotionSceneTrackViewport />
    <MotionSceneCueControls />

    <div
      v-if="scene.plannerIssues.length"
      role="status"
      data-test-id="motion-scene-issues"
      class="mt-2 rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[9px] leading-4 text-warning"
    >
      <div class="font-medium">{{ scene.panels.motionSceneIssues }}</div>
      <ul class="list-disc pl-3.5">
        <li v-for="issue in scene.plannerIssues" :key="`${issue.cueId}:${issue.code}`">
          {{ scene.issueLabel(issue) }}
        </li>
      </ul>
    </div>
    <p v-if="scene.errorMessage" role="alert" class="mt-2 text-[10px] leading-4 text-danger">
      {{ scene.errorMessage }}
    </p>
  </section>
</template>
