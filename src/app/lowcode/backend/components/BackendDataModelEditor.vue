<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  BACKEND_LIMITS,
  type BackendApplicationSpecV1,
  type BackendFieldDefault,
  type BackendLiteral,
  type DataEnumIR,
  type DataEntityIR,
  type DataFieldIR
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import {
  BackendDraftOperationError,
  addBackendEntity,
  addBackendEnum,
  addBackendEnumValue,
  addBackendField,
  removeBackendEntity,
  removeBackendEnum,
  removeBackendEnumValue,
  removeBackendField,
  setBackendFieldNullable,
  setBackendFieldPrimary,
  setBackendFieldType,
  setBackendFieldUnique
} from '../draft'
import {
  addNestJSEntity,
  addNestJSField,
  isNestJSServerField,
  removeNestJSFieldReferences,
  removeNestJSEntity
} from '../nestjs-draft'

const { application, nestjs = false } = defineProps<{
  application: BackendApplicationSpecV1
  nestjs?: boolean
}>()
const { panels, locale } = useI18n()
const operationError = ref('')
const newEntityModuleId = ref('')
const moduleLabel = computed(() =>
  locale.value.startsWith('zh') ? '新建数据表所属模块' : 'Module for the new table'
)
const allFieldTypes = Object.freeze([
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'uuid',
  'json',
  'bytes',
  'enum'
] as const satisfies readonly DataFieldIR['type'][])
const fieldTypes = computed(() =>
  nestjs
    ? allFieldTypes.filter((type) =>
        ['string', 'uuid', 'integer', 'number', 'boolean', 'date', 'datetime', 'enum'].includes(
          type
        )
      )
    : allFieldTypes
)
function addEntity(): void {
  run(() =>
    nestjs
      ? addNestJSEntity(application, 'table', newEntityModuleId.value)
      : addBackendEntity(application)
  )
}
function addField(entity: DataEntityIR): void {
  run(() => (nestjs ? addNestJSField(application, entity) : addBackendField(entity)))
}
function protectedField(entity: DataEntityIR, field: DataFieldIR): boolean {
  return nestjs && isNestJSServerField(application, entity, field.id)
}
type FieldDefaultChoice =
  | 'none'
  | 'literal'
  | Extract<BackendFieldDefault, { kind: 'generated' }>['generator']

function run(operation: () => void): void {
  operationError.value = ''
  try {
    operation()
  } catch (cause) {
    operationError.value =
      cause instanceof BackendDraftOperationError
        ? cause.message
        : panels.value.lowcodeBackendOperationError
  }
}

function removeEntity(entityId: string): void {
  run(() =>
    nestjs ? removeNestJSEntity(application, entityId) : removeBackendEntity(application, entityId)
  )
}

function removeEnum(enumId: string): void {
  run(() => removeBackendEnum(application, enumId))
}

function removeEnumValue(dataEnum: DataEnumIR, index: number): void {
  run(() => removeBackendEnumValue(application, dataEnum, index))
}

function changeManagement(entity: DataEntityIR, management: DataEntityIR['management']): void {
  run(() => {
    if (
      management === 'external' &&
      (entity.fields.length > 0 ||
        entity.primaryKey ||
        entity.foreignKeys?.length ||
        entity.uniques?.length ||
        entity.indexes?.length)
    ) {
      throw new BackendDraftOperationError(
        'Remove managed fields and constraints before changing an entity to external.'
      )
    }
    entity.management = management
  })
}

function removeField(entity: DataEntityIR, fieldId: string): void {
  run(() => {
    if (nestjs && isNestJSServerField(application, entity, fieldId))
      throw new BackendDraftOperationError(
        'Primary key and ownership fields are managed by NestJS.'
      )
    removeBackendField(application, entity.id, fieldId)
    if (nestjs) removeNestJSFieldReferences(application, entity.id, fieldId)
  })
}

function isPrimary(entity: DataEntityIR, fieldId: string): boolean {
  return entity.primaryKey?.fields.includes(fieldId) ?? false
}

function setPrimary(entity: DataEntityIR, fieldId: string, enabled: boolean): void {
  run(() => setBackendFieldPrimary(entity, fieldId, enabled))
}

function isUnique(entity: DataEntityIR, fieldId: string): boolean {
  return (
    entity.uniques?.some((entry) => entry.fields.length === 1 && entry.fields[0] === fieldId) ??
    false
  )
}

function setUnique(entity: DataEntityIR, fieldId: string, enabled: boolean): void {
  run(() => setBackendFieldUnique(entity, fieldId, enabled))
}

function changeType(entity: DataEntityIR, field: DataFieldIR, type: DataFieldIR['type']): void {
  run(() => setBackendFieldType(application, entity, field, type))
}

function changeNullable(entity: DataEntityIR, field: DataFieldIR, nullable: boolean): void {
  run(() => setBackendFieldNullable(entity, field, nullable))
}

function defaultChoice(field: DataFieldIR): FieldDefaultChoice {
  if (!field.default) return 'none'
  return field.default.kind === 'literal' ? 'literal' : field.default.generator
}

function defaultLiteral(field: DataFieldIR): BackendLiteral {
  if (field.type === 'integer' || field.type === 'number') return 0
  if (field.type === 'boolean') return false
  if (field.type === 'date') return '1970-01-01'
  if (field.type === 'datetime') return '1970-01-01T00:00:00Z'
  if (field.type === 'uuid') return crypto.randomUUID()
  if (field.type === 'enum') {
    return application.dataModel.enums.find((entry) => entry.id === field.enumId)?.values[0] ?? ''
  }
  return ''
}

function setDefault(field: DataFieldIR, choice: FieldDefaultChoice): void {
  if (choice === 'none') {
    delete field.default
    return
  }
  field.default =
    choice === 'literal'
      ? { kind: 'literal', value: defaultLiteral(field) }
      : { kind: 'generated', generator: choice }
}

function literalValue(field: DataFieldIR): string {
  if (field.default?.kind !== 'literal') return ''
  return field.default.value === null ? 'null' : String(field.default.value)
}

function updateLiteral(field: DataFieldIR, value: string): void {
  run(() => {
    let literal: BackendLiteral = value
    if (field.type === 'integer' || field.type === 'number') {
      const numeric = Number(value)
      if (
        !Number.isFinite(numeric) ||
        (field.type === 'integer' && !Number.isSafeInteger(numeric))
      ) {
        throw new BackendDraftOperationError('Enter a finite number matching the field type.')
      }
      literal = numeric
    }
    if (field.type === 'boolean') literal = value === 'true'
    if (value === 'null' && field.nullable) literal = null
    field.default = { kind: 'literal', value: literal }
  })
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-2" data-test-id="lowcode-backend-model">
    <div class="border-b border-border pb-2" data-test-id="lowcode-backend-enums">
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-muted">{{ panels.lowcodeBackendEnums }}</span>
        <button
          type="button"
          data-test-id="lowcode-backend-add-enum"
          :disabled="application.dataModel.enums.length >= BACKEND_LIMITS.maxEnums"
          class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="run(() => addBackendEnum(application))"
        >
          {{ panels.lowcodeBackendAddEnum }}
        </button>
      </div>
      <p v-if="application.dataModel.enums.length === 0" class="mt-1 text-[9px] text-muted">
        {{ panels.lowcodeBackendNoEnums }}
      </p>
      <div
        v-for="dataEnum in application.dataModel.enums"
        :key="dataEnum.id"
        data-test-id="lowcode-backend-enum"
        class="mt-1.5 rounded border border-border bg-input/40 p-1.5"
      >
        <div class="flex items-center gap-1">
          <input
            v-model="dataEnum.name"
            maxlength="63"
            :aria-label="panels.lowcodeBackendEnumName"
            data-test-id="lowcode-backend-enum-name"
            class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
          />
          <button
            type="button"
            :aria-label="panels.lowcodeBackendRemoveEnum"
            class="rounded px-1 text-muted hover:bg-hover hover:text-red-500"
            @click="removeEnum(dataEnum.id)"
          >
            ×
          </button>
        </div>
        <p class="mt-0.5 truncate font-mono text-[9px] text-muted">{{ dataEnum.id }}</p>
        <div
          v-for="(_, index) in dataEnum.values"
          :key="`${dataEnum.id}:${index}`"
          class="mt-1 flex items-center gap-1"
        >
          <input
            v-model="dataEnum.values[index]"
            maxlength="63"
            :aria-label="panels.lowcodeBackendEnumValue"
            data-test-id="lowcode-backend-enum-value"
            class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
          />
          <button
            type="button"
            :aria-label="panels.lowcodeBackendRemoveEnumValue"
            class="rounded px-1 text-muted hover:bg-hover hover:text-red-500"
            @click="removeEnumValue(dataEnum, index)"
          >
            ×
          </button>
        </div>
        <button
          type="button"
          data-test-id="lowcode-backend-add-enum-value"
          :disabled="dataEnum.values.length >= BACKEND_LIMITS.maxEnumValues"
          class="mt-1 rounded px-1 text-[9px] text-muted hover:bg-hover hover:text-surface"
          @click="run(() => addBackendEnumValue(dataEnum))"
        >
          {{ panels.lowcodeBackendAddEnumValue }}
        </button>
      </div>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-[10px] text-muted">{{ panels.lowcodeBackendTabModel }}</span>
      <button
        type="button"
        data-test-id="lowcode-backend-add-entity"
        :disabled="
          application.dataModel.entities.length >= BACKEND_LIMITS.maxEntities ||
          Boolean(
            application.modules &&
            !application.modules.modules.some((module) => module.id === newEntityModuleId)
          )
        "
        class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
        @click="addEntity"
      >
        {{ panels.lowcodeBackendAddEntity }}
      </button>
    </div>
    <label v-if="application.modules" class="flex flex-col gap-1 text-[10px] text-muted">
      {{ moduleLabel }}
      <select
        v-model="newEntityModuleId"
        :aria-label="moduleLabel"
        data-test-id="lowcode-backend-new-entity-module"
        class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
      >
        <option value="" disabled>{{ moduleLabel }}</option>
        <option v-for="module in application.modules.modules" :key="module.id" :value="module.id">
          {{ module.name }}
        </option>
      </select>
    </label>
    <p v-if="application.dataModel.entities.length === 0" class="text-[10px] text-muted">
      {{ panels.lowcodeBackendNoEntities }}
    </p>
    <div
      v-for="entity in application.dataModel.entities"
      :key="entity.id"
      data-test-id="lowcode-backend-entity"
      class="rounded border border-border bg-input/40 p-2"
    >
      <div class="flex items-center gap-1">
        <input
          v-model="entity.name"
          maxlength="63"
          :aria-label="panels.lowcodeBackendEntityName"
          data-test-id="lowcode-backend-entity-name"
          class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
        />
        <select
          v-if="!nestjs"
          :value="entity.management"
          :aria-label="panels.lowcodeBackendManagement"
          class="rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          @change="
            changeManagement(
              entity,
              ($event.target as HTMLSelectElement).value as DataEntityIR['management']
            )
          "
        >
          <option value="managed">{{ panels.lowcodeBackendManaged }}</option>
          <option value="external">{{ panels.lowcodeBackendExternal }}</option>
        </select>
        <button
          type="button"
          :aria-label="panels.lowcodeBackendRemoveEntity"
          class="rounded px-1 text-muted hover:bg-hover hover:text-red-500"
          @click="removeEntity(entity.id)"
        >
          ×
        </button>
      </div>
      <p class="mt-0.5 truncate font-mono text-[9px] text-muted">{{ entity.id }}</p>
      <div v-if="entity.management === 'managed'" class="mt-1.5 flex flex-col gap-1.5">
        <div
          v-for="field in entity.fields"
          :key="field.id"
          data-test-id="lowcode-backend-field"
          class="rounded border border-border/70 p-1.5"
        >
          <div class="flex items-center gap-1">
            <input
              v-model="field.name"
              maxlength="63"
              :aria-label="panels.lowcodeBackendFieldName"
              data-test-id="lowcode-backend-field-name"
              class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
            />
            <select
              :disabled="protectedField(entity, field)"
              :value="field.type"
              :aria-label="panels.lowcodeBackendFieldType"
              class="w-20 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
              @change="
                changeType(
                  entity,
                  field,
                  ($event.target as HTMLSelectElement).value as DataFieldIR['type']
                )
              "
            >
              <option
                v-for="type in fieldTypes"
                :key="type"
                :value="type"
                :disabled="type === 'enum' && application.dataModel.enums.length === 0"
              >
                {{ type }}
              </option>
            </select>
            <button
              type="button"
              :disabled="protectedField(entity, field)"
              :aria-label="panels.lowcodeBackendRemoveField"
              class="rounded px-1 text-muted hover:bg-hover hover:text-red-500"
              @click="removeField(entity, field.id)"
            >
              ×
            </button>
          </div>
          <select
            v-if="field.type === 'enum'"
            v-model="field.enumId"
            class="mt-1 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          >
            <option value="">enum…</option>
            <option v-for="item in application.dataModel.enums" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
          <div class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-muted">
            <label class="flex items-center gap-1"
              ><input
                type="checkbox"
                :disabled="protectedField(entity, field)"
                :checked="field.nullable"
                @change="changeNullable(entity, field, ($event.target as HTMLInputElement).checked)"
              />{{ panels.lowcodeBackendNullable }}</label
            >
            <label class="flex items-center gap-1"
              ><input
                type="checkbox"
                :disabled="nestjs"
                :checked="isPrimary(entity, field.id)"
                @change="setPrimary(entity, field.id, ($event.target as HTMLInputElement).checked)"
              />{{ panels.lowcodeBackendPrimaryKey }}</label
            >
            <label class="flex items-center gap-1"
              ><input
                type="checkbox"
                :disabled="nestjs"
                :checked="isUnique(entity, field.id)"
                @change="setUnique(entity, field.id, ($event.target as HTMLInputElement).checked)"
              />{{ panels.lowcodeBackendUnique }}</label
            >
          </div>
          <div class="mt-1 flex items-center gap-1">
            <select
              :disabled="protectedField(entity, field)"
              :value="defaultChoice(field)"
              :aria-label="panels.lowcodeBackendFieldDefault"
              class="min-w-0 flex-1 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
              @change="
                setDefault(field, ($event.target as HTMLSelectElement).value as FieldDefaultChoice)
              "
            >
              <option value="none">{{ panels.lowcodeBackendDefaultNone }}</option>
              <option value="literal">{{ panels.lowcodeBackendDefaultLiteral }}</option>
              <option
                v-if="field.type === 'uuid' && (!nestjs || isPrimary(entity, field.id))"
                value="uuid"
              >
                {{ panels.lowcodeBackendDefaultUuid }}
              </option>
              <option v-if="!nestjs && field.type === 'integer'" value="identity">
                {{ panels.lowcodeBackendDefaultIdentity }}
              </option>
              <option v-if="field.type === 'datetime'" value="created-at">
                {{ panels.lowcodeBackendDefaultCreatedAt }}
              </option>
              <option v-if="!nestjs && field.type === 'datetime'" value="updated-at">
                {{ panels.lowcodeBackendDefaultUpdatedAt }}
              </option>
            </select>
            <select
              v-if="field.default?.kind === 'literal' && field.type === 'enum'"
              :value="literalValue(field)"
              class="min-w-0 flex-1 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
              @change="updateLiteral(field, ($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="value in application.dataModel.enums.find(
                  (entry) => entry.id === field.enumId
                )?.values ?? []"
                :key="value"
                :value="value"
              >
                {{ value }}
              </option>
            </select>
            <select
              v-else-if="field.default?.kind === 'literal' && field.type === 'boolean'"
              :value="literalValue(field)"
              class="w-16 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
              @change="updateLiteral(field, ($event.target as HTMLSelectElement).value)"
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
            <input
              v-else-if="field.default?.kind === 'literal'"
              :value="literalValue(field)"
              maxlength="1024"
              :type="field.type === 'integer' || field.type === 'number' ? 'number' : 'text'"
              class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
              @change="updateLiteral(field, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <button
          type="button"
          data-test-id="lowcode-backend-add-field"
          :disabled="entity.fields.length >= BACKEND_LIMITS.maxFieldsPerEntity"
          class="self-start rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="addField(entity)"
        >
          {{ panels.lowcodeBackendAddField }}
        </button>
      </div>
    </div>
    <p v-if="operationError" class="text-[10px] text-red-500">{{ operationError }}</p>
  </div>
</template>
