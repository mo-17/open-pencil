<script setup lang="ts">
import { computed, ref } from 'vue'

import type { LowcodeTranslations, SceneNode } from '@open-pencil/core/scene-graph'
import { useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

// Phase 3 §9 — fill in `lowcodeTranslations` (root-level, document-wide). The
// deploy/export panel's "Multi-language" toggle declares the target locales and
// emits per-locale catalogs; this panel is where the source strings get their
// translations. Round-trips via `lowcode/translations` pluginData; the compiler
// pre-fills each emitted `src/locales/<loc>.json` from here when i18n is on.
const editor = useEditorStore()
const sectionCls = useSectionUI()

const translations = useSceneComputed<LowcodeTranslations>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeTranslations ?? {}
})

/** The string a node contributes to the translatable set: TEXT content or an
 *  interactive node's `text` (BUTTON label). Mirrors what the compiler
 *  externalizes when i18n is on. Empty → not translatable. */
function sourceStringOf(node: SceneNode): string {
  if (node.type === 'TEXT' && typeof node.text === 'string') return node.text.trim()
  const interactiveText = node.interactiveProps?.text
  return typeof interactiveText === 'string' ? interactiveText.trim() : ''
}

// The document's unique translatable source strings, sorted.
const sources = useSceneComputed<string[]>(() => {
  const out = new Set<string>()
  for (const node of editor.graph.getAllNodes()) {
    const s = sourceStringOf(node)
    if (s !== '') out.add(s)
  }
  return [...out].sort()
})

const locales = computed(() => Object.keys(translations.value).sort())

const activeLocale = ref('')
const newLocale = ref('')

// Resolve the locale whose column is shown: the explicit selection when still
// valid, else the first declared locale.
const currentLocale = computed(() => {
  if (activeLocale.value !== '' && locales.value.includes(activeLocale.value)) {
    return activeLocale.value
  }
  return locales.value[0] ?? ''
})

/** Per-locale translated/total count, so the user sees coverage at a glance. */
function translatedCount(locale: string): number {
  const map = translations.value[locale] ?? {}
  return sources.value.filter((s) => (map[s] ?? '').trim() !== '').length
}

function commit(next: LowcodeTranslations): void {
  editor.updateNodeWithUndo(
    editor.graph.rootId,
    { lowcodeTranslations: next },
    'Update translations'
  )
}

function addLocale(): void {
  const code = newLocale.value.trim()
  newLocale.value = ''
  if (code === '') return
  activeLocale.value = code
  if (translations.value[code]) return
  commit({ ...translations.value, [code]: {} })
}

function removeLocale(code: string): void {
  const next = { ...translations.value }
  Reflect.deleteProperty(next, code)
  commit(next)
  if (activeLocale.value === code) activeLocale.value = ''
}

function setTranslation(locale: string, source: string, value: string): void {
  const localeMap = { ...translations.value[locale] }
  if (value.trim() === '') Reflect.deleteProperty(localeMap, source)
  else localeMap[source] = value
  commit({ ...translations.value, [locale]: localeMap })
}
</script>

<template>
  <div data-test-id="lowcode-translations-section" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">Translations</label>
    </div>

    <div class="mb-2 flex items-center gap-1">
      <input
        v-model="newLocale"
        type="text"
        aria-label="New target locale"
        data-test-id="lowcode-translations-new-locale"
        placeholder="add locale, e.g. ar"
        class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @keydown.enter="addLocale"
      />
      <button
        type="button"
        data-test-id="lowcode-translations-add-locale"
        class="rounded px-1.5 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addLocale"
      >
        + add
      </button>
    </div>

    <p v-if="locales.length === 0" class="text-[11px] text-muted">
      Add a target locale to translate the document's text into.
    </p>

    <template v-else>
      <div class="mb-2 flex items-center gap-1">
        <select
          :value="currentLocale"
          aria-label="Locale to edit"
          data-test-id="lowcode-translations-locale"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="activeLocale = ($event.target as HTMLSelectElement).value"
        >
          <option v-for="loc in locales" :key="loc" :value="loc">
            {{ loc }} ({{ translatedCount(loc) }}/{{ sources.length }})
          </option>
        </select>
        <button
          type="button"
          :aria-label="`Remove ${currentLocale}`"
          data-test-id="lowcode-translations-remove-locale"
          class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
          @click="removeLocale(currentLocale)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </div>

      <p
        v-if="sources.length === 0"
        data-test-id="lowcode-translations-empty"
        class="text-[11px] text-muted"
      >
        No translatable text in this document yet.
      </p>

      <ul v-else class="flex flex-col gap-1.5">
        <li
          v-for="source in sources"
          :key="source"
          data-test-id="lowcode-translations-row"
          class="flex flex-col gap-0.5"
        >
          <span class="truncate text-[10px] text-muted" :title="source">{{ source }}</span>
          <input
            :value="translations[currentLocale]?.[source] ?? ''"
            :aria-label="`Translation of ${source}`"
            data-test-id="lowcode-translations-value"
            spellcheck="false"
            :placeholder="source"
            class="min-w-0 rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
            @change="
              setTranslation(currentLocale, source, ($event.target as HTMLInputElement).value)
            "
          />
        </li>
      </ul>
    </template>
  </div>
</template>
