<script setup lang="ts">
import type { LibrariesPanelController } from '@/app/lowcode/use-libraries-panel'

const { controller } = defineProps<{ controller: LibrariesPanelController }>()
const {
  busyOperation,
  handleRemoteURLInput,
  isMutationBusy,
  libraryError,
  libraryName,
  loadLibrary,
  loadManifest,
  loadRemoteURL,
  manifestError,
  manifestName,
  operationError,
  panels,
  remoteURL,
  remoteURLInvalid,
  remoteURLTouched,
  statusMessage
} = controller
</script>

<template>
  <form class="mb-2" novalidate @submit.prevent="loadRemoteURL">
    <label for="lowcode-library-manifest-url" class="mb-1 block text-[11px] text-muted">
      {{ panels.lowcodeLibrariesRemoteManifestUrl }}
    </label>
    <div class="flex gap-1.5">
      <input
        id="lowcode-library-manifest-url"
        v-model="remoteURL"
        data-test-id="lowcode-library-manifest-url"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-[11px] text-surface outline-none focus:border-primary"
        :placeholder="panels.lowcodeLibrariesRemoteManifestUrlPlaceholder"
        :aria-invalid="remoteURLInvalid || !!operationError"
        aria-describedby="lowcode-library-url-help lowcode-library-url-error"
        :disabled="isMutationBusy"
        @blur="remoteURLTouched = true"
        @input="handleRemoteURLInput"
      />
      <button
        type="submit"
        data-test-id="lowcode-library-load-remote"
        class="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="isMutationBusy || remoteURL.trim() === ''"
      >
        {{
          busyOperation === 'loading'
            ? panels.lowcodeLibrariesLoadingRemote
            : panels.lowcodeLibrariesLoadRemote
        }}
      </button>
    </div>
    <p id="lowcode-library-url-help" class="mt-1 text-[10px] text-muted">
      {{ panels.lowcodeLibrariesRemoteManifestUrlHelp }}
    </p>
  </form>

  <div class="mb-2 grid grid-cols-2 gap-1.5">
    <label
      class="cursor-pointer rounded border border-border px-2 py-1 text-center text-[11px] text-muted hover:bg-hover hover:text-surface"
      :class="isMutationBusy ? 'pointer-events-none opacity-40' : ''"
    >
      {{ panels.lowcodeLibrariesManifest }}
      <input
        type="file"
        accept=".json,application/json"
        class="hidden"
        data-test-id="lowcode-library-manifest-file"
        :aria-label="panels.lowcodeLibrariesManifestFileAria"
        :disabled="isMutationBusy"
        @change="loadManifest"
      />
    </label>
    <label
      class="cursor-pointer rounded border border-border px-2 py-1 text-center text-[11px] text-muted hover:bg-hover hover:text-surface"
      :class="isMutationBusy ? 'pointer-events-none opacity-40' : ''"
    >
      {{ panels.lowcodeLibrariesLibraryFile }}
      <input
        type="file"
        accept=".fig,.pen"
        class="hidden"
        data-test-id="lowcode-library-source-file"
        :aria-label="panels.lowcodeLibrariesLibraryFileAria"
        :disabled="isMutationBusy"
        @change="loadLibrary"
      />
    </label>
  </div>

  <div class="mb-2 flex flex-col gap-0.5 text-[10px] text-muted">
    <p v-if="manifestName" data-test-id="lowcode-library-manifest-name" class="truncate">
      {{ panels.lowcodeLibrariesManifestLoaded({ name: manifestName }) }}
    </p>
    <p v-if="libraryName" data-test-id="lowcode-library-source-name" class="truncate">
      {{ panels.lowcodeLibrariesLibraryLoaded({ name: libraryName }) }}
    </p>
    <p
      v-if="manifestError"
      data-test-id="lowcode-library-manifest-error"
      class="text-red-400"
      role="alert"
    >
      {{ manifestError }}
    </p>
    <p
      v-if="libraryError"
      data-test-id="lowcode-library-source-error"
      class="text-red-400"
      role="alert"
    >
      {{ libraryError }}
    </p>
    <p
      v-if="remoteURLInvalid || operationError"
      id="lowcode-library-url-error"
      data-test-id="lowcode-library-operation-error"
      class="text-red-400"
      role="alert"
    >
      {{ remoteURLInvalid ? panels.lowcodeLibrariesRemoteManifestUrlInvalid : operationError }}
    </p>
    <p
      v-if="statusMessage"
      data-test-id="lowcode-library-status-message"
      class="text-emerald-400"
      role="status"
      aria-live="polite"
    >
      <span data-test-id="lowcode-library-accept-message">{{ statusMessage }}</span>
    </p>
  </div>
</template>
