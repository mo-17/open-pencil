<script setup lang="ts">
import { computed } from 'vue'
import { validateBackendClientAction } from '@open-pencil/lowcode/backend'
import type {
  ActionPayloadEntry,
  BackendAuthAction,
  BackendRequestAction,
  DocumentStateDef
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useBackendBindingApplication } from '@/app/lowcode/backend/bindings/context'
import BackendQueryBindings from '@/app/lowcode/backend/components/BackendQueryBindings.vue'

const { action, docStates } = defineProps<{
  action: BackendAuthAction | BackendRequestAction
  docStates: readonly DocumentStateDef[]
}>()
const emit = defineEmits<{ 'update:action': [BackendAuthAction | BackendRequestAction] }>()
const { panels } = useI18n()
const application = useBackendBindingApplication()
const resources = computed(() => application.value?.httpApi?.resources ?? [])
const resource = computed(() =>
  action.kind === 'backendRequest'
    ? resources.value.find((entry) => entry.id === action.resourceId)
    : undefined
)
const diagnostics = computed(() =>
  application.value ? validateBackendClientAction(application.value, action, docStates) : []
)
const fields = computed(() => {
  if (action.kind !== 'backendRequest') return []
  if (action.operation === 'create') return resource.value?.createFields ?? []
  if (action.operation === 'update') return resource.value?.updateFields ?? []
  return []
})
const resultStates = computed(() =>
  docStates.filter(
    (state) =>
      !state.persist &&
      !state.computedExpr &&
      state.type ===
        (action.kind === 'backendRequest' && action.operation === 'list' ? 'array' : 'object')
  )
)
const stringStates = computed(() =>
  docStates.filter((state) => state.type === 'string' && !state.persist && !state.computedExpr)
)
function patch(value: Partial<BackendAuthAction> | Partial<BackendRequestAction>): void {
  emit('update:action', { ...action, ...value } as BackendAuthAction | BackendRequestAction)
}
function setResource(value: string): void {
  if (action.kind !== 'backendRequest') return
  const selected = resources.value.find((entry) => entry.id === value)
  const operation = selected?.operations.includes(action.operation)
    ? action.operation
    : (selected?.operations[0] ?? 'list')
  emit('update:action', { id: action.id, kind: 'backendRequest', resourceId: value, operation })
}
function setOperation(operation: BackendRequestAction['operation']): void {
  if (action.kind !== 'backendRequest') return
  emit('update:action', {
    id: action.id,
    kind: 'backendRequest',
    resourceId: action.resourceId,
    operation
  })
}
function setPayload(key: string, valueExpr: string): void {
  if (action.kind !== 'backendRequest') return
  const entries: ActionPayloadEntry[] = (action.payloadEntries ?? []).filter(
    (entry) => entry.key !== key
  )
  if (valueExpr.trim()) entries.push({ key, valueExpr })
  patch({ payloadEntries: entries })
}
function payloadValue(key: string): string {
  return action.kind === 'backendRequest'
    ? (action.payloadEntries?.find((entry) => entry.key === key)?.valueExpr ?? '')
    : ''
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-2" data-property="backend-action">
    <p v-if="!application" class="text-[10px] text-amber-500">
      {{ panels.lowcodeBackendNoResource }}
    </p>
    <template v-if="action.kind === 'backendAuth'">
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendOperation }}
        <select
          :value="action.operation"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="
            emit('update:action', {
              id: action.id,
              kind: 'backendAuth',
              operation: ($event.target as HTMLSelectElement)
                .value as BackendAuthAction['operation'],
              errorTarget: action.errorTarget
            })
          "
        >
          <option value="signIn">Sign in</option>
          <option value="signOut">Sign out</option>
        </select>
      </label>
      <label v-if="action.operation === 'signIn'" class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendReturnPath }}
        <input
          :value="action.returnPath ?? ''"
          maxlength="256"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="patch({ returnPath: ($event.target as HTMLInputElement).value || undefined })"
        />
      </label>
    </template>
    <template v-else>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendResource }}
        <select
          :value="action.resourceId"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="setResource(($event.target as HTMLSelectElement).value)"
        >
          <option value="">—</option>
          <option v-for="entry in resources" :key="entry.id" :value="entry.id">
            {{ entry.id }} · {{ entry.path }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendOperation }}
        <select
          :value="action.operation"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="
            setOperation(
              ($event.target as HTMLSelectElement).value as BackendRequestAction['operation']
            )
          "
        >
          <option
            v-for="operation in resource?.operations ?? []"
            :key="operation"
            :value="operation"
          >
            {{ operation }}
          </option>
        </select>
      </label>
      <label
        v-if="['read', 'update', 'delete'].includes(action.operation)"
        class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendIdExpression }}
        <input
          :value="action.idExpr ?? ''"
          maxlength="2048"
          placeholder="item.id"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="patch({ idExpr: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label v-for="field in fields" :key="field" class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ field }} · {{ panels.lowcodeBackendFieldExpression }}
        <input
          :value="payloadValue(field)"
          maxlength="2048"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="setPayload(field, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendResultState }}
        <select
          :value="action.resultTarget ?? ''"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="patch({ resultTarget: ($event.target as HTMLSelectElement).value || undefined })"
        >
          <option value="">—</option>
          <option v-for="state in resultStates" :key="state.id" :value="state.name">
            {{ state.name }}
          </option>
        </select>
      </label>
      <template v-if="action.operation === 'list'">
        <BackendQueryBindings :query="action" :resource="resource" @update:query="patch" />
        <label class="flex flex-col gap-1 text-[10px] text-muted"
          >{{ panels.lowcodeBackendPageSize
          }}<input
            :value="action.limit ?? ''"
            type="number"
            min="1"
            :max="resource?.maxPageSize ?? 100"
            class="rounded border border-border bg-input p-1 text-xs text-surface"
            @change="
              patch({
                limit: ($event.target as HTMLInputElement).value
                  ? Number(($event.target as HTMLInputElement).value)
                  : undefined
              })
            "
        /></label>
        <label class="flex flex-col gap-1 text-[10px] text-muted"
          >{{ panels.lowcodeBackendAfterExpression
          }}<input
            :value="action.afterExpr ?? ''"
            maxlength="2048"
            class="rounded border border-border bg-input p-1 text-xs text-surface"
            @change="patch({ afterExpr: ($event.target as HTMLInputElement).value || undefined })"
        /></label>
        <label class="flex flex-col gap-1 text-[10px] text-muted"
          >{{ panels.lowcodeBackendCursorState
          }}<select
            :value="action.cursorTarget ?? ''"
            class="rounded border border-border bg-input p-1 text-xs text-surface"
            @change="
              patch({ cursorTarget: ($event.target as HTMLSelectElement).value || undefined })
            "
          >
            <option value="">—</option>
            <option v-for="state in stringStates" :key="state.id" :value="state.name">
              {{ state.name }}
            </option>
          </select></label
        >
      </template>
    </template>
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ panels.lowcodeBackendErrorState }}
      <select
        :value="action.errorTarget ?? ''"
        class="rounded border border-border bg-input p-1 text-xs text-surface"
        @change="patch({ errorTarget: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">—</option>
        <option v-for="state in stringStates" :key="state.id" :value="state.name">
          {{ state.name }}
        </option>
      </select>
    </label>
    <ul v-if="diagnostics.length" class="space-y-1 text-[10px] text-red-500">
      <li v-for="(entry, index) in diagnostics" :key="index">{{ entry.message }}</li>
    </ul>
  </div>
</template>
