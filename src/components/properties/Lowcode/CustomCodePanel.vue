<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type {
  LowcodeHeadLink,
  LowcodeHeadLinkCrossOrigin,
  LowcodeHeadMeta,
  LowcodeHeadMetaKind,
  LowcodeHeadMetadata
} from '@open-pencil/scene-graph'
import { useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import {
  analyzeCustomCodeCspRisks,
  buildCustomCodePatch,
  draftFromCustomCode,
  emptyHeadLink,
  emptyHeadMeta,
  hasIncompleteCustomCodeRows,
  hasUnsafeCustomCodeUrls,
  LOWCODE_HEAD_LINK_CROSS_ORIGINS,
  LOWCODE_HEAD_META_KINDS
} from '@/app/lowcode/custom-code-panel-state'

const editor = useEditorStore()
const sectionCls = useSectionUI()

const headMetadata = useSceneComputed<LowcodeHeadMetadata | undefined>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeHeadMetadata
})

const customCss = useSceneComputed<string | undefined>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeCustomCss
})

const metaRows = ref<LowcodeHeadMeta[]>([])
const linkRows = ref<LowcodeHeadLink[]>([])
const stylesText = ref('')
const customCssText = ref('')

const cspRisks = computed(() =>
  analyzeCustomCodeCspRisks({
    meta: metaRows.value,
    link: linkRows.value,
    stylesText: stylesText.value,
    customCss: customCssText.value
  })
)

watch(
  [() => headMetadata.value, () => customCss.value],
  ([head, css]) => {
    const draft = draftFromCustomCode(head, css)
    metaRows.value = draft.meta
    linkRows.value = draft.link
    stylesText.value = draft.stylesText
    customCssText.value = draft.customCss
  },
  { immediate: true }
)

function commitDraft(): void {
  const draft = {
    meta: metaRows.value,
    link: linkRows.value,
    stylesText: stylesText.value,
    customCss: customCssText.value
  }
  if (hasIncompleteCustomCodeRows(draft) || hasUnsafeCustomCodeUrls(draft)) return
  const patch = buildCustomCodePatch(draft)
  editor.updateNodeWithUndo(editor.graph.rootId, patch, 'Update custom code')
}

function addMeta(): void {
  metaRows.value = [...metaRows.value, emptyHeadMeta()]
}

function updateMeta(index: number, patch: Partial<LowcodeHeadMeta>): void {
  metaRows.value = metaRows.value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
  commitDraft()
}

function removeMeta(index: number): void {
  metaRows.value = metaRows.value.filter((_, i) => i !== index)
  commitDraft()
}

function addLink(): void {
  linkRows.value = [...linkRows.value, emptyHeadLink()]
}

function updateLink(index: number, patch: Partial<LowcodeHeadLink>): void {
  linkRows.value = linkRows.value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
  commitDraft()
}

function removeLink(index: number): void {
  linkRows.value = linkRows.value.filter((_, i) => i !== index)
  commitDraft()
}

function updateStyles(value: string): void {
  stylesText.value = value
  commitDraft()
}

function updateCustomCss(value: string): void {
  customCssText.value = value
  commitDraft()
}

function clearAll(): void {
  metaRows.value = []
  linkRows.value = []
  stylesText.value = ''
  customCssText.value = ''
  commitDraft()
}
</script>

<template>
  <div data-test-id="lowcode-custom-code-section" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">Custom head & CSS</label>
      <button
        v-if="headMetadata || customCss"
        type="button"
        data-test-id="lowcode-custom-code-clear"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="clearAll"
      >
        Clear
      </button>
    </div>

    <div class="mb-2 flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-normal text-muted">Meta</span>
      <button
        type="button"
        data-test-id="lowcode-custom-head-meta-add"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addMeta"
      >
        + Meta
      </button>
    </div>
    <p v-if="metaRows.length === 0" class="mb-2 text-[11px] text-muted">
      Add structured meta tags for SEO, CSP, or social previews.
    </p>
    <div v-for="(entry, index) in metaRows" :key="index" class="mb-2 flex flex-col gap-1">
      <div class="flex gap-1">
        <select
          :value="entry.kind"
          aria-label="Meta kind"
          data-test-id="lowcode-custom-head-meta-kind"
          class="w-[88px] rounded border border-border bg-input px-1 py-1 text-[11px] text-surface outline-none focus:border-accent"
          @change="
            updateMeta(index, {
              kind: ($event.target as HTMLSelectElement).value as LowcodeHeadMetaKind
            })
          "
        >
          <option v-for="kind in LOWCODE_HEAD_META_KINDS" :key="kind" :value="kind">
            {{ kind }}
          </option>
        </select>
        <input
          :value="entry.key"
          aria-label="Meta key"
          data-test-id="lowcode-custom-head-meta-key"
          placeholder="viewport"
          spellcheck="false"
          class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
          @change="updateMeta(index, { key: ($event.target as HTMLInputElement).value })"
        />
        <button
          type="button"
          aria-label="Remove meta"
          data-test-id="lowcode-custom-head-meta-remove"
          class="w-7 rounded text-[11px] text-muted hover:bg-hover hover:text-surface"
          @click="removeMeta(index)"
        >
          x
        </button>
      </div>
      <input
        :value="entry.content"
        aria-label="Meta content"
        data-test-id="lowcode-custom-head-meta-content"
        placeholder="width=device-width, initial-scale=1"
        spellcheck="false"
        class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
        @change="updateMeta(index, { content: ($event.target as HTMLInputElement).value })"
      />
    </div>

    <div class="mb-2 mt-3 flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-normal text-muted">Links</span>
      <button
        type="button"
        data-test-id="lowcode-custom-head-link-add"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addLink"
      >
        + Link
      </button>
    </div>
    <p v-if="linkRows.length === 0" class="mb-2 text-[11px] text-muted">
      Add structured link tags for icons, preload, or external stylesheets.
    </p>
    <div v-for="(entry, index) in linkRows" :key="index" class="mb-2 flex flex-col gap-1">
      <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_28px] gap-1">
        <input
          :value="entry.rel"
          aria-label="Link rel"
          data-test-id="lowcode-custom-head-link-rel"
          placeholder="stylesheet"
          spellcheck="false"
          class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
          @change="updateLink(index, { rel: ($event.target as HTMLInputElement).value })"
        />
        <input
          :value="entry.href"
          aria-label="Link href"
          data-test-id="lowcode-custom-head-link-href"
          placeholder="https://..."
          spellcheck="false"
          class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
          @change="updateLink(index, { href: ($event.target as HTMLInputElement).value })"
        />
        <button
          type="button"
          aria-label="Remove link"
          data-test-id="lowcode-custom-head-link-remove"
          class="rounded text-[11px] text-muted hover:bg-hover hover:text-surface"
          @click="removeLink(index)"
        >
          x
        </button>
      </div>
      <div class="grid grid-cols-2 gap-1">
        <input
          :value="entry.as ?? ''"
          aria-label="Link as"
          data-test-id="lowcode-custom-head-link-as"
          placeholder="as"
          spellcheck="false"
          class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
          @change="updateLink(index, { as: ($event.target as HTMLInputElement).value })"
        />
        <input
          :value="entry.type ?? ''"
          aria-label="Link type"
          data-test-id="lowcode-custom-head-link-type"
          placeholder="type"
          spellcheck="false"
          class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
          @change="updateLink(index, { type: ($event.target as HTMLInputElement).value })"
        />
        <input
          :value="entry.media ?? ''"
          aria-label="Link media"
          data-test-id="lowcode-custom-head-link-media"
          placeholder="media"
          spellcheck="false"
          class="min-w-0 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
          @change="updateLink(index, { media: ($event.target as HTMLInputElement).value })"
        />
        <select
          :value="entry.crossorigin ?? ''"
          aria-label="Link crossorigin"
          data-test-id="lowcode-custom-head-link-crossorigin"
          class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[11px] text-surface outline-none focus:border-accent"
          @change="
            updateLink(index, {
              crossorigin: (($event.target as HTMLSelectElement).value || undefined) as
                | LowcodeHeadLinkCrossOrigin
                | undefined
            })
          "
        >
          <option value="">no CORS</option>
          <option
            v-for="crossorigin in LOWCODE_HEAD_LINK_CROSS_ORIGINS"
            :key="crossorigin"
            :value="crossorigin"
          >
            {{ crossorigin }}
          </option>
        </select>
      </div>
    </div>

    <label class="mb-1 mt-3 block text-[10px] uppercase tracking-normal text-muted">
      Head styles
    </label>
    <textarea
      :value="stylesText"
      aria-label="Head styles"
      data-test-id="lowcode-custom-head-styles"
      spellcheck="false"
      placeholder=":root { color-scheme: light; }"
      class="min-h-20 w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
      @change="updateStyles(($event.target as HTMLTextAreaElement).value)"
    />

    <label class="mb-1 mt-3 block text-[10px] uppercase tracking-normal text-muted">
      App CSS
    </label>
    <textarea
      :value="customCssText"
      aria-label="Custom CSS"
      data-test-id="lowcode-custom-css"
      spellcheck="false"
      placeholder=".app-shell { scroll-behavior: smooth; }"
      class="min-h-24 w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface outline-none focus:border-accent"
      @change="updateCustomCss(($event.target as HTMLTextAreaElement).value)"
    />

    <div
      v-if="cspRisks.length > 0"
      data-test-id="lowcode-custom-code-csp-risks"
      class="mt-2 rounded border border-border bg-hover/40 px-2 py-1.5 text-[10px] text-muted"
    >
      <div class="mb-1 font-medium text-surface">Deploy CSP checks</div>
      <ul class="list-disc space-y-1 pl-4">
        <li v-for="risk in cspRisks" :key="risk.id">
          <span class="font-medium text-surface">{{ risk.title }}</span>
          <span class="block">{{ risk.detail }}</span>
        </li>
      </ul>
    </div>

    <p data-test-id="lowcode-custom-code-note" class="mt-1.5 text-[10px] text-muted">
      Structured meta, link, and style output only. Scripts and raw HTML are intentionally not
      emitted.
    </p>
  </div>
</template>
