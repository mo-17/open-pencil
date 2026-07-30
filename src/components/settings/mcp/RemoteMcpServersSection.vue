<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle
} from 'reka-ui'
import { useI18n } from '@open-pencil/vue'

import {
  addRemoteMcpServer,
  clearRemoteMcpBearerToken,
  createRemoteMcpRuntime,
  MAX_REMOTE_MCP_SERVERS,
  remoteMcpCredentialRevision,
  remoteMcpCredentialStatus,
  remoteMcpSettings,
  removeRemoteMcpServer,
  setRemoteMcpBearerToken,
  updateRemoteMcpServer,
  type RemoteMcpCredentialStatus,
  type RemoteMcpServer,
  type RemoteMcpServerId
} from '@/app/ai/mcp'
import { removeRemoteMcpServerFromModelProfiles } from '@/app/ai/models'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'

const { dialogs } = useI18n()
const editingId = ref<RemoteMcpServerId | null>(null)
const formOpen = ref(false)
const name = ref('')
const url = ref('')
const authType = ref<'none' | 'bearer'>('none')
const token = ref('')
const busy = ref(false)
const formError = ref<string | null>(null)
const pendingDeleteId = ref<RemoteMcpServerId | null>(null)
const statuses = ref<Record<string, RemoteMcpCredentialStatus>>({})
const testResults = ref<
  Record<string, { state: 'testing' | 'success' | 'error'; message?: string }>
>({})

const servers = computed(() => remoteMcpSettings.value.servers)
const editingServer = computed(
  () => servers.value.find((server) => server.id === editingId.value) ?? null
)
const authOptions = computed(() => [
  { value: 'none', label: dialogs.value.remoteMcpAuthNone },
  { value: 'bearer', label: dialogs.value.remoteMcpAuthBearer }
])
const credentialSaved = computed(
  () => Boolean(editingId.value) && statuses.value[editingId.value ?? ''] === 'configured'
)
const canSave = computed(
  () => Boolean(name.value.trim()) && Boolean(url.value.trim()) && !busy.value
)

function origin(server: RemoteMcpServer): string {
  return new URL(server.transport.url).origin
}

function closeForm(): void {
  formOpen.value = false
  editingId.value = null
  name.value = ''
  url.value = ''
  authType.value = 'none'
  token.value = ''
  formError.value = null
}

function addServer(): void {
  closeForm()
  formOpen.value = true
}

function editServer(server: RemoteMcpServer): void {
  editingId.value = server.id
  name.value = server.name
  url.value = server.transport.url
  authType.value = server.auth.type
  token.value = ''
  formError.value = null
  formOpen.value = true
}

async function refreshStatuses(): Promise<void> {
  const entries = await Promise.all(
    servers.value.map(async (server) => {
      try {
        return [server.id, await remoteMcpCredentialStatus(server.id)] as const
      } catch {
        return [server.id, 'unavailable' as const] as const
      }
    })
  )
  statuses.value = Object.fromEntries(entries)
}

function statusLabel(server: RemoteMcpServer): string {
  const status = statuses.value[server.id]
  if (status === 'not-required') return dialogs.value.remoteMcpAuthNone
  if (status === 'configured') return dialogs.value.connected
  if (status === 'locked' || status === 'unavailable') return dialogs.value.unavailable
  return dialogs.value.modelNeedsCredential
}

async function saveServer(): Promise<void> {
  if (!canSave.value) return
  busy.value = true
  formError.value = null
  try {
    const currentId = editingId.value
    const server = currentId
      ? await updateRemoteMcpServer(currentId, {
          name: name.value,
          url: url.value,
          authType: authType.value
        })
      : addRemoteMcpServer({ name: name.value, url: url.value, authType: authType.value })
    // If credential persistence fails after creating the non-secret config,
    // retries must update this server instead of adding duplicates.
    editingId.value = server.id
    if (server.auth.type === 'bearer' && token.value.trim()) {
      await setRemoteMcpBearerToken(server.id, token.value)
    }
    closeForm()
    await refreshStatuses()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function clearToken(): Promise<void> {
  const server = editingServer.value
  if (!server || server.auth.type !== 'bearer') return
  busy.value = true
  formError.value = null
  try {
    await clearRemoteMcpBearerToken(server.id)
    token.value = ''
    await refreshStatuses()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function testServer(server: RemoteMcpServer): Promise<void> {
  testResults.value = {
    ...testResults.value,
    [server.id]: { state: 'testing' }
  }
  let runtime: Awaited<ReturnType<typeof createRemoteMcpRuntime>> | null = null
  try {
    runtime = await createRemoteMcpRuntime([server.id])
    testResults.value = {
      ...testResults.value,
      [server.id]: { state: 'success', message: dialogs.value.connectionTestSuccess }
    }
  } catch (error) {
    testResults.value = {
      ...testResults.value,
      [server.id]: {
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  } finally {
    await runtime?.dispose().catch(() => undefined)
  }
}

async function confirmDelete(): Promise<void> {
  const id = pendingDeleteId.value
  if (!id) return
  busy.value = true
  formError.value = null
  try {
    if (await removeRemoteMcpServer(id)) {
      removeRemoteMcpServerFromModelProfiles(id)
      if (editingId.value === id) closeForm()
    }
    pendingDeleteId.value = null
    await refreshStatuses()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

watch(
  () => [
    remoteMcpCredentialRevision.value,
    ...servers.value.map((server) => `${server.id}:${server.auth.type}`)
  ],
  () => void refreshStatuses(),
  { immediate: true }
)
</script>

<template>
  <section class="mt-5 border-t border-border pt-4" data-test-id="settings-remote-mcp">
    <div class="mb-2 flex items-start justify-between gap-3">
      <div>
        <h3 class="text-xs font-semibold text-surface">{{ dialogs.remoteMcpServers }}</h3>
        <p class="text-[10px] text-muted">{{ dialogs.remoteMcpServersDescription }}</p>
      </div>
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
        :disabled="servers.length >= MAX_REMOTE_MCP_SERVERS || busy"
        data-test-id="settings-add-remote-mcp"
        @click="addServer"
      >
        <icon-lucide-plus class="size-3" />
        {{ dialogs.remoteMcpAdd }}
      </button>
    </div>

    <div
      class="mb-3 rounded border border-warning/30 bg-warning/5 px-2.5 py-2 text-[10px] text-muted"
    >
      <p>{{ dialogs.remoteMcpApprovalHint }}</p>
      <p class="mt-1">{{ dialogs.remoteMcpCorsHint }}</p>
    </div>

    <div v-if="servers.length" class="flex flex-col gap-1.5">
      <div
        v-for="server in servers"
        :key="server.id"
        class="rounded border border-border bg-panel-field px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-[11px] font-medium text-surface">{{ server.name }}</p>
            <p class="truncate text-[9px] text-muted">{{ origin(server) }}</p>
          </div>
          <span class="text-[9px] text-muted">{{ statusLabel(server) }}</span>
          <button
            type="button"
            class="rounded px-1.5 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface"
            :disabled="testResults[server.id]?.state === 'testing'"
            @click="testServer(server)"
          >
            {{
              testResults[server.id]?.state === 'testing'
                ? dialogs.testingConnection
                : dialogs.testConnection
            }}
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="editServer(server)"
          >
            {{ dialogs.remoteMcpEdit }}
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-1 text-[10px] text-danger hover:bg-danger/10"
            @click="pendingDeleteId = server.id"
          >
            {{ dialogs.remoteMcpDelete }}
          </button>
        </div>
        <p
          v-if="testResults[server.id]?.message"
          class="mt-1 text-[9px]"
          :class="testResults[server.id]?.state === 'error' ? 'text-danger' : 'text-success'"
          role="status"
        >
          {{ testResults[server.id]?.message }}
        </p>
      </div>
    </div>
    <p
      v-else
      class="rounded border border-dashed border-border p-3 text-center text-[10px] text-muted"
    >
      {{ dialogs.remoteMcpEmpty }}
    </p>

    <form
      v-if="formOpen"
      class="mt-3 flex flex-col gap-2 rounded border border-border p-3"
      data-test-id="settings-remote-mcp-editor"
      @submit.prevent="saveServer"
    >
      <AppInput
        v-model="name"
        :aria-label="dialogs.remoteMcpName"
        :placeholder="dialogs.remoteMcpName"
        size="sm"
      />
      <AppInput
        v-model="url"
        :aria-label="dialogs.remoteMcpUrl"
        placeholder="https://example.com/mcp"
        size="sm"
      />
      <AppSelect v-model="authType" :label="dialogs.remoteMcpAuth" :options="authOptions" />
      <div v-if="authType === 'bearer'" class="flex gap-2">
        <AppInput
          v-model="token"
          type="password"
          :aria-label="dialogs.remoteMcpToken"
          :placeholder="credentialSaved ? dialogs.keySavedReplace : dialogs.remoteMcpToken"
          size="sm"
          class="flex-1"
        />
        <button
          v-if="credentialSaved"
          type="button"
          class="rounded px-2 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="clearToken"
        >
          {{ dialogs.clear }}
        </button>
      </div>
      <p v-if="formError" class="text-[10px] text-danger" role="alert">{{ formError }}</p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover"
          @click="closeForm"
        >
          {{ dialogs.cancel }}
        </button>
        <button
          type="submit"
          class="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
          :disabled="!canSave"
        >
          {{ dialogs.save }}
        </button>
      </div>
    </form>

    <p v-if="formError && !formOpen" class="mt-2 text-[10px] text-danger" role="alert">
      {{ formError }}
    </p>
  </section>

  <AppAlertDialogRoot
    :open="pendingDeleteId !== null"
    data-test-id="delete-remote-mcp-dialog"
    @update:open="pendingDeleteId = $event ? pendingDeleteId : null"
  >
    <div class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.remoteMcpDelete }}
      </AlertDialogTitle>
    </div>
    <AppDialogBody>
      <AlertDialogDescription class="text-xs text-muted">
        {{ dialogs.remoteMcpDeleteDescription }}
      </AlertDialogDescription>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover">
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <button class="rounded bg-danger px-3 py-1.5 text-xs text-white" @click="confirmDelete">
          {{ dialogs.remoteMcpDelete }}
        </button>
      </AlertDialogAction>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
