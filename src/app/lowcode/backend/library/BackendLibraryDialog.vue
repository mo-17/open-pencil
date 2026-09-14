<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed, ref, useTemplateRef, watch } from 'vue'

import {
  isBackendOIDCIssuer,
  type BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialogRoot, AppDialogHeader, AppDialogFooter } from '@/components/ui/dialog'
import AppBadge from '@/components/ui/feedback/AppBadge.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'
import theme from '@/theme/backend-library'

import type { BusinessModuleReview } from '../business/installation/types'
import type { BusinessTemplateId } from '../business/model/types'
import {
  filterBackendLibraryCatalog,
  isBusinessTemplate,
  isCommerceOperationsTemplate,
  type BackendLibraryItem,
  type BackendLibraryTemplateId
} from './catalog'
import { backendLibraryViewCopy } from './view-copy'

const {
  items,
  currentProviderKey,
  templateProviderKey,
  blockReason,
  busy,
  loading,
  error,
  moduleReviews
} = defineProps<{
  items: readonly BackendLibraryItem[]
  currentProviderKey: string
  templateProviderKey: string
  blockReason: '' | 'busy' | 'document' | 'draft' | 'read-error'
  busy: boolean
  loading: boolean
  error: string
  moduleReviews?: readonly BusinessModuleReview[]
}>()
const emit = defineEmits<{
  selectProvider: [key: string]
  useTemplate: [
    id: BackendLibraryTemplateId,
    authentication: BackendHttpAPIOIDCAuthenticationIRV1,
    providerKey: string,
    commissionBasisPoints: number
  ]
  managePlugins: []
  addModule: [kind: BusinessTemplateId, reviewKey: string]
}>()
const open = defineModel<boolean>('open', { required: true })
const { locale } = useI18n()
const copy = computed(() => backendLibraryViewCopy(locale.value))
const styles = tv(theme)()
const query = ref<string | number>('')
const searchInput = useTemplateRef('searchInput')
const category = ref('all')
const selectedId = ref('personal-notes')
const reviewedProviderKey = ref('')
const reviewedModuleKey = ref('')
const authProfile = ref('local-keycloak')
const issuer = ref<string | number>('')
const clientId = ref<string | number>('')
const commission = ref<string | number>(0)
const operationsSelected = computed(() => isCommerceOperationsTemplate(selectedId.value))
const validCommission = computed(
  () =>
    !operationsSelected.value ||
    (String(commission.value).trim() !== '' &&
      Number.isInteger(Number(commission.value)) &&
      Number(commission.value) >= 0 &&
      Number(commission.value) <= 10000)
)
const categories = computed(() => [
  { value: 'all', label: copy.value.all },
  { value: 'providers', label: copy.value.providers },
  { value: 'templates', label: copy.value.templates }
])
const visibleItems = computed(() =>
  filterBackendLibraryCatalog(items, {
    category:
      category.value === 'providers' || category.value === 'templates' ? category.value : 'all',
    query: String(query.value)
  })
)
const selected = computed(() => visibleItems.value.find((item) => item.id === selectedId.value))
const selectedModuleReview = computed(() =>
  moduleReviews?.find((review) => review.kind === selectedId.value)
)
const moduleMode = computed(
  () => selected.value?.kind === 'template' && !!selectedModuleReview.value
)
const staleModule = computed(
  () => moduleMode.value && reviewedModuleKey.value !== selectedModuleReview.value?.reviewKey
)
const selectedProvider = computed(() =>
  selected.value?.kind === 'provider'
    ? selected.value
    : items.find(
        (item) =>
          item.kind === 'provider' &&
          item.descriptorKey === (moduleMode.value ? currentProviderKey : templateProviderKey)
      )
)
const authentication = computed<BackendHttpAPIOIDCAuthenticationIRV1>(() => ({
  kind: 'oidc-pkce',
  issuer:
    authProfile.value === 'local-keycloak'
      ? 'http://127.0.0.1:18080/realms/openpencil'
      : String(issuer.value).trim(),
  clientId:
    authProfile.value === 'local-keycloak' ? 'notes-public-client' : String(clientId.value).trim(),
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}))
const validAuth = computed(
  () =>
    isBackendOIDCIssuer(authentication.value.issuer) &&
    /^[\x21-\x7e]{1,256}$/u.test(authentication.value.clientId)
)
const unavailable = computed(() => {
  if (moduleMode.value) return false
  const item = selected.value
  return item?.kind === 'provider' ? !item.descriptorKey : !templateProviderKey
})
const stale = computed(
  () => selected.value?.kind === 'template' && reviewedProviderKey.value !== templateProviderKey
)
const disabledReason = computed(() => {
  if (loading) return copy.value.loading
  if (busy) return copy.value.blocks.busy
  if (unavailable.value) return copy.value.managementHint
  if (selected.value?.kind === 'provider') return copy.value.providerHint
  if (moduleMode.value) {
    if (staleModule.value) return copy.value.staleModule
    if (selectedModuleReview.value?.status === 'installed') return copy.value.moduleInstalled
    return selectedModuleReview.value?.summary ?? copy.value.moduleHint
  }
  if (blockReason) return copy.value.blocks[blockReason]
  if (stale.value) return copy.value.staleProvider
  if (!validAuth.value) return copy.value.invalidAuth
  if (!validCommission.value) return copy.value.invalidCommission
  return copy.value.createHint
})
const canApply = computed(() => {
  if (!selected.value || loading || busy || unavailable.value) return false
  if (selected.value.kind === 'provider') return selected.value.descriptorKey !== currentProviderKey
  if (moduleMode.value) return selectedModuleReview.value?.status === 'ready' && !staleModule.value
  return !blockReason && !stale.value && validAuth.value && validCommission.value
})

function select(item: BackendLibraryItem): void {
  selectedId.value = item.id
  reviewedProviderKey.value = templateProviderKey
  reviewedModuleKey.value =
    moduleReviews?.find((review) => review.kind === item.id)?.reviewKey ?? ''
}
function clearSearch(): void {
  query.value = ''
  category.value = 'all'
}
watch(open, (value) => {
  if (value) {
    reviewedProviderKey.value = templateProviderKey
    reviewedModuleKey.value = selectedModuleReview.value?.reviewKey ?? ''
  }
})
function apply(): void {
  const item = selected.value
  if (!item || !canApply.value) return
  if (moduleMode.value && item.kind === 'template' && isBusinessTemplate(item.id)) {
    emit('addModule', item.id, reviewedModuleKey.value)
    return
  }
  if (item.kind === 'provider') {
    if (item.descriptorKey) emit('selectProvider', item.descriptorKey)
  } else
    emit(
      'useTemplate',
      item.id,
      authentication.value,
      reviewedProviderKey.value,
      operationsSelected.value ? Number(commission.value) : 0
    )
}
function focusSearch(event: Event): void {
  event.preventDefault()
  searchInput.value?.focus()
}
function preventDuringOperation(event: Event): void {
  if (busy) event.preventDefault()
}
</script>

<template>
  <AppDialogRoot
    v-model:open="open"
    size="xl"
    height="tall"
    @open-auto-focus="focusSearch"
    @escape-key-down="preventDuringOperation"
    @interact-outside="preventDuringOperation"
  >
    <AppDialogHeader
      :heading="copy.title"
      :description="copy.description"
      :close-label="copy.close"
      :show-close="!busy"
    />
    <div :class="styles.toolbar()">
      <AppInput
        v-model="query"
        ref="searchInput"
        type="search"
        :aria-label="copy.search"
        :placeholder="copy.search"
        maxlength="256"
        autofocus
      />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          v-model="category"
          :options="categories"
          :label="copy.category"
          :ui="{ item: styles.categoryItem() }"
        />
        <span class="text-[10px] text-muted" role="status"
          >{{ visibleItems.length }} / {{ items.length }}</span
        >
      </div>
    </div>
    <div :class="styles.body()" :aria-busy="busy || loading">
      <div :class="styles.list()">
        <p v-if="loading" role="status" :class="styles.paragraph()">{{ copy.loading }}</p>
        <div v-if="!visibleItems.length" :class="styles.empty()">
          <icon-lucide-search-x class="size-7" />
          <p>{{ copy.noResults }}</p>
          <AppButton variant="outline" @click="clearSearch">{{ copy.clearSearch }}</AppButton>
        </div>
        <button
          v-for="item in visibleItems"
          :key="item.id"
          type="button"
          :aria-label="item.name"
          :aria-pressed="selected?.id === item.id"
          :data-selected="selected?.id === item.id"
          :disabled="busy"
          :class="styles.card()"
          @click="select(item)"
        >
          <div class="flex w-full items-start gap-3">
            <span :class="styles.icon()">
              <icon-lucide-database v-if="item.kind === 'provider'" class="size-5" />
              <icon-lucide-notebook-pen v-else-if="item.id === 'personal-notes'" class="size-5" />
              <icon-lucide-shopping-bag v-else class="size-5" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-semibold">{{ item.name }}</span>
                <AppBadge
                  v-if="item.kind === 'provider' && item.descriptorKey === currentProviderKey"
                  tone="success"
                  >{{ copy.current }}</AppBadge
                >
                <AppBadge
                  v-else-if="item.kind === 'provider' && !item.descriptorKey"
                  tone="warning"
                  >{{ copy.unavailable }}</AppBadge
                >
                <AppBadge
                  v-else-if="
                    moduleReviews?.some(
                      (review) => review.kind === item.id && review.status === 'installed'
                    )
                  "
                  tone="success"
                  >{{ copy.moduleInstalled }}</AppBadge
                >
                <AppBadge v-else tone="neutral">{{
                  item.kind === 'template' ? copy.builtIn : copy.available
                }}</AppBadge>
              </div>
              <p class="mt-1" :class="styles.paragraph()">{{ item.description }}</p>
            </div>
          </div>
          <div :class="styles.tags()">
            <span v-for="tag in item.tags" :key="tag" :class="styles.tag()">{{ tag }}</span>
          </div>
        </button>
      </div>
      <section :class="styles.detail()" :aria-label="selected?.name || copy.chooseDetails">
        <template v-if="selected">
          <div
            v-if="moduleMode && selectedModuleReview"
            data-testid="business-module-review"
            class="space-y-2 rounded-lg border border-border p-3"
          >
            <h4 :class="styles.heading()">{{ copy.moduleReview }}</h4>
            <p :class="styles.paragraph()">{{ selectedModuleReview.summary }}</p>
            <p :class="styles.paragraph()">
              {{ copy.addedPages }}: {{ selectedModuleReview.addedPages }}
            </p>
            <p v-if="selectedModuleReview.sharedPages.length" :class="styles.paragraph()">
              {{ copy.sharedPages }}: {{ selectedModuleReview.sharedPages.join(' · ') }}
            </p>
            <ul
              v-if="selectedModuleReview.conflicts.length"
              class="list-inside list-disc text-xs text-error"
            >
              <li v-for="conflict in selectedModuleReview.conflicts" :key="conflict">
                {{ conflict }}
              </li>
            </ul>
          </div>
          <div>
            <p class="mb-1 text-[10px] font-medium text-accent">{{ selected.providerId }}</p>
            <h3 class="text-lg font-semibold text-surface">{{ selected.name }}</h3>
            <p class="mt-2" :class="styles.paragraph()">{{ selected.description }}</p>
          </div>
          <details v-if="selectedProvider?.kind === 'provider' && selectedProvider.identity">
            <summary class="cursor-pointer text-xs text-muted">{{ copy.authority }}</summary>
            <p class="mt-2 text-xs font-medium text-surface">{{ selectedProvider.name }}</p>
            <p class="mt-1 break-all font-mono text-[10px] text-muted">
              {{ selectedProvider.identity }}
            </p>
          </details>
          <div v-if="selected.kind === 'template'" class="space-y-3">
            <div>
              <h4 :class="styles.heading()">{{ copy.mode }}</h4>
              <p class="mt-2" :class="styles.paragraph()">{{ selected.mode }}</p>
            </div>
            <div>
              <h4 :class="styles.heading()">{{ copy.roles }}</h4>
              <ul class="mt-2 space-y-1" :class="styles.paragraph()">
                <li v-for="role in selected.roles" :key="role">{{ role }}</li>
              </ul>
            </div>
          </div>
          <div>
            <h4 :class="styles.heading()">{{ copy.includes }}</h4>
            <ul class="mt-2 space-y-2 text-xs text-surface">
              <li
                v-for="feature in selected.features"
                :key="feature"
                class="flex items-start gap-2"
              >
                <icon-lucide-check class="mt-0.5 size-3 shrink-0 text-success" />{{ feature }}
              </li>
            </ul>
          </div>
          <div v-if="selected.kind === 'template'" class="space-y-3">
            <div>
              <h4 :class="styles.heading()">{{ copy.pages }}</h4>
              <div class="mt-2" :class="styles.tags()">
                <span v-for="page in selected.pages" :key="page" :class="styles.tag()">{{
                  page
                }}</span>
              </div>
            </div>
            <div>
              <h4 :class="styles.heading()">{{ copy.entities }}</h4>
              <div class="mt-2" :class="styles.tags()">
                <span v-for="entity in selected.entities" :key="entity" :class="styles.tag()">{{
                  entity
                }}</span>
              </div>
            </div>
          </div>
          <div>
            <h4 :class="styles.heading()">{{ copy.requirements }}</h4>
            <ul class="mt-2 list-inside list-disc space-y-1" :class="styles.paragraph()">
              <li v-for="requirement in selected.requirements" :key="requirement">
                {{ requirement }}
              </li>
            </ul>
          </div>
          <fieldset
            v-if="selected.kind === 'template' && !moduleMode"
            class="min-w-0 space-y-3 rounded-lg border border-border p-3"
            :disabled="busy"
          >
            <legend class="px-1 text-xs font-medium text-surface">{{ copy.authProfile }}</legend>
            <select v-model="authProfile" :aria-label="copy.authProfile" :class="styles.select()">
              <option value="local-keycloak">{{ copy.localKeycloak }}</option>
              <option value="oidc">{{ copy.customOIDC }}</option>
            </select>
            <p v-if="authProfile === 'local-keycloak'" :class="styles.paragraph()">
              {{ copy.localHint }}
            </p>
            <div class="space-y-1">
              <label class="text-[11px] text-muted">{{ copy.issuer }}</label>
              <AppInput
                v-if="authProfile === 'oidc'"
                v-model="issuer"
                :aria-label="copy.issuer"
                maxlength="2048"
                placeholder="https://identity.example.com/realms/app"
                spellcheck="false"
              />
              <p v-else class="break-all font-mono text-[10px] text-surface">
                {{ authentication.issuer }}
              </p>
            </div>
            <div class="space-y-1">
              <label class="text-[11px] text-muted">{{ copy.clientId }}</label>
              <AppInput
                v-if="authProfile === 'oidc'"
                v-model="clientId"
                :aria-label="copy.clientId"
                maxlength="256"
                spellcheck="false"
              />
              <p v-else class="break-all font-mono text-[10px] text-surface">
                {{ authentication.clientId }}
              </p>
            </div>
            <p :class="styles.paragraph()">{{ copy.publicAuth }}</p>
            <div v-if="operationsSelected" class="space-y-1">
              <label class="text-[11px] text-muted">{{ copy.commission }}</label>
              <AppInput
                v-model="commission"
                type="number"
                :aria-label="copy.commission"
                :min="0"
                :max="10000"
                :step="1"
              />
              <p :class="styles.paragraph()">{{ copy.commissionHint }}</p>
            </div>
          </fieldset>
        </template>
        <p v-else :class="styles.paragraph()">{{ copy.chooseDetails }}</p>
      </section>
    </div>
    <AppDialogFooter>
      <div :class="styles.footer()">
        <div class="min-w-0 flex-1">
          <p v-if="error" role="alert" class="text-xs text-error">{{ error }}</p>
          <p v-else-if="selected" :class="styles.paragraph()">{{ disabledReason }}</p>
        </div>
        <AppButton
          v-if="selected && unavailable"
          variant="outline"
          :disabled="busy || loading"
          @click="emit('managePlugins')"
          >{{ copy.managePlugins }}</AppButton
        >
        <AppButton
          v-else
          color="primary"
          variant="solid"
          size="lg"
          :disabled="!canApply"
          :loading="busy"
          @click="apply"
        >
          {{
            selected?.kind === 'provider'
              ? copy.selectProvider
              : moduleMode
                ? copy.addModule
                : copy.useTemplate
          }}
        </AppButton>
      </div>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
