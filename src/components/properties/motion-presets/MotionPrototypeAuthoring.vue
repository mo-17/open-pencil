<script setup lang="ts">
import type {
  MotionEasingName,
  PrototypeAction,
  PrototypeConnection,
  PrototypeTransition,
  PrototypeTransitionDirection,
  PrototypeTrigger
} from '@open-pencil/scene-graph'

import { usePrototypeAuthoring } from './use/prototype-authoring'

const { selectedIds } = defineProps<{ selectedIds: string[] }>()

const {
  panels,
  canAuthor,
  connections,
  targets,
  errorMessage,
  transitionKeyDraft,
  addConnection,
  removeConnection,
  updateTrigger,
  updateDelay,
  updateAction,
  updateTarget,
  updateOverlayPlacement,
  updateDismissOnOutside,
  updateTransition,
  updateDuration,
  updateEasing,
  updateDirection,
  updateSmartMatchFallback,
  updateInterruption,
  updatePlayback,
  commitTransitionKey,
  resetTransitionKey
} = usePrototypeAuthoring(() => selectedIds)

const actionKinds: PrototypeAction['kind'][] = ['navigate', 'back', 'openOverlay', 'closeOverlay']
const transitionKinds: PrototypeTransition['kind'][] = [
  'instant',
  'dissolve',
  'slide',
  'push',
  'smartMatch'
]
const directions: PrototypeTransitionDirection[] = ['left', 'right', 'up', 'down']
const easings: MotionEasingName[] = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']

function value(event: Event): string {
  return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value
}

function numberValue(event: Event): number {
  return Number((event.currentTarget as HTMLInputElement).value)
}

function checked(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked
}

function actionLabel(kind: PrototypeAction['kind']): string {
  const labels = {
    navigate: panels.value.motionPrototypeNavigate,
    back: panels.value.motionPrototypeBack,
    openOverlay: panels.value.motionPrototypeOpenOverlay,
    closeOverlay: panels.value.motionPrototypeCloseOverlay
  }
  return labels[kind]
}

function transitionLabel(kind: PrototypeTransition['kind']): string {
  const labels = {
    instant: panels.value.motionPrototypeInstant,
    dissolve: panels.value.motionPrototypeDissolve,
    slide: panels.value.motionPrototypeSlide,
    push: panels.value.motionPrototypePush,
    smartMatch: panels.value.motionPrototypeSmartMatch
  }
  return labels[kind]
}

function onTrigger(id: string, event: Event): void {
  updateTrigger(id, value(event) as PrototypeTrigger['kind'])
}

function onAction(id: string, event: Event): void {
  updateAction(id, value(event) as PrototypeAction['kind'])
}

function onTransition(id: string, event: Event): void {
  updateTransition(id, value(event) as PrototypeTransition['kind'])
}
</script>

<template>
  <fieldset class="space-y-2" data-test-id="motion-prototype-authoring">
    <legend class="mb-1.5 text-[11px] text-muted">{{ panels.motionPrototype }}</legend>
    <p class="text-[10px] leading-4 text-muted">{{ panels.motionPrototypeHint }}</p>

    <p v-if="!canAuthor" class="rounded border border-border px-2 py-1.5 text-[10px] text-muted">
      {{ panels.motionPrototypeSelectOne }}
    </p>

    <template v-else>
      <label class="block text-[10px] text-muted">
        {{ panels.motionTransitionKey }}
        <input
          v-model="transitionKeyDraft"
          data-test-id="motion-transition-key"
          class="mt-1 w-full rounded border border-border bg-transparent px-2 py-1 text-[11px] text-foreground"
          maxlength="64"
          :placeholder="panels.motionTransitionKeyHint"
          @blur="commitTransitionKey"
          @keydown.enter.prevent="commitTransitionKey"
          @keydown.esc.prevent="resetTransitionKey"
        />
      </label>

      <div
        v-for="(connection, index) in connections"
        :key="connection.id"
        class="space-y-2 rounded border border-border p-2"
        :data-test-id="`motion-prototype-connection-${connection.id}`"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-[10px] font-medium">
            {{ panels.motionPrototypeConnection }} {{ index + 1 }} · {{ connection.id }}
          </span>
          <button
            type="button"
            class="text-[10px] text-danger hover:underline"
            @click="removeConnection(connection.id)"
          >
            {{ panels.motionPrototypeRemove }}
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="text-[10px] text-muted">
            {{ panels.motionTrigger }}
            <select
              :data-test-id="`motion-prototype-trigger-${connection.id}`"
              class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
              :value="connection.trigger.kind"
              @change="onTrigger(connection.id, $event)"
            >
              <option value="click">{{ panels.motionPrototypeTriggerClick }}</option>
              <option value="afterDelay">{{ panels.motionPrototypeTriggerAfterDelay }}</option>
            </select>
          </label>
          <label v-if="connection.trigger.kind === 'afterDelay'" class="text-[10px] text-muted">
            {{ panels.motionDelay }}
            <input
              type="number"
              min="0"
              max="60000"
              step="10"
              class="mt-1 w-full rounded border border-border bg-transparent px-1 py-1 text-[10px] text-foreground"
              :value="connection.trigger.delayMs"
              @change="updateDelay(connection.id, numberValue($event))"
            />
          </label>
        </div>

        <label class="block text-[10px] text-muted">
          {{ panels.motionPrototypeAction }}
          <select
            :data-test-id="`motion-prototype-action-${connection.id}`"
            class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
            :value="connection.action.kind"
            @change="onAction(connection.id, $event)"
          >
            <option v-for="kind in actionKinds" :key="kind" :value="kind">
              {{ actionLabel(kind) }}
            </option>
          </select>
        </label>

        <template
          v-if="connection.action.kind === 'navigate' || connection.action.kind === 'openOverlay'"
        >
          <label class="block text-[10px] text-muted">
            {{ panels.motionPrototypeTarget }}
            <select
              :data-test-id="`motion-prototype-target-${connection.id}`"
              class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
              :value="connection.action.targetNodeId"
              @change="updateTarget(connection.id, value($event))"
            >
              <option v-for="target in targets" :key="target.id" :value="target.id">
                {{ target.name }} · {{ target.type }}
              </option>
            </select>
          </label>
        </template>

        <div v-if="connection.action.kind === 'openOverlay'" class="grid grid-cols-2 gap-2">
          <label class="text-[10px] text-muted">
            {{ panels.motionPrototypePlacement }}
            <select
              class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
              :value="connection.action.placement"
              @change="
                updateOverlayPlacement(
                  connection.id,
                  value($event) as typeof connection.action.placement
                )
              "
            >
              <option
                v-for="placement in ['center', 'top', 'right', 'bottom', 'left']"
                :key="placement"
              >
                {{ placement }}
              </option>
            </select>
          </label>
          <label class="flex items-end gap-1 pb-1 text-[10px] text-muted">
            <input
              type="checkbox"
              :checked="connection.action.dismissOnOutside !== false"
              @change="updateDismissOnOutside(connection.id, checked($event))"
            />
            {{ panels.motionPrototypeDismissOutside }}
          </label>
        </div>

        <label class="block text-[10px] text-muted">
          {{ panels.motionPrototypeTransition }}
          <select
            :data-test-id="`motion-prototype-transition-${connection.id}`"
            class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
            :value="connection.transition.kind"
            @change="onTransition(connection.id, $event)"
          >
            <option v-for="kind in transitionKinds" :key="kind" :value="kind">
              {{ transitionLabel(kind) }}
            </option>
          </select>
        </label>

        <div v-if="connection.transition.kind !== 'instant'" class="grid grid-cols-2 gap-2">
          <label class="text-[10px] text-muted">
            {{ panels.motionDuration }}
            <input
              type="number"
              min="1"
              max="60000"
              step="10"
              class="mt-1 w-full rounded border border-border bg-transparent px-1 py-1 text-[10px] text-foreground"
              :value="connection.transition.durationMs"
              @change="updateDuration(connection.id, numberValue($event))"
            />
          </label>
          <label class="text-[10px] text-muted">
            {{ panels.motionEasing }}
            <select
              class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
              :value="connection.transition.easing"
              @change="updateEasing(connection.id, value($event) as MotionEasingName)"
            >
              <option v-for="easing in easings" :key="easing" :value="easing">{{ easing }}</option>
            </select>
          </label>
        </div>

        <label
          v-if="connection.transition.kind === 'slide' || connection.transition.kind === 'push'"
          class="block text-[10px] text-muted"
        >
          {{ panels.motionDirection }}
          <select
            class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
            :value="connection.transition.direction"
            @change="updateDirection(connection.id, value($event) as PrototypeTransitionDirection)"
          >
            <option v-for="direction in directions" :key="direction" :value="direction">
              {{ direction }}
            </option>
          </select>
        </label>

        <label
          v-if="connection.transition.kind === 'smartMatch'"
          class="block text-[10px] text-muted"
        >
          {{ panels.motionPrototypeFallback }}
          <select
            class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
            :value="connection.transition.fallback"
            @change="
              updateSmartMatchFallback(
                connection.id,
                value($event) as typeof connection.transition.fallback
              )
            "
          >
            <option value="dissolve">{{ panels.motionPrototypeDissolve }}</option>
            <option value="instant">{{ panels.motionPrototypeInstant }}</option>
          </select>
        </label>

        <div class="grid grid-cols-2 gap-2">
          <label class="text-[10px] text-muted">
            {{ panels.motionPrototypeInterruption }}
            <select
              class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
              :value="connection.interruption ?? 'replace'"
              @change="
                updateInterruption(
                  connection.id,
                  value($event) as NonNullable<PrototypeConnection['interruption']>
                )
              "
            >
              <option value="replace">{{ panels.motionCompositionReplace }}</option>
              <option value="queue">{{ panels.motionPrototypeQueue }}</option>
            </select>
          </label>
          <label class="text-[10px] text-muted">
            {{ panels.motionPrototypePlayback }}
            <select
              class="mt-1 w-full rounded border border-border bg-panel px-1 py-1 text-[10px] text-foreground"
              :value="connection.playback ?? 'forward'"
              @change="
                updatePlayback(
                  connection.id,
                  value($event) as NonNullable<PrototypeConnection['playback']>
                )
              "
            >
              <option value="forward">{{ panels.motionPrototypeForward }}</option>
              <option value="reverse">{{ panels.motionDirectionReverse }}</option>
            </select>
          </label>
        </div>
      </div>

      <button
        type="button"
        data-test-id="motion-prototype-add"
        class="w-full rounded border border-border px-2 py-1.5 text-[10px] hover:bg-accent"
        @click="addConnection"
      >
        {{ panels.motionPrototypeAdd }}
      </button>
    </template>

    <p v-if="errorMessage" role="alert" class="text-[10px] leading-4 text-danger">
      {{ errorMessage }}
    </p>
  </fieldset>
</template>
