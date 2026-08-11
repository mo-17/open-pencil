<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'

import { isUploadAcceptToken, UPLOAD_BUTTON_MODULE_LIMITS } from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

const {
  modelValue,
  label,
  invalid = false
} = defineProps<{
  modelValue: readonly string[]
  label: string
  invalid?: boolean
}>()

const emit = defineEmits<{
  commit: [value: string[]]
}>()

const { panels } = useI18n()
const draft = ref([...modelValue])
const localErrors = reactive<Record<number, string>>({})
const editorRoot = ref<HTMLElement | null>(null)
const addButton = ref<HTMLButtonElement | null>(null)

watch(
  () => modelValue,
  (value) => {
    draft.value = [...value]
    clearErrors()
  },
  { deep: true }
)

function clearErrors(): void {
  for (const key of Object.keys(localErrors)) Reflect.deleteProperty(localErrors, Number(key))
}

function sameTokens(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index])
}

function updateToken(index: number, event: Event): void {
  draft.value[index] = (event.target as HTMLInputElement).value
  Reflect.deleteProperty(localErrors, index)
}

function commitToken(index: number): void {
  const value = draft.value[index]
  if (value === undefined) return
  const token = value.trim().toLowerCase()
  if (token.length === 0) {
    localErrors[index] = panels.value.lowcodeUploadAcceptEmptyToken
    return
  }
  if (!isUploadAcceptToken(token)) {
    localErrors[index] = panels.value.lowcodeUploadAcceptInvalidToken({
      max: UPLOAD_BUTTON_MODULE_LIMITS.acceptToken
    })
    return
  }
  if (
    draft.value.some(
      (candidate, candidateIndex) =>
        candidateIndex !== index && candidate.trim().toLowerCase() === token
    )
  ) {
    localErrors[index] = panels.value.lowcodeUploadAcceptDuplicateToken
    return
  }
  draft.value[index] = token
  Reflect.deleteProperty(localErrors, index)
  if (invalid || !sameTokens(draft.value, modelValue)) emit('commit', [...draft.value])
}

function commitOnEnter(index: number, event: KeyboardEvent): void {
  if (event.key !== 'Enter') return
  event.preventDefault()
  commitToken(index)
}

async function addToken(): Promise<void> {
  if (draft.value.length >= UPLOAD_BUTTON_MODULE_LIMITS.acceptMax) return
  const index = draft.value.length
  draft.value.push('')
  await nextTick()
  editorRoot.value
    ?.querySelector<HTMLInputElement>(`[data-upload-accept-index="${index}"]`)
    ?.focus()
}

async function removeToken(index: number): Promise<void> {
  draft.value.splice(index, 1)
  clearErrors()
  if (invalid || !sameTokens(draft.value, modelValue)) emit('commit', [...draft.value])
  await nextTick()
  const adjacentIndex = Math.min(index, draft.value.length - 1)
  const adjacent = editorRoot.value?.querySelector<HTMLInputElement>(
    `[data-upload-accept-index="${adjacentIndex}"]`
  )
  const focusTarget = adjacent ?? addButton.value
  focusTarget?.focus()
}
</script>

<template>
  <div
    ref="editorRoot"
    data-test-id="upload-accept-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-2"
  >
    <div class="flex items-center gap-2">
      <button
        ref="addButton"
        type="button"
        data-test-id="upload-accept-add"
        :disabled="draft.length >= UPLOAD_BUTTON_MODULE_LIMITS.acceptMax"
        class="min-h-11 rounded border border-border bg-surface px-3 py-2 text-[11px] font-medium text-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        @click="addToken"
      >
        {{ panels.lowcodeUploadAcceptAdd }}
      </button>
      <span class="ml-auto text-[10px] text-muted">
        {{
          panels.lowcodeUploadAcceptCount({
            count: draft.length,
            max: UPLOAD_BUTTON_MODULE_LIMITS.acceptMax
          })
        }}
      </span>
    </div>

    <p v-if="draft.length === 0" data-test-id="upload-accept-empty" class="text-[10px] text-muted">
      {{ panels.lowcodeUploadAcceptEmpty }}
    </p>

    <div v-else class="flex max-h-80 flex-col gap-2 overflow-auto">
      <div
        v-for="(token, index) in draft"
        :key="index"
        data-test-id="upload-accept-row"
        class="rounded border border-border bg-input p-2"
      >
        <label
          :for="`upload-accept-token-${index}`"
          class="block text-[10px] font-medium text-surface"
        >
          {{ panels.lowcodeUploadAcceptTokenNumber({ item: index + 1 }) }}
        </label>
        <div class="mt-1 flex items-stretch gap-2">
          <input
            :id="`upload-accept-token-${index}`"
            :value="token"
            :data-upload-accept-index="index"
            :maxlength="UPLOAD_BUTTON_MODULE_LIMITS.acceptToken"
            :placeholder="panels.lowcodeUploadAcceptPlaceholder"
            :aria-label="panels.lowcodeUploadAcceptTokenNumber({ item: index + 1 })"
            :aria-invalid="Boolean(localErrors[index])"
            :aria-describedby="localErrors[index] ? `upload-accept-error-${index}` : undefined"
            data-test-id="upload-accept-input"
            spellcheck="false"
            class="min-h-11 min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 font-mono text-xs text-input placeholder:text-input/60 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            @input="updateToken(index, $event)"
            @blur="commitToken(index)"
            @keydown="commitOnEnter(index, $event)"
          />
          <button
            type="button"
            data-test-id="upload-accept-remove"
            :aria-label="panels.lowcodeUploadAcceptRemoveToken({ item: index + 1 })"
            class="min-h-11 shrink-0 rounded border border-border bg-surface px-3 py-2 text-[10px] font-medium text-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            @click="removeToken(index)"
          >
            {{ panels.lowcodeUploadAcceptRemove }}
          </button>
        </div>
        <p
          v-if="localErrors[index]"
          :id="`upload-accept-error-${index}`"
          data-test-id="upload-accept-local-error"
          role="alert"
          class="mt-1 text-[10px] text-red-400"
        >
          {{ localErrors[index] }}
        </p>
      </div>
    </div>

    <p class="text-[10px] leading-relaxed text-muted">{{ panels.lowcodeUploadAcceptHint }}</p>
    <p
      data-test-id="upload-accept-validation-hint"
      class="rounded border border-border bg-input px-2 py-1.5 text-[10px] leading-relaxed text-surface"
    >
      {{ panels.lowcodeUploadAcceptValidationHint }}
    </p>
    <p
      data-test-id="upload-local-only-notice"
      role="note"
      class="rounded border border-accent/50 bg-accent/10 px-2 py-1.5 text-[10px] font-medium leading-relaxed text-surface"
    >
      {{ panels.lowcodeUploadLocalOnlyNotice }}
    </p>
  </div>
</template>
