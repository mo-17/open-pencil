<script setup lang="ts">
import { useStore } from '@nanostores/vue'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { VR_TOUR_MODULE_LIMITS, type VRTourSceneV1 } from '@open-pencil/core/plugins'
import { locale } from '@open-pencil/vue'

import { vrTourEditorCopy } from '@/app/plugins/vr-tour/copy'
import {
  addTourHotspot,
  addTourScene,
  cloneTourScenes,
  removeTourScene
} from '@/app/plugins/vr-tour/editor'
import ui from '@/theme/vr-tour-editor'

const { modelValue, label } = defineProps<{ modelValue: readonly VRTourSceneV1[]; label: string }>()
const emit = defineEmits<{ commit: [value: VRTourSceneV1[]] }>()
const currentLocale = useStore(locale)
const copy = computed(() => vrTourEditorCopy(currentLocale.value))
const draft = ref(cloneTourScenes(modelValue))
const root = useTemplateRef<HTMLDivElement>('root')
watch(
  () => modelValue,
  (value) => {
    draft.value = cloneTourScenes(value)
  },
  { deep: true }
)
const hotspotCount = computed(() =>
  draft.value.reduce((count, scene) => count + scene.hotspots.length, 0)
)

function commit() {
  if (JSON.stringify(draft.value) !== JSON.stringify(modelValue))
    emit('commit', cloneTourScenes(draft.value))
}
function addScene() {
  draft.value = addTourScene(draft.value, copy.value.newScene)
  commit()
}
async function removeScene(id: string) {
  draft.value = removeTourScene(draft.value, id)
  commit()
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('[data-command="add-tour-scene"]')?.focus()
}
function addHotspot(id: string) {
  draft.value = addTourHotspot(draft.value, id)
  commit()
}
async function removeHotspot(scene: VRTourSceneV1, id: string) {
  scene.hotspots = scene.hotspots.filter((entry) => entry.id !== id)
  commit()
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('[data-command="add-tour-scene"]')?.focus()
}
function shortcut(event: KeyboardEvent) {
  if (event.code !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  event.preventDefault()
  commit()
}
</script>

<template>
  <div
    ref="root"
    role="group"
    :aria-label="label"
    data-slot="vr-tour-scenes-editor"
    :class="ui.root"
    @keydown="shortcut"
  >
    <div :class="ui.toolbar">
      <button
        type="button"
        data-command="add-tour-scene"
        :class="ui.button"
        :disabled="draft.length >= VR_TOUR_MODULE_LIMITS.scenes"
        @click="addScene"
      >
        {{ copy.addScene }}
      </button>
      <span :class="ui.hint">{{ draft.length }} / {{ VR_TOUR_MODULE_LIMITS.scenes }}</span>
    </div>
    <p :class="ui.hint">{{ copy.privacy }}</p>
    <details v-for="(scene, index) in draft" :key="scene.id" :open="index === 0" :class="ui.scene">
      <summary :class="ui.summary">{{ scene.title || copy.room }} · {{ scene.id }}</summary>
      <div :class="ui.fields">
        <label :class="ui.field"
          >{{ copy.title }}
          <input
            v-model="scene.title"
            :class="ui.input"
            :maxlength="VR_TOUR_MODULE_LIMITS.label"
            @blur="commit"
          />
        </label>
        <label :class="ui.field"
          >{{ copy.panorama }}
          <input
            v-model="scene.panoramaUrl"
            :class="ui.input"
            :maxlength="VR_TOUR_MODULE_LIMITS.url"
            placeholder="https://example.com/room.jpg"
            spellcheck="false"
            @blur="commit"
          />
        </label>
        <fieldset v-for="hotspot in scene.hotspots" :key="hotspot.id" :class="ui.hotspot">
          <legend>{{ copy.hotspot }} · {{ hotspot.id }}</legend>
          <label :class="ui.field"
            >{{ copy.label }}
            <input
              v-model="hotspot.label"
              :class="ui.input"
              :maxlength="VR_TOUR_MODULE_LIMITS.label"
              @blur="commit"
            />
          </label>
          <label :class="ui.field"
            >{{ copy.target }}
            <select v-model="hotspot.targetSceneId" :class="ui.input" @change="commit">
              <option
                v-for="target in draft.filter((entry) => entry.id !== scene.id)"
                :key="target.id"
                :value="target.id"
              >
                {{ target.title }}
              </option>
            </select>
          </label>
          <div :class="ui.angles">
            <label :class="ui.field"
              >{{ copy.yaw }}
              <input
                v-model.number="hotspot.yaw"
                :class="ui.input"
                type="number"
                :min="VR_TOUR_MODULE_LIMITS.yawMin"
                :max="VR_TOUR_MODULE_LIMITS.yawMax"
                step="1"
                @blur="commit"
              />
            </label>
            <label :class="ui.field"
              >{{ copy.pitch }}
              <input
                v-model.number="hotspot.pitch"
                :class="ui.input"
                type="number"
                :min="VR_TOUR_MODULE_LIMITS.pitchMin"
                :max="VR_TOUR_MODULE_LIMITS.pitchMax"
                step="1"
                @blur="commit"
              />
            </label>
          </div>
          <button type="button" :class="ui.button" @click="removeHotspot(scene, hotspot.id)">
            {{ copy.removeHotspot }}
          </button>
        </fieldset>
        <button
          type="button"
          :class="ui.button"
          :disabled="
            draft.length < 2 ||
            scene.hotspots.length >= VR_TOUR_MODULE_LIMITS.hotspotsPerScene ||
            hotspotCount >= VR_TOUR_MODULE_LIMITS.hotspotsTotal
          "
          @click="addHotspot(scene.id)"
        >
          {{ copy.addHotspot }}
        </button>
        <button
          type="button"
          :class="ui.button"
          :disabled="draft.length <= 1"
          @click="removeScene(scene.id)"
        >
          {{ copy.removeScene }}
        </button>
      </div>
    </details>
    <p :class="ui.hint">{{ copy.hint }}</p>
  </div>
</template>
