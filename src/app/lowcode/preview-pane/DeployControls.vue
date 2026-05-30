<script setup lang="ts">
import { ref } from 'vue'

import { openExternalLink } from '@/app/shell/ui'

import { useDeploy } from './use-deploy'

// Phase 3 §5 (second slice): one-click deploy from the preview header. The
// token lives only in this component's memory (never persisted) and is handed
// to the deploy CLI via the spawned process env (see use-deploy.ts). Plain
// English strings match the (non-i18n) PreviewPane sibling.
const { status, deploy, reset } = useDeploy()

const open = ref(false)
const token = ref('')
const site = ref('')

function toggle(): void {
  open.value = !open.value
  if (!open.value) reset()
}

async function submit(): Promise<void> {
  await deploy(token.value, site.value.trim() || undefined)
}

function openDeployed(url: string): void {
  void openExternalLink(url)
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      data-test-id="lowcode-deploy-toggle"
      class="rounded px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-surface"
      title="Deploy to Netlify"
      @click="toggle"
    >
      Deploy
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-7 z-10 w-64 rounded border border-border bg-panel p-3 shadow-lg"
      data-test-id="lowcode-deploy-panel"
    >
      <label class="mb-1 block text-xs text-muted">Netlify token</label>
      <input
        v-model="token"
        type="password"
        data-test-id="lowcode-deploy-token"
        placeholder="Personal access token"
        class="mb-2 w-full rounded border border-border bg-surface px-2 py-1 text-xs"
        :disabled="status.kind === 'deploying'"
        @keydown.enter="submit"
      />
      <label class="mb-1 block text-xs text-muted">Site (optional)</label>
      <input
        v-model="site"
        type="text"
        data-test-id="lowcode-deploy-site"
        placeholder="existing site id / subdomain"
        class="mb-2 w-full rounded border border-border bg-surface px-2 py-1 text-xs"
        :disabled="status.kind === 'deploying'"
        @keydown.enter="submit"
      />

      <button
        type="button"
        data-test-id="lowcode-deploy-submit"
        class="w-full rounded bg-accent px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
        :disabled="status.kind === 'deploying'"
        @click="submit"
      >
        {{ status.kind === 'deploying' ? 'Deploying…' : 'Build & Deploy' }}
      </button>

      <p
        v-if="status.kind === 'done'"
        class="mt-2 text-xs text-muted"
        data-test-id="lowcode-deploy-done"
      >
        ✓ Deployed —
        <button type="button" class="text-accent underline" @click="openDeployed(status.url)">
          open site
        </button>
      </p>
      <p
        v-else-if="status.kind === 'error'"
        class="mt-2 break-words text-xs text-red-500"
        data-test-id="lowcode-deploy-error"
      >
        {{ status.message }}
      </p>
    </div>
  </div>
</template>
