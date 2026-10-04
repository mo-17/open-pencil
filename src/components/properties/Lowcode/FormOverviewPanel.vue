<script setup lang="ts">
import { computed } from 'vue'

import { usePanelMessages, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { inspectFormOverview, type FormOverviewTarget } from '@/app/lowcode/form-overview'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import { formOverviewTheme } from '@/theme/form-overview'

const emit = defineEmits<{ reveal: [target: FormOverviewTarget] }>()
const editor = useEditorStore()
const panels = usePanelMessages()
const styles = formOverviewTheme()
const { selectedNode } = useSelectionState()
const overview = useSceneComputed(() => {
  const id = selectedNode.value?.id
  return id ? inspectFormOverview(editor.graph, id) : null
})
const bound = computed(
  () => overview.value?.fields.filter((field) => field.binding === 'valid').length ?? 0
)
const validated = computed(
  () => overview.value?.fields.filter((field) => field.validation === 'configured').length ?? 0
)
const asynchronous = computed(() => overview.value?.fields.some((field) => field.asynchronous))

function revealField(section: 'lowcode-bindings' | 'lowcode-validation', id?: string): void {
  const fields = overview.value?.fields ?? []
  const target =
    id ??
    fields.find((field) =>
      section === 'lowcode-bindings' ? field.binding !== 'valid' : field.validation !== 'configured'
    )?.id ??
    fields[0]?.id
  if (target) emit('reveal', { nodeId: target, section })
}

function revealSubmission(failure = false): void {
  const form = overview.value
  if (!form) return
  emit('reveal', {
    nodeId: form.formId,
    section: 'lowcode-events',
    actionPath: failure ? form.submission.attentionPath : undefined,
    actionId: failure ? form.submission.attentionActionId : undefined
  })
}
</script>

<template>
  <section
    v-if="overview"
    data-test-id="lowcode-form-overview"
    :class="styles.root()"
    :aria-label="panels.lowcodeFormOverview"
  >
    <h3 :class="styles.heading()">{{ panels.lowcodeFormOverview }} · {{ overview.name }}</h3>
    <ol :class="styles.steps()">
      <li>
        <AppButton
          type="button"
          data-test-id="form-overview-bindings"
          :disabled="!overview.fields.length"
          variant="outline"
          size="xs"
          :ui="{ base: styles.step() }"
          @click="revealField('lowcode-bindings')"
        >
          <span :class="styles.stepLabel()">1 · {{ panels.lowcodeFormBindings }}</span>
          <span :class="styles.count()">{{ bound }}/{{ overview.fields.length }}</span>
        </AppButton>
      </li>
      <li>
        <AppButton
          type="button"
          data-test-id="form-overview-validation"
          :disabled="!overview.fields.length"
          variant="outline"
          size="xs"
          :ui="{ base: styles.step() }"
          @click="revealField('lowcode-validation')"
        >
          <span :class="styles.stepLabel()">2 · {{ panels.lowcodeFormValidation }}</span>
          <span :class="styles.count()">{{ validated }}/{{ overview.fields.length }}</span>
        </AppButton>
      </li>
      <li>
        <AppButton
          type="button"
          data-test-id="form-overview-submit"
          variant="outline"
          size="xs"
          :ui="{ base: styles.step() }"
          @click="revealSubmission()"
        >
          <span :class="styles.stepLabel()">3 · {{ panels.lowcodeFormSubmit }}</span>
          <span :class="styles.count()">{{
            overview.submission.actions
              ? overview.submission.actions
              : panels.lowcodeFormNotConfigured
          }}</span>
        </AppButton>
      </li>
      <li>
        <AppButton
          type="button"
          data-test-id="form-overview-failure"
          variant="outline"
          size="xs"
          :ui="{ base: styles.step() }"
          @click="revealSubmission(true)"
        >
          <span :class="styles.stepLabel()">4 · {{ panels.lowcodeFormFailure }}</span>
          <span :class="styles.count()"
            ><template v-if="overview.submission.requests">
              {{ overview.submission.handled }}/{{ overview.submission.requests }}
            </template>
            <template v-else>{{ panels.lowcodeFormNotConfigured }}</template></span
          >
        </AppButton>
      </li>
    </ol>
    <p :class="styles.hint()">{{ panels.lowcodeFormOptional }}</p>
    <AppAlert
      v-if="overview.submission.invalidTargets"
      tone="warning"
      data-test-id="form-overview-invalid-error"
      :heading="panels.lowcodeFormInvalidErrorTarget"
    />
    <p
      v-if="overview.submission.workflow"
      data-test-id="form-overview-workflow"
      :class="styles.hint()"
    >
      {{ panels.lowcodeFormWorkflow }}
    </p>
    <details v-if="overview.fields.length || overview.submission.actions" :key="overview.formId">
      <summary :class="styles.details()">
        {{ panels.lowcodeFormFields }} · {{ overview.fields.length }}
      </summary>
      <p v-if="asynchronous" data-test-id="form-overview-async" :class="styles.hint()">
        {{ panels.lowcodeFormAsyncBoundary({ react: 'React', vue: 'Vue' }) }}
      </p>
      <p
        v-if="overview.submission.actions"
        :class="styles.hint()"
        data-test-id="form-overview-retention"
      >
        {{ panels.lowcodeFormRetention }}
      </p>
      <ul :class="styles.fields()">
        <li
          v-for="field in overview.fields"
          :key="field.id + (field.valueKey ?? '')"
          :data-form-field-id="field.id"
          :data-form-field-key="field.valueKey"
        >
          <span :class="styles.fieldName()"
            >{{ field.name
            }}{{
              field.valueKey
                ? ' · ' +
                  (field.valueKey === 'endValue'
                    ? panels.lowcodeModuleEndValue
                    : panels.lowcodeValueBinding)
                : ''
            }}</span
          >
          <span v-if="field.valueKey" :class="styles.hint()" data-form-submission-name>
            {{ panels.lowcodeBackendFieldName }}: {{ field.submissionName ?? '—' }}
          </span>
          <div :class="styles.fieldActions()">
            <AppButton
              type="button"
              color="primary"
              size="xs"
              :ui="{ base: styles.link() }"
              :data-test-id="`form-field-binding-${field.id}`"
              @click="revealField('lowcode-bindings', field.id)"
            >
              {{ panels.lowcodeFormBindings }}:
              {{
                field.binding === 'invalid'
                  ? panels.lowcodeFormInvalid
                  : field.binding === 'valid'
                    ? panels.lowcodeFormConfigured
                    : panels.lowcodeFormNotConfigured
              }}
            </AppButton>
            <AppButton
              type="button"
              color="primary"
              size="xs"
              :ui="{ base: styles.link() }"
              :data-test-id="`form-field-validation-${field.id}`"
              @click="revealField('lowcode-validation', field.id)"
            >
              {{ panels.lowcodeFormValidation }}:
              {{
                field.validation === 'invalid'
                  ? panels.lowcodeFormInvalid
                  : field.validation === 'configured'
                    ? panels.lowcodeFormConfigured
                    : panels.lowcodeFormNotConfigured
              }}
            </AppButton>
          </div>
        </li>
      </ul>
    </details>
    <p v-else :class="styles.hint()">{{ panels.lowcodeFormNoFields }}</p>
    <div
      v-if="overview.clickButtons.length"
      data-test-id="form-overview-click-warning"
      :class="styles.warning()"
    >
      <p>{{ panels.lowcodeFormClickWarning({ event: 'onClick' }) }}</p>
      <AppButton
        v-for="button in overview.clickButtons"
        :key="button.id"
        type="button"
        color="primary"
        size="xs"
        :ui="{ base: styles.link() }"
        @click="
          emit('reveal', {
            nodeId: button.id,
            section: 'lowcode-events',
            actionPath: 'onClick[0]',
            actionId: button.actionId
          })
        "
      >
        {{ button.name }}
      </AppButton>
    </div>
    <p v-if="overview.truncated || overview.submission.truncated" :class="styles.hint()">
      {{ panels.lowcodeFormLimited }}
    </p>
  </section>
</template>
