<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  BACKEND_LIMITS,
  type AuthAccessOperation,
  type AuthOwnershipIR,
  type AuthPrincipalIntent,
  type AuthRoleIR,
  type AuthRowAccessIntentIR,
  type AuthTenantIR,
  type BackendApplicationSpecV1,
  type DataFieldIR
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import {
  BackendDraftOperationError,
  addBackendOwnership,
  addBackendRole,
  addBackendRowAccess,
  addBackendTenant,
  removeBackendOwnership,
  removeBackendRole,
  removeBackendTenant,
  setBackendOwnershipEntity,
  setBackendOwnershipField,
  setBackendRowAccessEntity,
  setBackendTenantEntity,
  setBackendTenantField,
  setBackendTenantMembershipEntity,
  setBackendTenantMembershipField
} from '../draft'
import { nestJSUICopy } from './nestjs-ui-copy'

const { application, nestjs = false } = defineProps<{
  application: BackendApplicationSpecV1
  nestjs?: boolean
}>()
const { panels, locale } = useI18n()
const nestJSText = computed(() => nestJSUICopy(locale.value))
const operationError = ref('')
const operations = Object.freeze([
  'select',
  'insert',
  'update',
  'delete'
] as const satisfies readonly AuthAccessOperation[])
const entityOptions = computed(() =>
  application.dataModel.entities.filter(
    (entity) => entity.management === 'managed' && entity.fields.length > 0
  )
)
const ownershipCandidate = computed(() =>
  entityOptions.value
    .flatMap((entity) => entity.fields.map((field) => ({ entity, field })))
    .find(
      ({ entity, field }) =>
        !application.auth.ownership.some(
          (entry) => entry.entityId === entity.id && entry.identityFieldId === field.id
        )
    )
)
const tenantCandidate = computed(() =>
  entityOptions.value
    .flatMap((entity) => entity.fields.map((field) => ({ entity, field })))
    .find(
      ({ entity, field }) =>
        !application.auth.tenants.some(
          (entry) => entry.entityId === entity.id && entry.tenantFieldId === field.id
        )
    )
)

function fieldsForEntity(entityId: string): DataFieldIR[] {
  return application.dataModel.entities.find((entity) => entity.id === entityId)?.fields ?? []
}

function entityName(entityId: string): string {
  return application.dataModel.entities.find((entity) => entity.id === entityId)?.name ?? entityId
}

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

function addOwnership(): void {
  const candidate = ownershipCandidate.value
  if (candidate) {
    run(() => addBackendOwnership(application, candidate.entity.id, candidate.field.id))
  }
}

function removeRole(role: AuthRoleIR): void {
  run(() => removeBackendRole(application, role.id))
}

function changeOwnershipEntity(rule: AuthOwnershipIR, entityId: string): void {
  run(() => setBackendOwnershipEntity(application, rule, entityId))
}

function changeOwnershipField(rule: AuthOwnershipIR, fieldId: string): void {
  run(() => setBackendOwnershipField(application, rule, fieldId))
}

function removeOwnership(rule: AuthOwnershipIR): void {
  run(() => removeBackendOwnership(application, rule.id))
}

function addTenant(): void {
  const candidate = tenantCandidate.value
  if (candidate) {
    run(() => addBackendTenant(application, candidate.entity.id, candidate.field.id))
  }
}

function membershipFields(rule: AuthTenantIR): DataFieldIR[] {
  return rule.membershipEntityId ? fieldsForEntity(rule.membershipEntityId) : []
}

function changeTenantEntity(rule: AuthTenantIR, entityId: string): void {
  run(() => setBackendTenantEntity(application, rule, entityId))
}

function changeTenantField(rule: AuthTenantIR, fieldId: string): void {
  run(() => setBackendTenantField(application, rule, fieldId))
}

function changeMembershipEntity(rule: AuthTenantIR, entityId: string): void {
  run(() => setBackendTenantMembershipEntity(application, rule, entityId || undefined))
}

function changeMembershipField(
  rule: AuthTenantIR,
  fieldKind: 'identity' | 'tenant',
  fieldId: string
): void {
  run(() => setBackendTenantMembershipField(application, rule, fieldKind, fieldId))
}

function removeTenant(rule: AuthTenantIR): void {
  run(() => removeBackendTenant(application, rule.id))
}

function addRowAccess(): void {
  const entity = entityOptions.value[0]
  if (entity) {
    const intent = addBackendRowAccess(application, entity.id)
    if (nestjs) setPrincipalKind(intent, 'owner')
  }
}

function removeById<T extends { id: string }>(entries: T[], id: string): void {
  const index = entries.findIndex((entry) => entry.id === id)
  if (index !== -1) entries.splice(index, 1)
}

function setPrincipalKind(intent: AuthRowAccessIntentIR, kind: AuthPrincipalIntent['kind']): void {
  if (nestjs && kind === 'anonymous') {
    intent.effect = 'allow'
    intent.operations = ['select']
  }
  if (kind === 'owner') {
    const rule = application.auth.ownership.find((entry) => entry.entityId === intent.entityId)
    intent.principal = rule ? { kind, ownershipId: rule.id } : { kind: 'authenticated' }
  } else if (kind === 'tenant-member') {
    const rule = application.auth.tenants.find((entry) => entry.entityId === intent.entityId)
    intent.principal = rule ? { kind, tenantId: rule.id } : { kind: 'authenticated' }
  } else if (kind === 'role') {
    const role = application.auth.roles[0]
    intent.principal = role ? { kind, roleId: role.id } : { kind: 'authenticated' }
  } else intent.principal = { kind }
}

function principalReference(intent: AuthRowAccessIntentIR): string {
  if (intent.principal.kind === 'owner') return intent.principal.ownershipId
  if (intent.principal.kind === 'tenant-member') return intent.principal.tenantId
  if (intent.principal.kind === 'role') return intent.principal.roleId
  return ''
}

function setPrincipalReference(intent: AuthRowAccessIntentIR, value: string): void {
  if (intent.principal.kind === 'owner') intent.principal = { kind: 'owner', ownershipId: value }
  if (intent.principal.kind === 'tenant-member') {
    intent.principal = { kind: 'tenant-member', tenantId: value }
  }
  if (intent.principal.kind === 'role') intent.principal = { kind: 'role', roleId: value }
}

function principalReferences(
  intent: AuthRowAccessIntentIR
): readonly { id: string; label: string }[] {
  if (intent.principal.kind === 'owner') {
    return application.auth.ownership
      .filter((entry) => entry.entityId === intent.entityId)
      .map((entry) => ({ id: entry.id, label: entityName(entry.entityId) }))
  }
  if (intent.principal.kind === 'tenant-member') {
    return application.auth.tenants
      .filter((entry) => entry.entityId === intent.entityId)
      .map((entry) => ({ id: entry.id, label: entityName(entry.entityId) }))
  }
  if (intent.principal.kind === 'role') {
    return application.auth.roles.map((entry) => ({ id: entry.id, label: entry.name }))
  }
  return []
}

function setOperation(
  intent: AuthRowAccessIntentIR,
  operation: AuthAccessOperation,
  enabled: boolean
): void {
  const selected = new Set(intent.operations)
  if (enabled) {
    selected.add(operation)
    if (operation === 'update') selected.add('select')
  } else selected.delete(operation)
  intent.operations = operations.filter((candidate) => selected.has(candidate))
}

function operationLocked(intent: AuthRowAccessIntentIR, operation: AuthAccessOperation): boolean {
  if (nestjs && intent.principal.kind === 'anonymous') return true
  if (!intent.operations.includes(operation)) return false
  if (intent.operations.length === 1) return true
  return operation === 'select' && intent.operations.includes('update')
}

function changeRowAccessEntity(intent: AuthRowAccessIntentIR, entityId: string): void {
  run(() => setBackendRowAccessEntity(application, intent, entityId))
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-2" data-test-id="lowcode-backend-security">
    <p v-if="nestjs" class="text-[10px] leading-relaxed text-muted">{{ nestJSText.accessHint }}</p>
    <div data-test-id="lowcode-backend-roles">
      <p v-if="nestjs" class="mb-2 text-[10px] leading-relaxed text-muted">
        {{ nestJSText.roleHint }}
      </p>
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-muted">{{ panels.lowcodeBackendRoles }}</span>
        <button
          type="button"
          data-test-id="lowcode-backend-add-role"
          :disabled="application.auth.roles.length >= 128"
          class="rounded px-1 text-[10px] text-muted hover:bg-hover"
          @click="run(() => addBackendRole(application))"
        >
          {{ panels.lowcodeBackendAddRole }}
        </button>
      </div>
      <p v-if="application.auth.roles.length === 0" class="mt-1 text-[9px] text-muted">
        {{ panels.lowcodeBackendNoRoles }}
      </p>
      <div
        v-for="role in application.auth.roles"
        :key="role.id"
        data-test-id="lowcode-backend-role"
        class="mt-1 flex flex-wrap items-center gap-1"
      >
        <input
          v-model="role.name"
          maxlength="63"
          :aria-label="panels.lowcodeBackendRoleName"
          data-test-id="lowcode-backend-role-name"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
        />
        <button
          type="button"
          :aria-label="panels.lowcodeBackendRemoveRole"
          class="px-1 text-muted hover:text-red-500"
          @click="removeRole(role)"
        >
          ×
        </button>
        <p v-if="nestjs" class="w-full select-text break-all font-mono text-[9px] text-muted">
          {{ nestJSText.roleId }}: {{ role.id }}
        </p>
      </div>
    </div>
    <div v-if="!nestjs" class="border-t border-border pt-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-muted">{{ panels.lowcodeBackendOwnership }}</span
        ><button
          type="button"
          :disabled="
            !ownershipCandidate || application.auth.ownership.length >= BACKEND_LIMITS.maxPolicies
          "
          class="rounded px-1 text-[10px] text-muted hover:bg-hover disabled:opacity-50"
          @click="addOwnership"
        >
          {{ panels.lowcodeBackendAddOwnership }}
        </button>
      </div>
      <p v-if="application.auth.ownership.length === 0" class="mt-1 text-[9px] text-muted">
        {{ panels.lowcodeBackendNoOwnership }}
      </p>
      <div
        v-for="rule in application.auth.ownership"
        :key="rule.id"
        class="mt-1 grid grid-cols-[1fr_1fr_auto] gap-1"
      >
        <select
          :value="rule.entityId"
          :aria-label="panels.lowcodeBackendEntity"
          class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          @change="changeOwnershipEntity(rule, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="entity in entityOptions" :key="entity.id" :value="entity.id">
            {{ entity.name }}
          </option></select
        ><select
          :value="rule.identityFieldId"
          :aria-label="panels.lowcodeBackendIdentityField"
          class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          @change="changeOwnershipField(rule, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="field in fieldsForEntity(rule.entityId)" :key="field.id" :value="field.id">
            {{ field.name }}
          </option></select
        ><button
          type="button"
          :aria-label="panels.lowcodeBackendRemoveRule"
          class="px-1 text-muted hover:text-red-500"
          @click="removeOwnership(rule)"
        >
          ×
        </button>
      </div>
    </div>
    <div v-if="!nestjs" class="border-t border-border pt-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-muted">{{ panels.lowcodeBackendTenant }}</span
        ><button
          type="button"
          :disabled="
            !tenantCandidate || application.auth.tenants.length >= BACKEND_LIMITS.maxPolicies
          "
          class="rounded px-1 text-[10px] text-muted hover:bg-hover disabled:opacity-50"
          @click="addTenant"
        >
          {{ panels.lowcodeBackendAddTenant }}
        </button>
      </div>
      <p v-if="application.auth.tenants.length === 0" class="mt-1 text-[9px] text-muted">
        {{ panels.lowcodeBackendNoTenant }}
      </p>
      <div
        v-for="rule in application.auth.tenants"
        :key="rule.id"
        data-test-id="lowcode-backend-tenant-rule"
        class="mt-1.5 rounded border border-border p-1.5"
      >
        <div class="grid grid-cols-[1fr_1fr_auto] gap-1">
          <select
            :value="rule.entityId"
            :aria-label="panels.lowcodeBackendEntity"
            data-test-id="lowcode-backend-tenant-entity"
            class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
            @change="changeTenantEntity(rule, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="entity in entityOptions" :key="entity.id" :value="entity.id">
              {{ entity.name }}
            </option></select
          ><select
            :value="rule.tenantFieldId"
            :aria-label="panels.lowcodeBackendTenantField"
            data-test-id="lowcode-backend-tenant-field"
            class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
            @change="changeTenantField(rule, ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="field in fieldsForEntity(rule.entityId)"
              :key="field.id"
              :value="field.id"
            >
              {{ field.name }}
            </option></select
          ><button
            type="button"
            :aria-label="panels.lowcodeBackendRemoveRule"
            class="px-1 text-muted hover:text-red-500"
            @click="removeTenant(rule)"
          >
            ×
          </button>
        </div>
        <div class="mt-1.5 border-t border-border/70 pt-1.5">
          <label class="block text-[9px] text-muted">
            <span class="mb-0.5 block">{{ panels.lowcodeBackendMembershipEntity }}</span>
            <select
              :value="rule.membershipEntityId ?? ''"
              data-test-id="lowcode-backend-membership-entity"
              class="w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
              @change="changeMembershipEntity(rule, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ panels.lowcodeBackendNoMembership }}</option>
              <option v-for="entity in entityOptions" :key="entity.id" :value="entity.id">
                {{ entity.name }}
              </option>
            </select>
          </label>
          <div v-if="rule.membershipEntityId" class="mt-1 grid grid-cols-2 gap-1">
            <label class="min-w-0 text-[9px] text-muted">
              <span class="mb-0.5 block">{{ panels.lowcodeBackendMembershipIdentityField }}</span>
              <select
                :value="rule.membershipIdentityFieldId"
                data-test-id="lowcode-backend-membership-identity-field"
                class="w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
                @change="
                  changeMembershipField(
                    rule,
                    'identity',
                    ($event.target as HTMLSelectElement).value
                  )
                "
              >
                <option v-for="field in membershipFields(rule)" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select>
            </label>
            <label class="min-w-0 text-[9px] text-muted">
              <span class="mb-0.5 block">{{ panels.lowcodeBackendMembershipTenantField }}</span>
              <select
                :value="rule.membershipTenantFieldId"
                data-test-id="lowcode-backend-membership-tenant-field"
                class="w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
                @change="
                  changeMembershipField(rule, 'tenant', ($event.target as HTMLSelectElement).value)
                "
              >
                <option v-for="field in membershipFields(rule)" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select>
            </label>
          </div>
          <p class="mt-1 text-[9px] leading-relaxed text-muted">
            {{ panels.lowcodeBackendMembershipHint }}
          </p>
        </div>
      </div>
      <p
        v-if="operationError"
        role="alert"
        data-test-id="lowcode-backend-security-operation-error"
        class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] text-red-500"
      >
        {{ operationError }}
      </p>
    </div>
    <div class="border-t border-border pt-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-muted">{{ panels.lowcodeBackendRls }}</span
        ><button
          type="button"
          :disabled="
            entityOptions.length === 0 ||
            application.auth.rowAccess.length >= BACKEND_LIMITS.maxPolicies
          "
          class="rounded px-1 text-[10px] text-muted hover:bg-hover disabled:opacity-50"
          @click="addRowAccess"
        >
          {{ panels.lowcodeBackendAddRls }}
        </button>
      </div>
      <p v-if="application.auth.rowAccess.length === 0" class="mt-1 text-[9px] text-muted">
        {{ panels.lowcodeBackendNoRls }}
      </p>
      <div
        v-for="intent in application.auth.rowAccess"
        :key="intent.id"
        data-test-id="lowcode-backend-rls-intent"
        class="mt-1.5 rounded border border-border p-1.5"
      >
        <div class="grid grid-cols-3 gap-1">
          <select
            :value="intent.entityId"
            :aria-label="panels.lowcodeBackendEntity"
            class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
            @change="changeRowAccessEntity(intent, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="entity in entityOptions" :key="entity.id" :value="entity.id">
              {{ entity.name }}
            </option></select
          ><select
            v-model="intent.effect"
            :aria-label="panels.lowcodeBackendEffect"
            class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          >
            <option value="allow">{{ panels.lowcodeBackendAllow }}</option>
            <option v-if="!nestjs || intent.effect === 'deny'" value="deny" :disabled="nestjs">
              {{ panels.lowcodeBackendDeny }}
            </option></select
          ><select
            :value="intent.principal.kind"
            :aria-label="panels.lowcodeBackendPrincipal"
            class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
            @change="
              setPrincipalKind(
                intent,
                ($event.target as HTMLSelectElement).value as AuthPrincipalIntent['kind']
              )
            "
          >
            <option value="anonymous">{{ panels.lowcodeBackendPrincipalAnonymous }}</option>
            <option
              v-if="!nestjs || intent.principal.kind === 'authenticated'"
              value="authenticated"
              :disabled="nestjs"
            >
              {{ panels.lowcodeBackendPrincipalAuthenticated }}
            </option>
            <option
              v-if="application.auth.ownership.some((rule) => rule.entityId === intent.entityId)"
              value="owner"
            >
              {{ panels.lowcodeBackendPrincipalOwner }}
            </option>
            <option
              v-if="
                !nestjs &&
                application.auth.tenants.some((rule) => rule.entityId === intent.entityId)
              "
              value="tenant-member"
            >
              {{ panels.lowcodeBackendPrincipalTenant }}
            </option>
            <option v-if="application.auth.roles.length" value="role">
              {{ panels.lowcodeBackendPrincipalRole }}
            </option>
          </select>
        </div>
        <select
          v-if="principalReferences(intent).length"
          :value="principalReference(intent)"
          class="mt-1 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          @change="setPrincipalReference(intent, ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="reference in principalReferences(intent)"
            :key="reference.id"
            :value="reference.id"
          >
            {{ reference.label }}
          </option>
        </select>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-muted">
          <label v-for="operation in operations" :key="operation" class="flex items-center gap-1"
            ><input
              type="checkbox"
              :checked="intent.operations.includes(operation)"
              :disabled="operationLocked(intent, operation)"
              @change="setOperation(intent, operation, ($event.target as HTMLInputElement).checked)"
            />{{ operation }}</label
          ><button
            type="button"
            :aria-label="panels.lowcodeBackendRemoveRule"
            class="ml-auto text-muted hover:text-red-500"
            @click="removeById(application.auth.rowAccess, intent.id)"
          >
            ×
          </button>
        </div>
      </div>
    </div>
    <p v-if="nestjs && operationError" role="alert" class="text-[10px] text-red-500">
      {{ operationError }}
    </p>
  </div>
</template>
