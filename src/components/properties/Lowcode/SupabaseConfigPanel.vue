<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  type RlsTableRequirement,
  buildRlsPolicySql,
  collectRlsRequirements,
  detectServiceRole
} from '@open-pencil/core/lowcode-validation'
import type { ActionDef, SupabaseConfig } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()

// Phase 3 §2 #2 — connection config lives on the root node only, persisted
// via `lowcode/supabaseConfig` pluginData. This panel is shown in the
// no-selection branch (root-level properties), before DocumentStatePanel.
const config = useSceneComputed<SupabaseConfig | undefined>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeSupabaseConfig
})

const urlInput = computed(() => config.value?.url ?? '')
const anonKeyInput = computed(() => config.value?.anonKey ?? '')
const schemaInput = computed(() => config.value?.schema ?? '')

// Local mirror of the anon key DOM input. `buildPatch` refuses to persist
// a service_role JWT, so deriving `serviceRoleDetected` from the committed
// config (`anonKeyInput`) would mean the bad value never reaches reactivity
// — banner, red border, and disabled Test button would all stay silent
// even though §2.7 risk row 1 demands all four indicators. Tracking what
// the user has typed locally lets the banner fire live on @input while
// the committed config stays clean. The watch resyncs only when the
// committed anon key actually changes (undo/redo, external load), so a
// rejected service_role attempt stays visible until the user clears it.
const anonKeyTyped = ref<string>(config.value?.anonKey ?? '')
watch(
  () => config.value?.anonKey,
  (val) => {
    anonKeyTyped.value = val ?? ''
  }
)

const testStatus = ref<'idle' | 'pending' | 'ok' | 'error'>('idle')
const testError = ref<string>('')

// Phase 3 §3.v8 — RLS policy advisor. The silent-0-row footgun (§3.8
// surprise #5) cannot be probed through the anon REST API, so instead of a
// live check we derive the anon policies this document *needs* from every
// Supabase action it uses. Walk the whole graph (not just the selection)
// since actions live on any node's `events`; `collectRlsRequirements` keeps
// the aggregation/dedup pure and unit-tested in core.
const rlsRequirements = useSceneComputed<RlsTableRequirement[]>(() => {
  const actions: ActionDef[] = []
  for (const node of editor.graph.getAllNodes()) {
    if (!node.events) continue
    for (const list of Object.values(node.events)) {
      if (list) actions.push(...list)
    }
  }
  return collectRlsRequirements(actions)
})

// Tracks which table's SQL was just copied so the button label can flip to
// "Copied" briefly. Keyed by table name (one button per requirement).
const copiedTable = ref<string>('')
async function copyRlsSql(req: RlsTableRequirement): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildRlsPolicySql(req))
    copiedTable.value = req.table
    setTimeout(() => {
      if (copiedTable.value === req.table) copiedTable.value = ''
    }, 1500)
  } catch (err) {
    // Clipboard unavailable (rare in WKWebView) — the SQL is still visible
    // in the <pre> for manual selection, so a copy failure is non-fatal.
    console.warn('RLS SQL copy failed', err)
  }
}

// Toast guard: §2.2 #j — the RLS reminder fires once per editor session the
// first time the user opens this panel with both url + anonKey filled in.
// Module-scoped so navigating between root and other selections doesn't
// re-fire it; survives panel remounts within the same browser tab.
let rlsToastShown = false
function maybeFireRlsToast(): void {
  if (rlsToastShown) return
  if (!urlInput.value || !anonKeyInput.value) return
  rlsToastShown = true
  toast.info(panels.value.lowcodeSupabaseRlsToast)
}

// Phase 3 §2.7 risk row 1 — service_role JWTs carry full DB privileges and
// MUST never land in .fig / pluginData / git. The detector lives in
// `@open-pencil/core/lowcode-validation` so the editor UI here and the
// lowcode AI tool (Phase 3 §3) share one source — a divergence between
// the two would be silent on this side (banner still shows) and dangerous
// on the tool side (key would persist).
const serviceRoleDetected = computed(() => detectServiceRole(anonKeyTyped.value))

function commit(next: SupabaseConfig | undefined): void {
  editor.updateNodeWithUndo(
    editor.graph.rootId,
    { lowcodeSupabaseConfig: next },
    'Update Supabase config'
  )
}

function buildPatch(url: string, anonKey: string, schema: string): SupabaseConfig | undefined {
  const u = url.trim()
  const k = anonKey.trim()
  const s = schema.trim()
  // §2.2 #j hard-reject: a service_role key NEVER persists. Mid-typing the
  // key is fine (banner shows), but the moment a commit would happen we
  // refuse to persist the bad value.
  if (k && detectServiceRole(k)) return config.value
  if (!u && !k) return undefined
  return s ? { url: u, anonKey: k, schema: s } : { url: u, anonKey: k }
}

function updateUrl(value: string): void {
  commit(buildPatch(value, anonKeyInput.value, schemaInput.value))
  testStatus.value = 'idle'
  testError.value = ''
}
function updateAnonKey(value: string): void {
  commit(buildPatch(urlInput.value, value, schemaInput.value))
  testStatus.value = 'idle'
  testError.value = ''
  maybeFireRlsToast()
}
function updateSchema(value: string): void {
  commit(buildPatch(urlInput.value, anonKeyInput.value, value))
  testStatus.value = 'idle'
  testError.value = ''
}

async function testConnection(): Promise<void> {
  if (!urlInput.value || !anonKeyInput.value) {
    testStatus.value = 'error'
    testError.value = panels.value.lowcodeSupabaseTestMissing
    return
  }
  if (serviceRoleDetected.value) return
  testStatus.value = 'pending'
  testError.value = ''
  try {
    // Hit GoTrue's `/auth/v1/settings` rather than PostgREST root: on
    // current Supabase versions `/rest/v1/` requires the service_role key
    // (returns 401 with hint "Only the 'service_role' API key can be used
    // for this endpoint"). `/auth/v1/settings` is the only public endpoint
    // that takes the anon `apikey` header AND returns 200, so it validates
    // URL + key in a single round-trip without ever asking for elevated
    // credentials. A successful settings fetch implies the project is
    // reachable and the anon key is accepted by the same gateway PostgREST
    // sits behind, so subsequent table queries will authenticate.
    const url = urlInput.value.replace(/\/$/, '') + '/auth/v1/settings'
    const res = await fetch(url, {
      headers: {
        apikey: anonKeyInput.value
      }
    })
    if (!res.ok) {
      // Surface Supabase's response body so the red banner shows the real
      // reason ("Invalid API key" / "JWT expired" / "TenantNotFound" / …)
      // instead of a bare HTTP code. Trim to 200 chars to keep the banner
      // readable; swallow body-read failures so we still report the status.
      const body = await res.text().catch(() => '')
      testStatus.value = 'error'
      testError.value = `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`
      return
    }
    testStatus.value = 'ok'
  } catch (err) {
    testStatus.value = 'error'
    testError.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div data-test-id="lowcode-supabase-config-section" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">{{ panels.lowcodeSupabaseConfig }}</label>
      <span
        v-if="testStatus !== 'idle'"
        data-test-id="lowcode-supabase-status-dot"
        :class="[
          'size-2 rounded-full',
          testStatus === 'pending' && 'bg-muted',
          testStatus === 'ok' && 'bg-green-500',
          testStatus === 'error' && 'bg-red-500'
        ]"
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <input
        :value="urlInput"
        :aria-label="panels.lowcodeSupabaseUrl"
        data-test-id="lowcode-supabase-url"
        spellcheck="false"
        :placeholder="panels.lowcodeSupabaseUrlPlaceholder"
        class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
        @change="updateUrl(($event.target as HTMLInputElement).value)"
      />
      <input
        :value="anonKeyTyped"
        :aria-label="panels.lowcodeSupabaseAnonKey"
        :aria-invalid="serviceRoleDetected ? 'true' : undefined"
        data-test-id="lowcode-supabase-anon-key"
        spellcheck="false"
        :placeholder="panels.lowcodeSupabaseAnonKeyPlaceholder"
        :class="[
          'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
          serviceRoleDetected ? 'border-red-500' : 'border-border'
        ]"
        @input="anonKeyTyped = ($event.target as HTMLInputElement).value"
        @change="updateAnonKey(($event.target as HTMLInputElement).value)"
      />
      <input
        :value="schemaInput"
        :aria-label="panels.lowcodeSupabaseSchema"
        data-test-id="lowcode-supabase-schema"
        spellcheck="false"
        :placeholder="panels.lowcodeSupabaseSchemaPlaceholder"
        class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
        @change="updateSchema(($event.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        data-test-id="lowcode-supabase-test"
        :disabled="testStatus === 'pending' || serviceRoleDetected"
        class="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
        @click="testConnection"
      >
        {{ testStatus === 'pending' ? panels.lowcodeSupabaseTesting : panels.lowcodeSupabaseTest }}
      </button>
    </div>

    <p
      v-if="serviceRoleDetected"
      data-test-id="lowcode-supabase-service-role-error"
      class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
    >
      {{ panels.lowcodeSupabaseServiceRoleReject }}
    </p>
    <p
      v-else-if="testStatus === 'error'"
      data-test-id="lowcode-supabase-test-error"
      class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
    >
      {{ testError }}
    </p>
    <p
      v-else-if="testStatus === 'ok'"
      data-test-id="lowcode-supabase-test-ok"
      class="mt-1 text-[10px] text-green-500"
    >
      {{ panels.lowcodeSupabaseTestOk }}
    </p>

    <p
      data-test-id="lowcode-supabase-rls-note"
      class="mt-1.5 text-[10px] text-muted"
    >
      {{ panels.lowcodeSupabaseRlsNote }}
    </p>
    <p
      data-test-id="lowcode-supabase-current-user-note"
      class="mt-1 text-[10px] text-muted"
    >
      {{ panels.lowcodeSupabaseCurrentUserNote }}
    </p>

    <div
      v-if="config && rlsRequirements.length"
      data-test-id="lowcode-supabase-rls-advisor"
      class="mt-2 border-t border-border pt-2"
    >
      <label class="text-[11px] text-muted">{{ panels.lowcodeSupabaseRlsHeading }}</label>
      <div
        v-for="req in rlsRequirements"
        :key="req.table"
        data-test-id="lowcode-supabase-rls-table"
        class="mt-1.5 flex flex-col gap-1"
      >
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="font-mono text-xs text-surface">{{ req.table }}</span>
          <span
            v-for="cmd in req.commands"
            :key="cmd"
            class="rounded bg-hover px-1 text-[9px] uppercase text-muted"
          >{{ cmd }}</span>
        </div>
        <p
          v-if="req.needsWriteWarning"
          class="rounded border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-[10px] text-orange-500"
        >
          {{ panels.lowcodeSupabaseRlsWriteWarning }}
        </p>
        <pre
          data-test-id="lowcode-supabase-rls-sql"
          class="overflow-x-auto rounded border border-border bg-input px-2 py-1 font-mono text-[10px] text-surface"
        >{{ buildRlsPolicySql(req) }}</pre>
        <button
          type="button"
          data-test-id="lowcode-supabase-rls-copy"
          class="self-start rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="copyRlsSql(req)"
        >
          {{ copiedTable === req.table ? panels.lowcodeSupabaseRlsCopied : panels.lowcodeSupabaseRlsCopy }}
        </button>
      </div>
    </div>
  </div>
</template>
