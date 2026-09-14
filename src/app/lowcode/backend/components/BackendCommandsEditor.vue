<script setup lang="ts">
import { computed } from 'vue'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import { commerceCopy } from '../commerce/copy'
import { nestJSUICopy } from './nestjs-ui-copy'
const { application } = defineProps<{ application: BackendApplicationSpecV1 }>()
const { locale } = useI18n()
const text = computed(() => commerceCopy(locale.value))
const nestJSText = computed(() => nestJSUICopy(locale.value))
const commands = computed(() => application.commands?.commands ?? [])
function entityName(id: string): string {
  return application.dataModel.entities.find((entity) => entity.id === id)?.name ?? id
}
</script>
<template>
  <div class="mt-2 space-y-3" data-test-id="backend-commands-editor">
    <p class="text-[10px] leading-relaxed text-muted">{{ text.commandHint }}</p>
    <p v-if="!commands.length" class="text-[10px] text-muted">{{ text.empty }}</p>
    <article
      v-for="command in commands"
      :key="command.id"
      class="space-y-2 rounded border border-border p-2"
    >
      <h4 class="text-xs font-medium text-surface">{{ command.name }}</h4>
      <p class="break-all font-mono text-[10px] text-muted">POST {{ command.path }}</p>
      <p class="text-[10px] text-muted">
        {{ text.access }}:
        {{
          command.access.kind === 'authenticated'
            ? text.authenticated
            : command.access.kind === 'row-policy'
              ? nestJSText.commandRowPolicy
              : (command.access.roleId ?? nestJSText.membershipOnly)
        }}
      </p>
      <p v-if="command.access.kind === 'tenant-member'" class="text-[10px] text-muted">
        {{ nestJSText.commandTenant }}: {{ command.access.tenantId }} ·
        {{ command.access.parameter }}
      </p>
      <p v-if="command.access.kind === 'row-policy'" class="text-[10px] text-muted">
        {{ entityName(command.access.entityId) }} · {{ command.access.parameter }} ·
        {{ command.access.policyIds.join(', ') }}
        <span v-if="command.access.roleId">
          · {{ nestJSText.roleId }}: {{ command.access.roleId }}</span
        >
      </p>
      <p class="text-[10px] text-muted">
        {{ text.entities }}:
        {{
          [
            ...new Set(
              command.steps.flatMap((step) =>
                'entityId' in step ? [entityName(step.entityId)] : []
              )
            )
          ].join(', ')
        }}
      </p>
      <fieldset class="space-y-1">
        <legend class="text-[10px] text-surface">{{ text.parameters }}</legend>
        <p
          v-for="parameter in command.parameters"
          :key="parameter.name"
          class="font-mono text-[10px] text-muted"
        >
          {{ parameter.name }} · {{ parameter.type
          }}<span v-if="parameter.type === 'integer'">
            · {{ parameter.min }}–{{ parameter.max }}</span
          >
        </p>
      </fieldset>
      <details>
        <summary class="cursor-pointer text-[10px] text-surface">
          {{ text.steps }} ({{ command.steps.length }})
        </summary>
        <ol class="mt-2 space-y-2 text-[10px] text-muted">
          <li v-for="step in command.steps" :key="step.id">
            <span class="font-medium">{{ step.id }} · {{ step.kind }}</span>
            <pre class="overflow-auto whitespace-pre-wrap break-all">{{
              JSON.stringify(step, null, 2)
            }}</pre>
          </li>
        </ol>
      </details>
      <p class="text-[10px] text-muted">
        {{ text.returns }}: {{ command.return.fields.join(', ') }}
      </p>
    </article>
  </div>
</template>
