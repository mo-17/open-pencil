<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type { SupabaseDatabaseReadConnectionMode } from '@/app/lowcode/supabase/database-read-connection-profile'
import type {
  SupabaseDatabaseReadCredentialSettingsControllerV1,
  SupabaseDatabaseReadCredentialSettingsSnapshotV1
} from '@/app/lowcode/supabase/database-read-credential-settings'
import AppBadge from '@/components/ui/feedback/AppBadge.vue'

const { controller } = defineProps<{
  controller: SupabaseDatabaseReadCredentialSettingsControllerV1
}>()

const { locale } = useI18n()
const state = ref<SupabaseDatabaseReadCredentialSettingsSnapshotV1>(controller.snapshot())
const projectRef = ref('')
const accountId = ref('')
const mode = ref<SupabaseDatabaseReadConnectionMode>('direct')
const sessionPoolerHost = ref('')

const copy = computed(() =>
  locale.value === 'zh-CN'
    ? {
        title: 'Supabase 数据库读取凭据',
        description: '仅用于受限的 staging 数据库读取；密码仅在提交时从输入框读取。',
        status: '状态',
        refresh: '刷新状态',
        projectRef: '项目引用',
        accountId: '数据库账户 ID',
        mode: '连接模式',
        direct: '直连',
        session: 'Supavisor 会话池',
        sessionHost: '会话池主机',
        password: '数据库密码',
        passwordPlaceholder: '仅在保存时读取',
        save: '保存凭据',
        replace: '替换凭据',
        clear: '清除凭据',
        configured: '已配置',
        missing: '未配置',
        unavailable: '不可用',
        invalid: '无效',
        managementPatRequired: '需要 Management PAT',
        reconciliationRequired: '需要重启后核对',
        managementPatHint:
          '请先在 Supabase 设置中配置 Management PAT；不会自行生成或猜测 generation。',
        reconciliationHint:
          '上次变更的目录持久化未确认。已保留前后 generation；请重启后核对，期间不会重试旧 generation 或继续变更。',
        confirmed: '凭据变更已确认持久化。',
        actionFailed: '凭据操作失败。'
      }
    : {
        title: 'Supabase database-read credential',
        description:
          'Used only for bounded staging database reads; the password is read from the input only on submit.',
        status: 'Status',
        refresh: 'Refresh status',
        projectRef: 'Project ref',
        accountId: 'Database account ID',
        mode: 'Connection mode',
        direct: 'Direct',
        session: 'Supavisor session pooler',
        sessionHost: 'Session pooler host',
        password: 'Database password',
        passwordPlaceholder: 'Read only while saving',
        save: 'Save credential',
        replace: 'Replace credential',
        clear: 'Clear credential',
        configured: 'Configured',
        missing: 'Missing',
        unavailable: 'Unavailable',
        invalid: 'Invalid',
        managementPatRequired: 'Management PAT required',
        reconciliationRequired: 'Restart reconciliation required',
        managementPatHint:
          'Configure the Supabase Management PAT first; this control never invents or guesses a generation.',
        reconciliationHint:
          'The last mutation has unconfirmed directory durability. Both generations are retained; restart and reconcile before another mutation. The stale generation will not be retried.',
        confirmed: 'Credential mutation durability is confirmed.',
        actionFailed: 'Credential operation failed.'
      }
)

const busy = computed(() => state.value.pendingOperation !== null)
const mutationBlocked = computed(
  () =>
    busy.value ||
    state.value.status === 'management-pat-required' ||
    state.value.reconciliation !== null
)
const configured = computed(() => state.value.status === 'configured')
const clearable = computed(
  () => state.value.status === 'configured' || state.value.status === 'invalid'
)

function statusLabel(): string {
  if (state.value.status === 'management-pat-required') return copy.value.managementPatRequired
  if (state.value.status === 'reconciliation-required') return copy.value.reconciliationRequired
  return copy.value[state.value.status]
}

function statusTone(): 'success' | 'warning' | 'error' {
  if (state.value.status === 'configured') return 'success'
  if (state.value.status === 'missing' || state.value.status === 'management-pat-required') {
    return 'warning'
  }
  return 'error'
}

async function refresh(): Promise<void> {
  state.value = await controller.refreshStatus()
}

async function replace(event: Event): Promise<void> {
  if (mutationBlocked.value) return
  const form = event.currentTarget
  if (!(form instanceof HTMLFormElement)) return
  const input = form.elements.namedItem('supabase-database-read-password')
  if (!(input instanceof HTMLInputElement)) return
  let password = input.value
  input.value = ''
  try {
    state.value = await controller.replace(
      mode.value === 'direct'
        ? { projectRef: projectRef.value, accountId: accountId.value, mode: 'direct' }
        : {
            projectRef: projectRef.value,
            accountId: accountId.value,
            mode: 'supavisor-session',
            sessionPoolerHost: sessionPoolerHost.value
          },
      password
    )
  } finally {
    password = ''
  }
}

async function clear(): Promise<void> {
  if (mutationBlocked.value) return
  state.value = await controller.clear()
}

onMounted(() => void refresh())
</script>

<template>
  <section
    class="mt-2 rounded border border-border/70 bg-panel p-2 text-[9px] text-muted"
    data-test-id="supabase-database-read-credential-controls"
    :aria-busy="busy"
  >
    <div class="flex items-start justify-between gap-2">
      <div>
        <h5 class="text-[10px] font-semibold text-surface">{{ copy.title }}</h5>
        <p>{{ copy.description }}</p>
      </div>
      <AppBadge :tone="statusTone()">{{ statusLabel() }}</AppBadge>
    </div>

    <button
      type="button"
      class="mt-2 rounded border border-border px-2 py-1 text-[10px] disabled:opacity-50"
      :disabled="busy"
      @click="refresh"
    >
      {{ copy.refresh }}
    </button>

    <p v-if="state.status === 'management-pat-required'" class="mt-1.5 text-warning" role="status">
      {{ copy.managementPatHint }}
    </p>
    <p v-if="state.reconciliation" class="mt-1.5 text-warning" role="alert">
      {{ copy.reconciliationHint }}
    </p>
    <p
      v-else-if="state.receipt?.commitDurability === 'confirmed'"
      class="mt-1.5 text-success"
      role="status"
    >
      {{ copy.confirmed }}
    </p>

    <form class="mt-2 grid grid-cols-2 gap-1.5" @submit.prevent="replace">
      <label class="flex flex-col gap-0.5">
        <span>{{ copy.projectRef }}</span>
        <input
          v-model="projectRef"
          type="text"
          autocomplete="off"
          class="rounded border border-border bg-input px-2 py-1 text-surface"
          :disabled="mutationBlocked"
        />
      </label>
      <label class="flex flex-col gap-0.5">
        <span>{{ copy.accountId }}</span>
        <input
          v-model="accountId"
          type="text"
          autocomplete="username"
          class="rounded border border-border bg-input px-2 py-1 text-surface"
          :disabled="mutationBlocked"
        />
      </label>
      <label class="flex flex-col gap-0.5">
        <span>{{ copy.mode }}</span>
        <select
          v-model="mode"
          class="rounded border border-border bg-input px-2 py-1"
          :disabled="mutationBlocked"
        >
          <option value="direct">{{ copy.direct }}</option>
          <option value="supavisor-session">{{ copy.session }}</option>
        </select>
      </label>
      <label v-if="mode === 'supavisor-session'" class="flex flex-col gap-0.5">
        <span>{{ copy.sessionHost }}</span>
        <input
          v-model="sessionPoolerHost"
          type="text"
          autocomplete="off"
          class="rounded border border-border bg-input px-2 py-1 text-surface"
          :disabled="mutationBlocked"
        />
      </label>
      <label class="col-span-2 flex flex-col gap-0.5">
        <span>{{ copy.password }}</span>
        <input
          name="supabase-database-read-password"
          type="password"
          autocomplete="new-password"
          required
          class="rounded border border-border bg-input px-2 py-1 text-surface"
          :placeholder="copy.passwordPlaceholder"
          :disabled="mutationBlocked"
        />
      </label>
      <div class="col-span-2 flex gap-1">
        <button
          type="submit"
          class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
          :disabled="mutationBlocked"
        >
          {{ configured ? copy.replace : copy.save }}
        </button>
        <button
          v-if="clearable"
          type="button"
          class="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-50"
          :disabled="mutationBlocked"
          @click="clear"
        >
          {{ copy.clear }}
        </button>
      </div>
    </form>

    <p v-if="state.error" class="mt-1.5 text-error" role="alert">
      {{ state.error || copy.actionFailed }}
    </p>
  </section>
</template>
