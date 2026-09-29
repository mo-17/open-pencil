<script setup lang="ts">
import { computed, useId } from 'vue'

import { useCodeMessages, useCommonMessages } from '@open-pencil/vue'

import { DESIGN_BRIEF_NOTE_LIMIT } from '@/app/design-brief/state'
import { useDesignBrief } from '@/app/design-brief/use'
import { toast } from '@/app/shell/ui'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppDialogBody from '@/components/ui/dialog/AppDialogBody.vue'
import AppDialogFooter from '@/components/ui/dialog/AppDialogFooter.vue'
import AppDialogHeader from '@/components/ui/dialog/AppDialogHeader.vue'
import AppDialogRoot from '@/components/ui/dialog/AppDialogRoot.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import { designBrief } from '@/theme/design-brief'

const open = defineModel<boolean>('open', { default: false })
const code = useCodeMessages()
const common = useCommonMessages()
const id = useId()
const cls = designBrief()
const {
  draft,
  result,
  current,
  markdown,
  generate,
  failure,
  pending,
  outcome,
  transfer,
  stageInChat
} = useDesignBrief(open)
const scopeOptions = computed(() => [
  { value: 'page' as const, label: code.value.briefPage },
  { value: 'selection' as const, label: code.value.briefSelection },
  { value: 'document' as const, label: code.value.briefDocument }
])
const localeOptions = computed(() => [
  { value: 'zh-CN' as const, label: code.value.briefChinese },
  { value: 'en' as const, label: code.value.briefEnglish }
])
const failureText = computed(() => {
  if (failure.value === 'copy') return code.value.briefCopyFailed
  if (failure.value === 'save') return code.value.briefSaveFailed
  if (failure.value === 'chat-limit') return code.value.briefChatLimit
  return code.value.briefBuildFailed
})

function prepareChat() {
  if (stageInChat()) toast.info(code.value.briefChatReady)
}
</script>

<template>
  <AppDialogRoot v-model:open="open" size="lg" height="full" data-test-id="design-brief-dialog">
    <AppDialogHeader
      :heading="code.briefTitle"
      :description="code.briefDescription"
      :close-label="common.close"
    />
    <AppDialogBody>
      <div :class="cls.body()">
        <div :class="cls.controls()">
          <div :class="cls.field()">
            <span>{{ code.briefScope }}</span>
            <AppSelect
              v-model="draft.scopeKind"
              :options="scopeOptions"
              :label="code.briefScope"
              data-test-id="design-brief-scope"
            />
          </div>
          <div :class="cls.field()">
            <span>{{ code.briefLanguage }}</span>
            <AppSelect
              v-model="draft.locale"
              :options="localeOptions"
              :label="code.briefLanguage"
              data-test-id="design-brief-language"
            />
          </div>
          <AppButton :disabled="pending" data-test-id="design-brief-refresh" @click="generate">
            <template #leading><icon-lucide-refresh-cw class="size-3.5" /></template>
            {{ code.briefRefresh }}
          </AppButton>
        </div>

        <AppAlert v-if="failure" tone="error" :heading="failureText" />
        <AppAlert
          v-else-if="result && !current"
          tone="warning"
          :heading="code.briefStale"
          :description="code.briefStaleDetail"
          data-test-id="design-brief-stale"
        />
        <AppAlert
          v-if="result?.brief.truncated"
          tone="warning"
          :heading="code.briefTruncated"
          :description="code.briefTruncatedDetail"
        />

        <div :class="cls.field()">
          <label :for="`${id}-notes`" :class="cls.label()">{{ code.briefNotes }}</label>
          <AppTextarea
            :id="`${id}-notes`"
            v-model="draft.notes"
            :rows="3"
            :maxlength="DESIGN_BRIEF_NOTE_LIMIT"
            :aria-describedby="`${id}-notes-hint`"
            :placeholder="code.briefNotesPlaceholder"
            data-test-id="design-brief-notes"
          />
          <p :id="`${id}-notes-hint`" :class="cls.hint()">{{ code.briefNotesHint }}</p>
        </div>

        <div :class="cls.field()">
          <label :for="`${id}-output`" :class="cls.label()">{{ code.briefPreview }}</label>
          <AppTextarea
            :id="`${id}-output`"
            :model-value="markdown"
            :rows="16"
            readonly
            :class="cls.preview()"
            data-test-id="design-brief-preview"
          />
          <p :class="cls.hint()">{{ code.briefReviewHint }}</p>
        </div>
      </div>
    </AppDialogBody>
    <AppDialogFooter :ui="{ footer: cls.footer() }">
      <span v-if="outcome" role="status" :class="cls.status()">
        {{ outcome === 'copied' ? common.copied : code.briefSaved }}
      </span>
      <AppButton
        :disabled="!current || pending"
        data-test-id="design-brief-copy"
        @click="transfer('copy')"
      >
        <template #leading><icon-lucide-copy class="size-3.5" /></template>
        {{ common.copy }}
      </AppButton>
      <AppButton
        :disabled="!current || pending"
        data-test-id="design-brief-save"
        @click="transfer('save')"
      >
        <template #leading><icon-lucide-download class="size-3.5" /></template>
        {{ code.briefDownload }}
      </AppButton>
      <AppButton
        color="primary"
        variant="solid"
        :disabled="!current || pending"
        data-test-id="design-brief-chat"
        @click="prepareChat"
      >
        <template #leading><icon-lucide-sparkles class="size-3.5" /></template>
        {{ code.briefToChat }}
      </AppButton>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
