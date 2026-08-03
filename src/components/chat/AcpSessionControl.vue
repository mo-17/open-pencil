<script setup lang="ts">
import { refAutoReset, useClipboard } from '@vueuse/core'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref } from 'vue'

import type {
  ACPSessionHistoryItem,
  ACPSessionHistoryState,
  ACPSessionStatus
} from '@/app/ai/chat/transports'
import Tip from '@/components/ui/Tip.vue'
import { useButtonUI } from '@/components/ui/button'
import { usePopoverUI } from '@/components/ui/popover'
import { useI18n } from '@open-pencil/vue'

const {
  status,
  history,
  documentName,
  disabled = false
} = defineProps<{
  status: ACPSessionStatus
  history: ACPSessionHistoryState
  documentName?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  refresh: []
  resume: [sessionId: string]
}>()

const { dialogs } = useI18n()
const { copy } = useClipboard()
const copiedSessionId = refAutoReset<string | null>(null, 1_500)
const popoverOpen = ref(false)
const pendingResumeSessionId = ref<string | null>(null)
const cls = usePopoverUI({
  content:
    'isolate z-[100] flex max-h-[min(32rem,calc(100vh-2rem))] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden border border-border p-0'
})
const resumeButton = useButtonUI({
  tone: 'ghost',
  size: 'sm',
  ui: {
    base: 'shrink-0 border border-border px-2 text-[10px] font-medium text-surface hover:border-accent/30 disabled:pointer-events-none disabled:opacity-40'
  }
})
const retryButton = useButtonUI({
  tone: 'ghost',
  size: 'sm',
  ui: {
    base: 'border border-border px-2 text-[10px] font-medium text-surface hover:border-accent/30 disabled:pointer-events-none disabled:opacity-40'
  }
})

const manualRestoreFailed = computed(
  () => status.source === 'manual' && Boolean(status.error) && status.state !== 'failed'
)
const persistenceFailed = computed(() => Boolean(status.persistenceError))
const statusLabel = computed(() => {
  if (manualRestoreFailed.value) return dialogs.value.aiSessionStateRestoreFailedUnchanged
  let label: string
  switch (status.state) {
    case 'idle':
      label = dialogs.value.aiSessionStateIdle
      break
    case 'connecting':
      label = dialogs.value.aiSessionStateConnecting
      break
    case 'resumed':
      label = dialogs.value.aiSessionStateResumed
      break
    case 'new':
      label = dialogs.value.aiSessionStateNew
      break
    case 'fallback':
      label = dialogs.value.aiSessionStateFallback
      break
    case 'failed':
      label = dialogs.value.aiSessionStateFailed
      break
  }
  return persistenceFailed.value
    ? `${label} · ${dialogs.value.aiSessionStatePersistenceFailed}`
    : label
})

const statusClass = computed(() => {
  if (manualRestoreFailed.value || persistenceFailed.value) return 'text-amber-400'
  switch (status.state) {
    case 'resumed':
      return 'text-green-400'
    case 'fallback':
      return 'text-amber-400'
    case 'failed':
      return 'text-red-400'
    default:
      return 'text-muted'
  }
})

const statusBusy = computed(() => status.state === 'connecting')
const canResumeHistory = computed(() => status.capabilities.resume)
const historyViewState = computed(() => {
  if (!status.capabilities.list || history.state === 'unsupported') return 'unsupported'
  return history.state
})
const triggerLabel = computed(() => {
  const id = shortSessionId(status.sessionId)
  return id ? `${statusLabel.value} · ${id}` : statusLabel.value
})
const triggerAriaLabel = computed(() =>
  dialogs.value.aiSessionOpenDetails({ status: triggerLabel.value })
)
const statusErrorLabel = computed(() => {
  if (!status.error) return null
  return manualRestoreFailed.value
    ? dialogs.value.aiSessionManualRestoreFailed({ error: status.error })
    : status.error
})
const persistenceErrorLabel = computed(() =>
  status.persistenceError
    ? dialogs.value.aiSessionPersistenceFailed({ error: status.persistenceError })
    : null
)
const documentLabel = computed(() => documentName?.trim() || dialogs.value.aiSessionUnknownDocument)
const exactSessions = computed(() => history.sessions.filter((item) => item.match === 'exact'))
const sameDocumentSessions = computed(() =>
  history.sessions.filter((item) => item.match === 'same-document')
)
const unverifiedSessions = computed(() =>
  history.sessions.filter((item) => item.match === 'unverified')
)
const historyGroups = computed(() =>
  [
    {
      key: 'exact' as const,
      title: dialogs.value.aiSessionRecommended,
      description: dialogs.value.aiSessionExactScope({ document: documentLabel.value }),
      sessions: exactSessions.value
    },
    {
      key: 'same-document' as const,
      title: dialogs.value.aiSessionSameDocumentHistory,
      description: dialogs.value.aiSessionSameDocumentHint({ document: documentLabel.value }),
      sessions: sameDocumentSessions.value
    },
    {
      key: 'unverified' as const,
      title: dialogs.value.aiSessionOtherHistory,
      description: dialogs.value.aiSessionUnverifiedHint({ document: documentLabel.value }),
      sessions: unverifiedSessions.value
    }
  ].filter((group) => group.sessions.length > 0)
)

function shortSessionId(sessionId: string | null): string {
  if (!sessionId) return ''
  if (sessionId.length <= 15) return sessionId
  return `${sessionId.slice(0, 6)}…${sessionId.slice(-6)}`
}

function formatUpdatedAt(updatedAt: string | null): string | null {
  if (!updatedAt) return null
  const timestamp = new Date(updatedAt)
  if (!Number.isFinite(timestamp.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp)
}

function sessionTitle(item: ACPSessionHistoryItem): string {
  return item.title?.trim() || dialogs.value.aiSessionUntitled
}

function sessionLabel(item: ACPSessionHistoryItem): string {
  return dialogs.value.aiSessionHistoryItem({ id: shortSessionId(item.sessionId) })
}

function matchLabel(item: ACPSessionHistoryItem): string {
  if (item.match === 'exact') return dialogs.value.aiSessionMatchExact
  if (item.match === 'same-document') return dialogs.value.aiSessionMatchSameDocument
  return dialogs.value.aiSessionMatchUnverified
}

function isCurrent(item: ACPSessionHistoryItem): boolean {
  return status.sessionId === item.sessionId
}

function setPopoverOpen(value: boolean): void {
  popoverOpen.value = value
  if (!value) pendingResumeSessionId.value = null
  if (value) emit('refresh')
}

function requestRefresh(): void {
  if (disabled || history.state === 'loading') return
  pendingResumeSessionId.value = null
  emit('refresh')
}

function requestResume(item: ACPSessionHistoryItem, confirmed = false): void {
  if (disabled || statusBusy.value || isCurrent(item) || !canResumeHistory.value) return
  if (item.match !== 'exact' && !confirmed) {
    pendingResumeSessionId.value = item.sessionId
    return
  }
  pendingResumeSessionId.value = null
  popoverOpen.value = false
  emit('resume', item.sessionId)
}

function cancelPendingResume(): void {
  pendingResumeSessionId.value = null
}

async function copySessionId(sessionId: string): Promise<void> {
  await copy(sessionId)
  copiedSessionId.value = sessionId
}
</script>

<template>
  <PopoverRoot v-model:open="popoverOpen" @update:open="setPopoverOpen">
    <PopoverTrigger
      type="button"
      data-test-id="acp-session-control-trigger"
      :disabled="disabled"
      :aria-label="triggerAriaLabel"
      class="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-input/40 px-2 text-[10px] transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
    >
      <icon-lucide-loader-circle
        v-if="status.state === 'connecting'"
        aria-hidden="true"
        class="size-3 shrink-0 animate-spin text-muted"
      />
      <icon-lucide-triangle-alert
        v-else-if="manualRestoreFailed || persistenceFailed || status.state === 'fallback'"
        aria-hidden="true"
        class="size-3 shrink-0 text-amber-400"
      />
      <icon-lucide-circle-check
        v-else-if="status.state === 'resumed'"
        aria-hidden="true"
        class="size-3 shrink-0 text-green-400"
      />
      <icon-lucide-circle-alert
        v-else-if="status.state === 'failed'"
        aria-hidden="true"
        class="size-3 shrink-0 text-red-400"
      />
      <icon-lucide-sparkles
        v-else-if="status.state === 'new'"
        aria-hidden="true"
        class="size-3 shrink-0 text-muted"
      />
      <icon-lucide-circle-dashed v-else aria-hidden="true" class="size-3 shrink-0 text-muted" />

      <span aria-live="polite" aria-atomic="true" class="min-w-0 truncate" :class="statusClass">
        {{ statusLabel }}
      </span>
      <Tip v-if="status.sessionId" :label="status.sessionId">
        <span class="max-w-24 min-w-0 truncate font-mono text-[9px] text-muted">
          {{ shortSessionId(status.sessionId) }}
        </span>
      </Tip>
      <icon-lucide-chevron-up aria-hidden="true" class="size-3 shrink-0 text-muted" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="acp-session-control-panel"
        side="top"
        :side-offset="8"
        align="start"
        :collision-padding="16"
        :avoid-collisions="true"
        :aria-label="dialogs.aiSessionControl"
        :class="cls.content"
      >
        <div class="shrink-0 border-b border-border px-3 py-2.5">
          <div class="flex min-w-0 items-start gap-2">
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-md bg-input text-muted"
            >
              <icon-lucide-bot aria-hidden="true" class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-[11px] font-semibold text-surface">
                {{ dialogs.aiSessionControl }}
              </h3>
              <p class="mt-0.5 flex min-w-0 items-center gap-1 text-[10px]" :class="statusClass">
                <icon-lucide-loader-circle
                  v-if="status.state === 'connecting'"
                  aria-hidden="true"
                  class="size-3 shrink-0 animate-spin"
                />
                <span class="truncate">{{ statusLabel }}</span>
              </p>
              <p
                v-if="status.sessionId"
                data-test-id="acp-session-current-document"
                class="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[9px] font-medium text-green-300"
              >
                <icon-lucide-file-check-2 aria-hidden="true" class="size-3 shrink-0" />
                <span class="truncate">
                  {{ dialogs.aiSessionCurrentDocument({ document: documentLabel }) }}
                </span>
              </p>
            </div>
          </div>

          <p
            v-if="statusErrorLabel"
            role="alert"
            class="mt-2 line-clamp-3 break-words rounded bg-red-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-red-300"
          >
            {{ statusErrorLabel }}
          </p>

          <p
            v-if="persistenceErrorLabel"
            role="alert"
            class="mt-2 line-clamp-3 break-words rounded bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-300"
          >
            {{ persistenceErrorLabel }}
          </p>

          <dl
            v-if="status.sessionId || status.requestedSessionId"
            class="mt-2 grid gap-1 text-[10px]"
          >
            <div v-if="status.sessionId" class="flex min-w-0 items-center gap-2">
              <dt class="shrink-0 text-muted">{{ dialogs.aiSessionId }}</dt>
              <dd class="min-w-0 flex-1 truncate font-mono text-[9px] text-surface">
                <Tip :label="status.sessionId">
                  <span>{{ shortSessionId(status.sessionId) }}</span>
                </Tip>
              </dd>
              <Tip :label="status.sessionId">
                <button
                  type="button"
                  data-test-id="acp-session-copy-current"
                  :aria-label="dialogs.aiSessionCopyId"
                  class="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                  @click="copySessionId(status.sessionId)"
                >
                  <icon-lucide-check
                    v-if="copiedSessionId === status.sessionId"
                    aria-hidden="true"
                    class="size-3 text-green-400"
                  />
                  <icon-lucide-copy v-else aria-hidden="true" class="size-3" />
                </button>
              </Tip>
            </div>
            <div
              v-if="status.requestedSessionId && status.requestedSessionId !== status.sessionId"
              class="flex min-w-0 items-center gap-2"
            >
              <dt class="shrink-0 text-muted">{{ dialogs.aiSessionRequestedId }}</dt>
              <dd class="min-w-0 flex-1 truncate font-mono text-[9px] text-surface">
                <Tip :label="status.requestedSessionId">
                  <span>{{ shortSessionId(status.requestedSessionId) }}</span>
                </Tip>
              </dd>
            </div>
          </dl>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          <div class="mb-2">
            <h4 class="text-[10px] font-semibold text-surface">{{ dialogs.aiSessionHistory }}</h4>
            <p class="mt-0.5 text-[10px] leading-relaxed text-muted">
              {{ dialogs.aiSessionContextOnly }}
            </p>
          </div>

          <div
            v-if="historyViewState === 'idle' || historyViewState === 'loading'"
            role="status"
            class="flex items-center gap-2 rounded border border-border bg-input/30 px-2 py-3 text-[10px] text-muted"
          >
            <icon-lucide-loader-circle aria-hidden="true" class="size-3.5 animate-spin" />
            {{ dialogs.aiSessionHistoryLoading }}
          </div>

          <div
            v-else-if="historyViewState === 'unsupported'"
            class="rounded border border-border bg-input/30 px-2 py-3 text-[10px] leading-relaxed text-muted"
          >
            <div class="flex items-start gap-2">
              <icon-lucide-info aria-hidden="true" class="mt-0.5 size-3.5 shrink-0" />
              <p>{{ dialogs.aiSessionHistoryUnsupported }}</p>
            </div>
          </div>

          <div
            v-else-if="historyViewState === 'error'"
            role="alert"
            class="rounded border border-red-500/20 bg-red-500/10 px-2 py-2 text-[10px] leading-relaxed text-red-300"
          >
            <div class="flex items-start gap-2">
              <icon-lucide-circle-alert aria-hidden="true" class="mt-0.5 size-3.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <p>{{ dialogs.aiSessionHistoryLoadFailed }}</p>
                <p v-if="history.error" class="mt-0.5 line-clamp-2 break-words opacity-80">
                  {{ history.error }}
                </p>
              </div>
            </div>
            <button
              type="button"
              data-test-id="acp-session-history-retry"
              :class="retryButton.base"
              class="mt-2"
              :disabled="disabled"
              @click="requestRefresh"
            >
              <icon-lucide-refresh-cw aria-hidden="true" class="mr-1 size-3" />
              {{ dialogs.aiSessionRetry }}
            </button>
          </div>

          <p
            v-else-if="history.sessions.length === 0"
            class="rounded border border-border bg-input/30 px-2 py-3 text-[10px] leading-relaxed text-muted"
          >
            {{ dialogs.aiSessionHistoryEmpty }}
          </p>

          <div v-else class="grid gap-3">
            <p
              v-if="exactSessions.length === 0"
              data-test-id="acp-session-no-exact-match"
              class="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-2 text-[10px] leading-relaxed text-amber-200"
            >
              {{ dialogs.aiSessionNoExactMatch({ document: documentLabel }) }}
            </p>

            <section v-for="group in historyGroups" :key="group.key" class="grid gap-1.5">
              <div>
                <h5 class="text-[10px] font-semibold text-surface">{{ group.title }}</h5>
                <p class="mt-0.5 text-[9px] leading-relaxed text-muted">
                  {{ group.description }}
                </p>
              </div>

              <ul class="grid gap-1.5" :aria-label="group.title">
                <li
                  v-for="item in group.sessions"
                  :key="item.sessionId"
                  class="rounded border bg-input/20 p-2"
                  :class="[
                    item.match === 'exact'
                      ? 'border-green-500/30 bg-green-500/5'
                      : item.match === 'same-document'
                        ? 'border-amber-500/20 bg-amber-500/5'
                        : 'border-border',
                    isCurrent(item) ? 'ring-1 ring-accent/30' : ''
                  ]"
                >
                  <div class="flex min-w-0 items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <Tip :label="item.sessionId">
                          <p class="min-w-0 truncate text-[10px] font-medium text-surface">
                            {{ sessionLabel(item) }}
                          </p>
                        </Tip>
                        <span
                          data-test-id="acp-session-match-badge"
                          :data-match="item.match"
                          class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                          :class="
                            item.match === 'exact'
                              ? 'bg-green-500/10 text-green-300'
                              : item.match === 'same-document'
                                ? 'bg-amber-500/10 text-amber-300'
                                : 'bg-input text-muted'
                          "
                        >
                          {{ matchLabel(item) }}
                        </span>
                        <span
                          v-if="isCurrent(item)"
                          class="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent"
                        >
                          {{ dialogs.aiSessionCurrent }}
                        </span>
                      </div>
                      <Tip v-if="item.title" :label="sessionTitle(item)">
                        <p class="mt-0.5 truncate text-[9px] text-muted/80">
                          {{ sessionTitle(item) }}
                        </p>
                      </Tip>
                      <div class="mt-1 flex min-w-0 items-center gap-1.5 text-[9px] text-muted">
                        <span v-if="formatUpdatedAt(item.updatedAt)" class="shrink-0">
                          {{ formatUpdatedAt(item.updatedAt) }}
                        </span>
                        <Tip :label="item.sessionId">
                          <button
                            type="button"
                            data-test-id="acp-session-copy-history"
                            :aria-label="dialogs.aiSessionCopyId"
                            class="ml-auto flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                            @click="copySessionId(item.sessionId)"
                          >
                            <icon-lucide-check
                              v-if="copiedSessionId === item.sessionId"
                              aria-hidden="true"
                              class="size-3 text-green-400"
                            />
                            <icon-lucide-copy v-else aria-hidden="true" class="size-3" />
                          </button>
                        </Tip>
                      </div>
                    </div>

                    <button
                      v-if="!isCurrent(item)"
                      type="button"
                      data-test-id="acp-session-resume"
                      :class="resumeButton.base"
                      :disabled="disabled || statusBusy || !canResumeHistory"
                      :aria-label="dialogs.aiSessionResumeNamed({ title: sessionLabel(item) })"
                      @click="requestResume(item)"
                    >
                      <icon-lucide-rotate-ccw aria-hidden="true" class="mr-1 size-3" />
                      {{ dialogs.aiSessionResume }}
                    </button>
                  </div>

                  <div
                    v-if="pendingResumeSessionId === item.sessionId"
                    role="alert"
                    data-test-id="acp-session-resume-confirmation"
                    class="mt-2 rounded border border-amber-500/20 bg-amber-500/10 p-2 text-[9px] leading-relaxed text-amber-200"
                  >
                    <p>
                      {{
                        item.match === 'same-document'
                          ? dialogs.aiSessionDifferentConfigWarning
                          : dialogs.aiSessionUnverifiedWarning({ document: documentLabel })
                      }}
                    </p>
                    <div class="mt-2 flex justify-end gap-1.5">
                      <button type="button" :class="retryButton.base" @click="cancelPendingResume">
                        {{ dialogs.cancel }}
                      </button>
                      <button
                        type="button"
                        data-test-id="acp-session-resume-confirm"
                        :class="resumeButton.base"
                        @click="requestResume(item, true)"
                      >
                        {{ dialogs.aiSessionResumeAnyway }}
                      </button>
                    </div>
                  </div>
                </li>
              </ul>
            </section>
          </div>

          <p
            v-if="historyViewState === 'ready' && history.sessions.length > 0 && !canResumeHistory"
            class="mt-2 text-[10px] leading-relaxed text-muted"
          >
            {{ dialogs.aiSessionResumeUnsupported }}
          </p>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
