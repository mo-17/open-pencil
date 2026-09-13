<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@open-pencil/vue'
import { validateBackendClientAction } from '@open-pencil/lowcode/backend'
import type {
  BackendCommandAction,
  BackendCommandRecoveryAction,
  DocumentStateDef
} from '@open-pencil/scene-graph'
import { useBackendBindingApplication } from '@/app/lowcode/backend/bindings/context'
import { commerceCopy } from '@/app/lowcode/backend/commerce/copy'
type CommandAction = BackendCommandAction | BackendCommandRecoveryAction
const { action, docStates } = defineProps<{
  action: CommandAction
  docStates: readonly DocumentStateDef[]
}>()
const emit = defineEmits<{ 'update:action': [CommandAction] }>()
const { locale } = useI18n()
const text = computed(() => commerceCopy(locale.value))
const application = useBackendBindingApplication()
const commands = computed(() => application.value?.commands?.commands ?? [])
const command = computed(() => commands.value.find((entry) => entry.id === action.commandId))
const strings = computed(() =>
  docStates.filter((state) => state.type === 'string' && !state.persist && !state.computedExpr)
)
const attempts = computed(() => strings.value.filter((state) => state.defaultValue === ''))
const objects = computed(() =>
  docStates.filter((state) => state.type === 'object' && !state.persist && !state.computedExpr)
)
const diagnostics = computed(() =>
  application.value ? validateBackendClientAction(application.value, action, docStates) : []
)
const patch = (value: Partial<BackendCommandAction> | Partial<BackendCommandRecoveryAction>) =>
  emit('update:action', { ...action, ...value } as CommandAction)
function setParameter(key: string, valueExpr: string): void {
  if (action.kind !== 'backendCommand') return
  const entries = (action.payloadEntries ?? []).filter((entry) => entry.key !== key)
  if (valueExpr.trim()) entries.push({ key, valueExpr })
  patch({ payloadEntries: entries.length ? entries : undefined })
}
</script>
<template>
  <div class="flex w-full min-w-0 flex-col gap-2" data-test-id="backend-command-action-editor">
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ text.command }}
      <select
        :value="action.commandId"
        :aria-label="text.command"
        class="rounded border border-border bg-input p-1 text-xs text-surface"
        @change="
          patch({
            commandId: ($event.target as HTMLSelectElement).value,
            ...(action.kind === 'backendCommand' ? { payloadEntries: undefined } : {})
          })
        "
      >
        <option value="">—</option>
        <option v-for="entry in commands" :key="entry.id" :value="entry.id">
          {{ entry.name }} · {{ entry.id }}
        </option>
      </select>
    </label>
    <p v-if="!commands.length" class="text-[10px] text-amber-500">{{ text.empty }}</p>
    <template v-if="action.kind === 'backendCommand'">
      <label class="flex items-center gap-2 text-[10px] text-muted">
        <input
          type="checkbox"
          :checked="action.recovery === 'browser'"
          @change="
            patch({ recovery: ($event.target as HTMLInputElement).checked ? 'browser' : undefined })
          "
        />
        {{ text.recoveryEnabled }}
      </label>
      <p v-if="action.recovery" class="text-[10px] leading-relaxed text-muted">
        {{ text.recoveryStorage }}
      </p>
      <label
        v-for="parameter in command?.parameters ?? []"
        :key="parameter.name"
        class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ parameter.name }} · {{ text.valueExpression }}
        <input
          :value="
            action.payloadEntries?.find((entry) => entry.key === parameter.name)?.valueExpr ?? ''
          "
          maxlength="2048"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="setParameter(parameter.name, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </template>
    <template v-else>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ text.recoveryOperation }}
        <select
          :value="action.operation"
          :aria-label="text.recoveryOperation"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="
            patch({
              operation: ($event.target as HTMLSelectElement)
                .value as BackendCommandRecoveryAction['operation'],
              attemptKeyExpr:
                ($event.target as HTMLSelectElement).value === 'inspect' ? undefined : ''
            })
          "
        >
          <option value="inspect">{{ text.inspect }}</option>
          <option value="retry">{{ text.retry }}</option>
          <option value="acknowledge">{{ text.acknowledge }}</option>
        </select>
      </label>
      <label
        v-if="action.operation !== 'inspect'"
        class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ text.recoveryKey }}
        <input
          :value="action.attemptKeyExpr ?? ''"
          maxlength="2048"
          class="rounded border border-border bg-input p-1 text-xs text-surface"
          @change="patch({ attemptKeyExpr: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <p v-if="action.operation === 'acknowledge'" class="text-[10px] leading-relaxed text-muted">
        {{ text.recoveryConfirm }}
      </p>
    </template>
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ text.keyState }}
      <select
        :value="action.idempotencyKeyTarget"
        :aria-label="text.keyState"
        class="rounded border border-border bg-input p-1 text-xs text-surface"
        @change="patch({ idempotencyKeyTarget: ($event.target as HTMLSelectElement).value })"
      >
        <option value="">—</option>
        <option v-for="state in attempts" :key="state.id" :value="state.name">
          {{ state.name }}
        </option>
      </select>
    </label>
    <p class="text-[10px] leading-relaxed text-muted">{{ text.keyHint }}</p>
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ text.resultState }}
      <select
        :value="action.resultTarget ?? ''"
        :aria-label="text.resultState"
        class="rounded border border-border bg-input p-1 text-xs text-surface"
        @change="patch({ resultTarget: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">—</option>
        <option v-for="state in objects" :key="state.id" :value="state.name">
          {{ state.name }}
        </option>
      </select>
    </label>
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ text.errorState }}
      <select
        :value="action.errorTarget ?? ''"
        :aria-label="text.errorState"
        class="rounded border border-border bg-input p-1 text-xs text-surface"
        @change="patch({ errorTarget: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">—</option>
        <option v-for="state in strings" :key="state.id" :value="state.name">
          {{ state.name }}
        </option>
      </select>
    </label>
    <ul v-if="diagnostics.length" class="space-y-1 text-[10px] text-red-500">
      <li v-for="(entry, index) in diagnostics" :key="index">{{ entry.message }}</li>
    </ul>
  </div>
</template>
