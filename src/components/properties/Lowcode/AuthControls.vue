<script setup lang="ts">
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

const editor = useEditorStore()
const { panels } = useI18n()

// Phase 3 §2 #5 — auth helpers (`signIn(email, pwd)` / `signOut()`) live on
// the emit-side `useSupabaseAuth()` hook, NOT in `ActionDef.kind` (locked to
// 6 kinds; adding a 7th is §2.v2 scope). These quick-actions are therefore
// informational — they surface the runtime API name inside the editor so
// users know to call it from custom handler code. Visible only when the
// root carries supabaseConfig.
const hasSupabaseConfig = useSceneComputed(() => {
  return editor.graph.getNode(editor.graph.rootId)?.lowcodeSupabaseConfig != null
})

function explainSignIn(): void {
  toast.info(panels.value.lowcodeAuthSignInHint)
}
function explainSignOut(): void {
  toast.info(panels.value.lowcodeAuthSignOutHint)
}
</script>

<template>
  <div
    v-if="hasSupabaseConfig"
    data-test-id="lowcode-auth-controls"
    class="mb-1.5 flex items-center gap-1"
  >
    <span class="text-[10px] text-muted">{{ panels.lowcodeAuthLabel }}</span>
    <button
      type="button"
      data-test-id="lowcode-auth-sign-in"
      class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
      @click="explainSignIn"
    >
      {{ panels.lowcodeAuthSignIn }}
    </button>
    <button
      type="button"
      data-test-id="lowcode-auth-sign-out"
      class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
      @click="explainSignOut"
    >
      {{ panels.lowcodeAuthSignOut }}
    </button>
  </div>
</template>
