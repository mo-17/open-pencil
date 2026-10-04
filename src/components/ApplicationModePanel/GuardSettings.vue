<script setup lang="ts">
import { computed, useId } from 'vue'

import {
  LOWCODE_APPLICATION_GUARD_EXPRESSION_MAX_LENGTH,
  LOWCODE_APPLICATION_GUARD_FALLBACK_MAX_LENGTH,
  LOWCODE_APPLICATION_GUARD_MESSAGE_MAX_LENGTH
} from '@open-pencil/lowcode'
import { useCommonMessages, usePageMessages } from '@open-pencil/vue'

import type { ApplicationGuardPanelModel } from '@/app/lowcode/application-mode/guards/types'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'

const { model } = defineProps<{ model: ApplicationGuardPanelModel }>()
const messages = usePageMessages()
const common = useCommonMessages()
const id = useId()
const enter = computed(() => model.kind === 'enter')
const title = computed(() =>
  enter.value
    ? messages.value.applicationEnterGuardTitle
    : messages.value.applicationLeaveConfirmTitle
)
const expressionLabel = computed(() =>
  enter.value
    ? messages.value.applicationEnterGuardExpression
    : messages.value.applicationLeaveConfirmExpression
)
const detailLabel = computed(() =>
  enter.value
    ? messages.value.applicationEnterGuardFallback
    : messages.value.applicationLeaveConfirmMessage
)
const expressionInvalid = computed(
  () => (model.dirty || model.configured) && !model.expressionValid
)
const detailInvalid = computed(() => (model.dirty || model.configured) && !model.detailValid)
</script>

<template>
  <section
    class="space-y-2 border-t border-border pt-2"
    :aria-labelledby="`${id}-title`"
    :data-application-guard="model.kind"
  >
    <h3 :id="`${id}-title`" class="text-xs font-medium">{{ title }}</h3>
    <p class="text-[10px] leading-relaxed text-muted">
      {{ enter ? messages.applicationEnterGuardHint : messages.applicationLeaveConfirmHint }}
    </p>
    <div class="space-y-1">
      <label :for="`${id}-expression`" class="text-[11px] text-muted">{{ expressionLabel }}</label>
      <AppInput
        :id="`${id}-expression`"
        :model-value="model.expression"
        :aria-label="expressionLabel"
        :disabled="model.disabled"
        :maxlength="LOWCODE_APPLICATION_GUARD_EXPRESSION_MAX_LENGTH"
        :state="expressionInvalid ? 'invalid' : 'idle'"
        :aria-invalid="expressionInvalid || undefined"
        :aria-describedby="expressionInvalid ? `${id}-expression-error` : undefined"
        spellcheck="false"
        :data-property="`application-${model.kind}-expression`"
        @update:model-value="model.editExpression"
      />
      <p
        v-if="expressionInvalid"
        :id="`${id}-expression-error`"
        role="alert"
        class="text-[10px] text-danger"
      >
        {{ messages.applicationGuardExpressionInvalid }}
      </p>
    </div>
    <div class="space-y-1">
      <label :for="`${id}-detail`" class="text-[11px] text-muted">{{ detailLabel }}</label>
      <AppInput
        :id="`${id}-detail`"
        :model-value="model.detail"
        :aria-label="detailLabel"
        :disabled="model.disabled"
        :maxlength="
          enter
            ? LOWCODE_APPLICATION_GUARD_FALLBACK_MAX_LENGTH
            : LOWCODE_APPLICATION_GUARD_MESSAGE_MAX_LENGTH
        "
        :state="detailInvalid ? 'invalid' : 'idle'"
        :aria-invalid="detailInvalid || undefined"
        :aria-describedby="detailInvalid ? `${id}-detail-error` : undefined"
        :spellcheck="!enter"
        :data-property="`application-${model.kind}-detail`"
        @update:model-value="model.editDetail"
      />
      <p
        v-if="detailInvalid"
        :id="`${id}-detail-error`"
        role="alert"
        class="text-[10px] text-danger"
      >
        {{
          enter ? messages.applicationGuardFallbackInvalid : messages.applicationGuardMessageInvalid
        }}
      </p>
    </div>
    <p v-if="model.dirty" class="text-[10px] leading-relaxed text-muted" role="status">
      {{ messages.applicationGuardDraftHint }}
    </p>
    <div class="flex flex-wrap gap-1">
      <AppButton
        color="primary"
        variant="solid"
        :disabled="!model.canApply"
        :data-command="`application-${model.kind}-apply`"
        @click="model.apply"
        >{{ messages.applicationGuardApply }}</AppButton
      >
      <AppButton
        :disabled="model.disabled || !model.dirty"
        :data-command="`application-${model.kind}-cancel`"
        @click="model.cancel"
        >{{ common.cancel }}</AppButton
      >
      <AppButton
        v-if="model.configured"
        :disabled="model.disabled"
        :data-command="`application-${model.kind}-remove`"
        @click="model.remove"
        >{{ messages.applicationGuardRemove }}</AppButton
      >
    </div>
  </section>
</template>
