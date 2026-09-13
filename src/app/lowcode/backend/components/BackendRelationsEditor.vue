<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  BACKEND_LIMITS,
  type BackendApplicationSpecV1,
  type DataFieldIR,
  type DataForeignKeyIR,
  type DataRelationIR
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import {
  BackendDraftOperationError,
  addDirectBackendRelation,
  addManyToManyBackendRelation,
  removeBackendRelation,
  replaceBackendRelation,
  setBackendRelationOnDelete
} from '../draft'
import { nestJSUICopy } from './nestjs-ui-copy'

const { application, nestjs = false } = defineProps<{
  application: BackendApplicationSpecV1
  nestjs?: boolean
}>()
const { panels, locale } = useI18n()
const nestJSText = computed(() => nestJSUICopy(locale.value))
const operationError = ref('')
const kind = ref<DataRelationIR['kind']>('one-to-many')
const sourceEntityId = ref('')
const sourceFieldId = ref('')
const targetEntityId = ref('')
const targetFieldId = ref('')
const editingRelationId = ref('')

function entityName(entityId: string): string {
  return application.dataModel.entities.find((entity) => entity.id === entityId)?.name ?? entityId
}

function fieldsForEntity(entityId: string): DataFieldIR[] {
  return application.dataModel.entities.find((entity) => entity.id === entityId)?.fields ?? []
}

function targetKeyFields(entityId: string): DataFieldIR[] {
  const entity = application.dataModel.entities.find((candidate) => candidate.id === entityId)
  if (!entity) return []
  return entity.fields.filter(
    (field) =>
      entity.primaryKey?.fields.includes(field.id) ||
      entity.uniques?.some((entry) => entry.fields.length === 1 && entry.fields[0] === field.id)
  )
}

function syncBuilder(): void {
  const entities = application.dataModel.entities.filter(
    (entity) => entity.management === 'managed'
  )
  if (!entities.some((entity) => entity.id === sourceEntityId.value)) {
    sourceEntityId.value = entities[0]?.id ?? ''
  }
  if (
    !entities.some(
      (entity) => entity.id === targetEntityId.value && entity.id !== sourceEntityId.value
    )
  ) {
    targetEntityId.value = entities.find((entity) => entity.id !== sourceEntityId.value)?.id ?? ''
  }
  const sourceFields = fieldsForEntity(sourceEntityId.value)
  if (!sourceFields.some((field) => field.id === sourceFieldId.value)) {
    sourceFieldId.value = sourceFields[0]?.id ?? ''
  }
  const targetFields = targetKeyFields(targetEntityId.value)
  if (!targetFields.some((field) => field.id === targetFieldId.value)) {
    targetFieldId.value = targetFields[0]?.id ?? ''
  }
}

watch(
  () =>
    application.dataModel.entities
      .map((entity) => `${entity.id}:${entity.fields.map((field) => field.id).join(',')}`)
      .join('|'),
  syncBuilder,
  { immediate: true }
)
watch([sourceEntityId, targetEntityId], syncBuilder)

function createRelation(): void {
  operationError.value = ''
  try {
    if (editingRelationId.value) {
      replaceBackendRelation(
        application,
        editingRelationId.value,
        kind.value === 'many-to-many'
          ? {
              kind: 'many-to-many',
              sourceEntityId: sourceEntityId.value,
              targetEntityId: targetEntityId.value
            }
          : {
              kind: kind.value,
              sourceEntityId: sourceEntityId.value,
              sourceFieldId: sourceFieldId.value,
              targetEntityId: targetEntityId.value,
              targetFieldId: targetFieldId.value
            }
      )
      editingRelationId.value = ''
    } else if (kind.value === 'many-to-many') {
      addManyToManyBackendRelation(application, {
        sourceEntityId: sourceEntityId.value,
        targetEntityId: targetEntityId.value
      })
    } else {
      addDirectBackendRelation(application, {
        kind: kind.value,
        sourceEntityId: sourceEntityId.value,
        sourceFieldId: sourceFieldId.value,
        targetEntityId: targetEntityId.value,
        targetFieldId: targetFieldId.value
      })
    }
    syncBuilder()
  } catch (cause) {
    operationError.value =
      cause instanceof BackendDraftOperationError
        ? cause.message
        : panels.value.lowcodeBackendOperationError
  }
}

function removeRelation(relationId: string): void {
  operationError.value = ''
  try {
    removeBackendRelation(application, relationId)
    if (editingRelationId.value === relationId) editingRelationId.value = ''
    syncBuilder()
  } catch (cause) {
    operationError.value =
      cause instanceof BackendDraftOperationError
        ? cause.message
        : panels.value.lowcodeBackendOperationError
  }
}

function editRelation(relation: DataRelationIR): void {
  operationError.value = ''
  const foreignKey = relationForeignKey(relation)
  if (
    relation.kind !== 'many-to-many' &&
    (!foreignKey || foreignKey.fields.length !== 1 || foreignKey.targetFields.length !== 1)
  ) {
    operationError.value = 'Composite or detached relations cannot be edited by this builder.'
    return
  }
  editingRelationId.value = relation.id
  kind.value = relation.kind
  sourceEntityId.value = relation.sourceEntityId
  targetEntityId.value = relation.targetEntityId
  sourceFieldId.value = foreignKey?.fields[0] ?? ''
  targetFieldId.value = foreignKey?.targetFields[0] ?? ''
  syncBuilder()
}

function cancelEdit(): void {
  editingRelationId.value = ''
  syncBuilder()
}

function builderAtCapacity(): boolean {
  const current = application.dataModel.relations.find(
    (relation) => relation.id === editingRelationId.value
  )
  if (!current && application.dataModel.relations.length >= BACKEND_LIMITS.maxRelations) {
    return true
  }
  return (
    kind.value === 'many-to-many' &&
    current?.kind !== 'many-to-many' &&
    application.dataModel.entities.length >= BACKEND_LIMITS.maxEntities
  )
}

function relationForeignKey(relation: DataRelationIR): DataForeignKeyIR | undefined {
  const source = application.dataModel.entities.find(
    (entity) => entity.id === relation.sourceEntityId
  )
  return source?.foreignKeys?.find((foreignKey) => foreignKey.id === relation.sourceForeignKeyId)
}

function changeOnDelete(relation: DataRelationIR, onDelete: DataForeignKeyIR['onDelete']): void {
  operationError.value = ''
  try {
    setBackendRelationOnDelete(application, relation.id, onDelete)
  } catch (cause) {
    operationError.value =
      cause instanceof BackendDraftOperationError
        ? cause.message
        : panels.value.lowcodeBackendOperationError
  }
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-2" data-test-id="lowcode-backend-relations">
    <p v-if="nestjs" class="text-[10px] leading-relaxed text-muted">
      {{ nestJSText.relationHint }}
    </p>
    <div class="rounded border border-border bg-input/40 p-2">
      <div class="mb-1 flex items-center justify-between gap-2">
        <p class="text-[10px] text-muted">
          {{
            editingRelationId
              ? panels.lowcodeBackendRelationEditing
              : panels.lowcodeBackendRelationBuilder
          }}
        </p>
        <button
          v-if="editingRelationId"
          type="button"
          data-test-id="lowcode-backend-cancel-relation-edit"
          class="rounded px-1 text-[9px] text-muted hover:bg-hover"
          @click="cancelEdit"
        >
          {{ panels.cancel }}
        </button>
      </div>
      <select
        v-model="kind"
        class="mb-1 w-full rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface"
      >
        <option value="one-to-one">one-to-one</option>
        <option value="one-to-many">one-to-many</option>
        <option value="many-to-many" :disabled="nestjs">many-to-many</option>
      </select>
      <div class="grid grid-cols-2 gap-1">
        <select
          v-model="sourceEntityId"
          :aria-label="panels.lowcodeBackendRelationSource"
          class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
        >
          <option
            v-for="entity in application.dataModel.entities.filter(
              (item) => item.management === 'managed'
            )"
            :key="entity.id"
            :value="entity.id"
          >
            {{ entity.name }}
          </option>
        </select>
        <select
          v-model="targetEntityId"
          :aria-label="panels.lowcodeBackendRelationTarget"
          class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
        >
          <option
            v-for="entity in application.dataModel.entities.filter(
              (item) => item.management === 'managed' && item.id !== sourceEntityId
            )"
            :key="entity.id"
            :value="entity.id"
          >
            {{ entity.name }}
          </option>
        </select>
        <select
          v-if="kind !== 'many-to-many'"
          v-model="sourceFieldId"
          :aria-label="panels.lowcodeBackendRelationSourceField"
          class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
        >
          <option
            v-for="field in fieldsForEntity(sourceEntityId)"
            :key="field.id"
            :value="field.id"
          >
            {{ field.name }}
          </option>
        </select>
        <select
          v-if="kind !== 'many-to-many'"
          v-model="targetFieldId"
          :aria-label="panels.lowcodeBackendRelationTargetField"
          class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
        >
          <option
            v-for="field in targetKeyFields(targetEntityId)"
            :key="field.id"
            :value="field.id"
          >
            {{ field.name }}
          </option>
        </select>
      </div>
      <p class="mt-1 text-[9px] text-muted">
        {{
          kind === 'many-to-many'
            ? panels.lowcodeBackendRelationManyNote
            : panels.lowcodeBackendRelationDirectNote
        }}
      </p>
      <button
        type="button"
        data-test-id="lowcode-backend-add-relation"
        :disabled="!sourceEntityId || !targetEntityId || builderAtCapacity()"
        class="mt-1.5 rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
        @click="createRelation"
      >
        {{
          editingRelationId ? panels.lowcodeBackendRelationSave : panels.lowcodeBackendRelationAdd
        }}
      </button>
      <p v-if="operationError" class="mt-1 text-[10px] text-red-500">{{ operationError }}</p>
    </div>
    <p v-if="application.dataModel.relations.length === 0" class="text-[10px] text-muted">
      {{ panels.lowcodeBackendNoRelations }}
    </p>
    <div
      v-for="relation in application.dataModel.relations"
      :key="relation.id"
      data-test-id="lowcode-backend-relation"
      class="flex items-center gap-1 rounded border border-border px-2 py-1.5"
    >
      <span class="rounded bg-hover px-1 text-[9px] text-muted">{{ relation.kind }}</span
      ><span class="min-w-0 flex-1 truncate text-[10px] text-surface"
        >{{ entityName(relation.sourceEntityId) }} → {{ entityName(relation.targetEntityId) }}</span
      ><select
        v-if="relation.kind !== 'many-to-many' && relationForeignKey(relation)"
        :value="relationForeignKey(relation)?.onDelete"
        data-test-id="lowcode-backend-relation-on-delete"
        aria-label="onDelete"
        class="w-20 rounded border border-border bg-input px-1 py-0.5 text-[9px] text-surface"
        @change="
          changeOnDelete(
            relation,
            ($event.target as HTMLSelectElement).value as DataForeignKeyIR['onDelete']
          )
        "
      >
        <option value="restrict">restrict</option>
        <option
          v-if="!nestjs || relationForeignKey(relation)?.onDelete === 'cascade'"
          value="cascade"
          :disabled="nestjs"
        >
          cascade
        </option>
        <option
          v-if="!nestjs || relationForeignKey(relation)?.onDelete === 'set-null'"
          value="set-null"
          :disabled="nestjs"
        >
          set-null
        </option>
        <option value="no-action">no-action</option>
      </select>
      <button
        type="button"
        data-test-id="lowcode-backend-edit-relation"
        :aria-label="panels.lowcodeBackendRelationEdit"
        class="rounded px-1 text-[9px] text-muted hover:bg-hover hover:text-surface"
        @click="editRelation(relation)"
      >
        {{ panels.lowcodeBackendRelationEdit }}
      </button>
      <button
        type="button"
        :aria-label="panels.lowcodeBackendRemoveRelation"
        class="rounded px-1 text-muted hover:bg-hover hover:text-red-500"
        @click="removeRelation(relation.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>
