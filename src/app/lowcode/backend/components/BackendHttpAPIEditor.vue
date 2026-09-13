<script setup lang="ts">
import { computed } from 'vue'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOperation,
  BackendHttpAPIResourceIRV1
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import { enableNestJSBrowserClient } from '../nestjs-draft'
import {
  allowsHTTPAPIQueryField,
  HTTP_API_QUERY_GROUPS,
  pruneHTTPAPIQuery,
  setHTTPAPIQueryField
} from '../http-api-query'
import { nestJSUICopy } from './nestjs-ui-copy'

const { application } = defineProps<{ application: BackendApplicationSpecV1 }>()
const { panels, locale } = useI18n()
const nestJSText = computed(() => nestJSUICopy(locale.value))
const operations: readonly BackendHttpAPIOperation[] = [
  'list',
  'read',
  'create',
  'update',
  'delete'
]
const projections = ['readFields', 'createFields', 'updateFields'] as const
function setOperation(
  resource: BackendHttpAPIResourceIRV1,
  operation: BackendHttpAPIOperation,
  checked: boolean
): void {
  resource.operations = checked
    ? [...new Set([...resource.operations, operation])]
    : resource.operations.filter((entry) => entry !== operation)
  pruneHTTPAPIQuery(resource)
  if (operation === 'list') {
    if (checked) resource.maxPageSize ??= 50
    else delete resource.maxPageSize
  }
}
function setProjection(
  resource: BackendHttpAPIResourceIRV1,
  key: (typeof projections)[number],
  field: string,
  checked: boolean
): void {
  resource[key] = checked
    ? [...new Set([...(resource[key] ?? []), field])]
    : (resource[key] ?? []).filter((entry) => entry !== field)
  if (key === 'readFields') pruneHTTPAPIQuery(resource)
}
function fields(resource: BackendHttpAPIResourceIRV1) {
  return (
    application.dataModel.entities.find((entity) => entity.id === resource.entityId)?.fields ?? []
  )
}
function serverField(resource: BackendHttpAPIResourceIRV1, id: string): boolean {
  const entity = application.dataModel.entities.find((entry) => entry.id === resource.entityId)
  return Boolean(
    entity?.primaryKey?.fields.includes(id) ||
    application.auth.ownership.some(
      (entry) => entry.entityId === resource.entityId && entry.identityFieldId === id
    )
  )
}
function setScopes(value: string): void {
  const authentication = application.httpApi?.browserClient?.authentication
  if (authentication) authentication.scopes = value.trim().split(/\s+/u).filter(Boolean)
}
</script>

<template>
  <div v-if="application.httpApi" class="mt-2 flex flex-col gap-2" data-property="backend-http-api">
    <p class="text-[10px] text-muted">{{ panels.lowcodeBackendHttpHint }}</p>
    <button
      v-if="!application.httpApi.browserClient"
      type="button"
      class="rounded border border-border px-2 py-1 text-xs text-surface"
      @click="enableNestJSBrowserClient(application)"
    >
      {{ panels.lowcodeBackendBrowserLogin }}
    </button>
    <fieldset
      v-if="application.httpApi.browserClient"
      class="m-0 flex min-w-0 flex-col gap-2 rounded border border-border p-2"
    >
      <legend class="text-xs text-surface">{{ panels.lowcodeBackendBrowserLogin }}</legend>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendIssuer }}
        <input
          v-model="application.httpApi.browserClient.authentication.issuer"
          maxlength="2048"
          placeholder="https://identity.example.com"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendClientId }}
        <input
          v-model="application.httpApi.browserClient.authentication.clientId"
          maxlength="256"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendScopes }}
        <input
          :value="application.httpApi.browserClient.authentication.scopes.join(' ')"
          maxlength="1024"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
          @change="setScopes(($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendResourceAudience }}
        <input
          :value="application.httpApi.browserClient.authentication.resource ?? ''"
          maxlength="2048"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
          @change="
            application.httpApi.browserClient.authentication.resource =
              ($event.target as HTMLInputElement).value || undefined
          "
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendApiBasePath }}
        <input
          v-model="application.httpApi.browserClient.apiBasePath"
          maxlength="128"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        />
      </label>
      <p class="break-all text-[10px] text-muted">
        {{ panels.lowcodeBackendCallback }}:
        {{ application.httpApi.browserClient.authentication.callbackPath }}
      </p>
      <p class="text-[10px] text-muted">{{ panels.lowcodeBackendPublicLoginHint }}</p>
    </fieldset>
    <fieldset class="m-0 min-w-0 rounded border border-border p-2">
      <legend class="text-xs text-surface">{{ panels.lowcodeBackendJWTAlgorithms }}</legend>
      <label
        v-for="algorithm in ['RS256', 'ES256'] as const"
        :key="algorithm"
        class="mr-3 text-xs text-muted"
      >
        <input
          type="checkbox"
          :checked="application.httpApi.authentication.algorithms.includes(algorithm)"
          @change="
            application.httpApi.authentication.algorithms = ($event.target as HTMLInputElement)
              .checked
              ? [...application.httpApi.authentication.algorithms, algorithm]
              : application.httpApi.authentication.algorithms.filter((entry) => entry !== algorithm)
          "
        />
        {{ algorithm }}
      </label>
    </fieldset>
    <fieldset
      v-for="resource in application.httpApi.resources"
      :key="resource.id"
      class="m-0 flex min-w-0 flex-col gap-2 rounded border border-border p-2"
    >
      <legend class="text-xs text-surface">{{ resource.id }}</legend>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendResourcePath }}
        <input
          v-model="resource.path"
          maxlength="128"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted"
        >{{ panels.lowcodeBackendPageSize }}
        <input
          v-model.number="resource.maxPageSize"
          type="number"
          min="1"
          max="100"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        />
      </label>
      <div class="flex flex-wrap gap-2">
        <label v-for="operation in operations" :key="operation" class="text-[10px] text-muted"
          ><input
            type="checkbox"
            :checked="resource.operations.includes(operation)"
            @change="setOperation(resource, operation, ($event.target as HTMLInputElement).checked)"
          />
          {{ operation }}</label
        >
      </div>
      <div v-for="projection in projections" :key="projection" class="flex flex-wrap gap-2">
        <span class="w-full text-[10px] text-muted">{{ projection }}</span>
        <label v-for="field in fields(resource)" :key="field.id" class="text-[10px] text-muted"
          ><input
            type="checkbox"
            :checked="resource[projection]?.includes(field.id)"
            :disabled="projection !== 'readFields' && serverField(resource, field.id)"
            @change="
              setProjection(
                resource,
                projection,
                field.id,
                ($event.target as HTMLInputElement).checked
              )
            "
          />
          {{ field.name }}</label
        >
      </div>
      <fieldset
        v-if="resource.operations.includes('list')"
        class="mt-2 min-w-0 space-y-3 rounded border border-border p-2"
      >
        <legend class="text-xs text-surface">{{ nestJSText.query }}</legend>
        <p class="text-[10px] leading-relaxed text-muted">{{ nestJSText.queryHint }}</p>
        <fieldset
          v-for="group in HTTP_API_QUERY_GROUPS"
          :key="group"
          class="flex min-w-0 flex-wrap gap-2"
        >
          <legend class="mb-1 text-[10px] text-surface">{{ nestJSText[group] }}</legend>
          <label
            v-for="field in fields(resource).filter((entry) =>
              resource.readFields.includes(entry.id)
            )"
            :key="field.id"
            class="text-[10px] text-muted"
          >
            <input
              type="checkbox"
              :checked="resource.query?.[group]?.includes(field.id) ?? false"
              :disabled="
                !allowsHTTPAPIQueryField(field, group) &&
                !resource.query?.[group]?.includes(field.id)
              "
              @change="
                setHTTPAPIQueryField(
                  resource,
                  group,
                  field,
                  ($event.target as HTMLInputElement).checked
                )
              "
            />
            {{ field.name }}
          </label>
        </fieldset>
      </fieldset>
    </fieldset>
  </div>
</template>
