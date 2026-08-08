<script setup lang="ts">
import { ref } from 'vue'

import {
  RICH_TEXT_MODULE_LIMITS,
  type RichTextInlineV1,
  type RichTextSimpleMarkTypeV1
} from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

import {
  createRichTextInline,
  richTextInlineLink,
  setRichTextInlineLink,
  toggleRichTextInlineMark
} from '@/app/plugins/rich-text-editor-model'

const { modelValue } = defineProps<{ modelValue: readonly RichTextInlineV1[] }>()
const emit = defineEmits<{ commit: [value: RichTextInlineV1[]] }>()
const { menu, panels } = useI18n()
const error = ref('')

const markButtons: readonly {
  type: RichTextSimpleMarkTypeV1
  label: () => string
  glyph: string
}[] = [
  { type: 'bold', label: () => menu.value.bold, glyph: 'B' },
  { type: 'italic', label: () => menu.value.italic, glyph: 'I' },
  { type: 'underline', label: () => menu.value.underline, glyph: 'U' },
  { type: 'strike', label: () => menu.value.strikethrough, glyph: 'S' },
  { type: 'code', label: () => panels.value.lowcodeRichTextInlineCode, glyph: '<>' }
]

function replaceInline(index: number, inline: RichTextInlineV1): void {
  const next = modelValue.map((candidate, candidateIndex) =>
    candidateIndex === index ? inline : structuredClone(candidate)
  )
  error.value = ''
  emit('commit', next)
}

function updateText(index: number, text: string): void {
  replaceInline(index, { ...modelValue[index], text })
}

function toggleMark(index: number, type: RichTextSimpleMarkTypeV1): void {
  try {
    replaceInline(index, toggleRichTextInlineMark(modelValue[index], type))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function updateLink(index: number, href: string): void {
  try {
    replaceInline(index, setRichTextInlineLink(modelValue[index], href.trim()))
  } catch {
    error.value = panels.value.lowcodeRichTextInvalidLink
  }
}

function addInline(afterIndex?: number): void {
  if (modelValue.length >= RICH_TEXT_MODULE_LIMITS.inlinesPerBlock) return
  const next = modelValue.map((inline) => structuredClone(inline))
  next.splice(afterIndex === undefined ? next.length : afterIndex + 1, 0, createRichTextInline())
  error.value = ''
  emit('commit', next)
}

function removeInline(index: number): void {
  const next = modelValue
    .filter((_, candidateIndex) => candidateIndex !== index)
    .map((inline) => structuredClone(inline))
  error.value = ''
  emit('commit', next.length > 0 ? next : [createRichTextInline()])
}

function hasMark(inline: RichTextInlineV1, type: RichTextSimpleMarkTypeV1): boolean {
  return inline.marks.some((mark) => mark.type === type)
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test-id="rich-text-inline-editor">
    <div
      v-for="(inline, index) in modelValue"
      :key="index"
      class="rounded border border-border/80 bg-input/40 p-1.5"
      data-test-id="rich-text-inline-row"
    >
      <div class="flex items-start gap-1">
        <textarea
          :value="inline.text"
          :aria-label="panels.lowcodeRichTextText"
          :maxlength="RICH_TEXT_MODULE_LIMITS.textPerInline"
          rows="2"
          class="min-w-0 flex-1 resize-y rounded border border-border bg-input px-1.5 py-1 text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
          data-test-id="rich-text-inline-text"
          @change="updateText(index, ($event.target as HTMLTextAreaElement).value)"
        />
        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-secondary hover:text-surface"
          :aria-label="panels.lowcodeRichTextDeleteInline"
          data-test-id="rich-text-delete-inline"
          @click="removeInline(index)"
        >
          <icon-lucide-trash-2 class="size-3" />
        </button>
      </div>

      <div class="mt-1 flex flex-wrap items-center gap-1">
        <button
          v-for="mark in markButtons"
          :key="mark.type"
          type="button"
          class="min-w-6 rounded border px-1 py-0.5 text-[9px]"
          :class="
            hasMark(inline, mark.type)
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border text-muted hover:text-surface'
          "
          :aria-label="mark.label()"
          :data-mark="mark.type"
          data-test-id="rich-text-mark-toggle"
          @click="toggleMark(index, mark.type)"
        >
          <span :class="{ italic: mark.type === 'italic', underline: mark.type === 'underline' }">
            {{ mark.glyph }}
          </span>
        </button>

        <input
          :value="richTextInlineLink(inline)"
          type="text"
          inputmode="url"
          :placeholder="panels.lowcodeRichTextLinkPlaceholder"
          :aria-label="panels.lowcodeRichTextLink"
          class="min-w-28 flex-1 rounded border border-border bg-input px-1.5 py-0.5 text-[9px] text-surface outline-none focus:border-accent"
          data-test-id="rich-text-inline-link"
          @change="updateLink(index, ($event.target as HTMLInputElement).value)"
        />

        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-secondary hover:text-surface disabled:opacity-40"
          :disabled="modelValue.length >= RICH_TEXT_MODULE_LIMITS.inlinesPerBlock"
          :aria-label="panels.lowcodeRichTextAddInline"
          data-test-id="rich-text-add-inline"
          @click="addInline(index)"
        >
          <icon-lucide-plus class="size-3" />
        </button>
      </div>
    </div>

    <button
      v-if="modelValue.length === 0"
      type="button"
      class="rounded border border-dashed border-border px-2 py-1 text-[10px] text-muted hover:text-surface"
      data-test-id="rich-text-add-first-inline"
      @click="addInline()"
    >
      <icon-lucide-plus class="mr-1 inline size-3" />
      {{ panels.lowcodeRichTextAddInline }}
    </button>

    <p v-if="error" class="text-[9px] text-red-400" data-test-id="rich-text-inline-error">
      {{ error }}
    </p>
  </div>
</template>
