<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed, onScopeDispose, ref, watch } from 'vue'

import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialogRoot, AppDialogHeader, AppDialogFooter } from '@/components/ui/dialog'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import theme from '@/theme/backend-template-setup'

import {
  templateAuthentication,
  validTemplateAuthentication,
  type TemplateAuthenticationProfile
} from '../authentication'
import {
  isCommerceOperationsTemplate,
  type BackendLibraryItem,
  type BackendLibraryTemplateId
} from '../catalog'
import type { BackendLibraryBlockReason } from '../install'
import { backendLibraryViewCopy } from '../view-copy'
import { templateSetupCopy } from './copy'
import { templateSetupProviders, type TemplateSetupAction, type TemplateSetupPage } from './model'
import TemplateReadiness from './TemplateReadiness.vue'

const {
  items,
  documentIdentity,
  currentProviderKey,
  blockReason,
  busy,
  loading,
  error,
  hasDeclaration,
  savedProviderId,
  savedApplication,
  savedProviderAvailable,
  valid,
  unsaved,
  pages,
  desktop,
  createTemplate
} = defineProps<{
  items: readonly BackendLibraryItem[]
  documentIdentity: object
  currentProviderKey: string
  blockReason: BackendLibraryBlockReason
  busy: boolean
  loading: boolean
  error: string
  hasDeclaration: boolean
  savedProviderId: string
  savedApplication: BackendApplicationSpecV1 | null
  savedProviderAvailable: boolean
  valid: boolean
  unsaved: boolean
  pages: readonly TemplateSetupPage[]
  desktop: boolean
  createTemplate: (
    id: BackendLibraryTemplateId,
    authentication: BackendHttpAPIOIDCAuthenticationIRV1,
    providerKey: string,
    commissionBasisPoints: number
  ) => Promise<boolean>
}>()
const emit = defineEmits<{
  navigate: [action: TemplateSetupAction]
  openPage: [id: string]
}>()
const open = defineModel<boolean>('open', { required: true })
const { locale } = useI18n()
const styles = tv(theme)()
const copy = computed(() => templateSetupCopy(locale.value))
const libraryCopy = computed(() => backendLibraryViewCopy(locale.value))
const templates = computed(() => items.filter((item) => item.kind === 'template'))
const providers = computed(() => templateSetupProviders(items))
const selectedId = ref<BackendLibraryTemplateId>('personal-notes')
const providerKey = ref('')
const profile = ref<TemplateAuthenticationProfile>('local-keycloak')
const issuer = ref<string | number>('')
const clientId = ref<string | number>('')
const commission = ref<string | number>(0)
const step = ref(0)
const created = ref(false)
const pending = ref(false)
let disposed = false
onScopeDispose(() => {
  disposed = true
})

const selected = computed(() => templates.value.find((item) => item.id === selectedId.value))
const selectedProvider = computed(() =>
  providers.value.find((item) => item.descriptorKey === providerKey.value)
)
const authentication = computed(() =>
  templateAuthentication(profile.value, String(issuer.value), String(clientId.value))
)
const operations = computed(() => isCommerceOperationsTemplate(selectedId.value))
const commissionValid = computed(
  () =>
    !operations.value ||
    (String(commission.value).trim() !== '' &&
      Number.isInteger(Number(commission.value)) &&
      Number(commission.value) >= 0 &&
      Number(commission.value) <= 10000)
)
const connectionValid = computed(
  () =>
    !!selectedProvider.value &&
    validTemplateAuthentication(authentication.value) &&
    commissionValid.value
)
const blocked = computed(() => loading || busy || pending.value)
const reason = computed(() => {
  if (loading) return libraryCopy.value.loading
  if (blockReason) return libraryCopy.value.blocks[blockReason]
  if (!selectedProvider.value)
    return providers.value.length ? copy.value.changedProvider : copy.value.missingProvider
  if (!validTemplateAuthentication(authentication.value)) return libraryCopy.value.invalidAuth
  if (!commissionValid.value) return libraryCopy.value.invalidCommission
  return ''
})
const showReadiness = computed(() => hasDeclaration && savedProviderId === 'nestjs')

function reset(): void {
  step.value = 0
  created.value = false
  providerKey.value =
    providers.value.find((item) => item.descriptorKey === currentProviderKey)?.descriptorKey ??
    providers.value[0]?.descriptorKey ??
    ''
}
watch(
  () => documentIdentity,
  () => {
    open.value = false
    reset()
  }
)
watch(open, (value) => {
  if (value) reset()
})
// An opening registry load may provide the first choice; a reviewed provider is never silently replaced.
watch(providers, (value) => {
  if (open.value && step.value === 0 && !providerKey.value)
    providerKey.value = value[0]?.descriptorKey ?? ''
})

function navigate(action: TemplateSetupAction): void {
  if (blocked.value) return
  open.value = false
  emit('navigate', action)
}
function openPage(id: string): void {
  if (blocked.value) return
  open.value = false
  emit('openPage', id)
}
function preventDuringOperation(event: Event): void {
  if (blocked.value) event.preventDefault()
}
async function create(): Promise<void> {
  if (step.value !== 2 || blocked.value || reason.value || !selected.value) return
  const document = documentIdentity
  pending.value = true
  try {
    const success = await createTemplate(
      selected.value.id,
      authentication.value,
      providerKey.value,
      operations.value ? Number(commission.value) : 0
    )
    if (!disposed && documentIdentity === document && success) created.value = true
  } finally {
    if (!disposed) pending.value = false
  }
}
</script>

<template>
  <AppDialogRoot
    v-model:open="open"
    size="lg"
    height="tall"
    @escape-key-down="preventDuringOperation"
    @interact-outside="preventDuringOperation"
  >
    <AppDialogHeader
      :heading="copy.title"
      :description="copy.description"
      :close-label="copy.close"
      :show-close="!blocked"
    />
    <div :class="styles.body()" :aria-busy="blocked">
      <AppAlert v-if="error" tone="error" :heading="copy.failure" :description="error" />
      <template v-if="hasDeclaration">
        <AppAlert :heading="created ? copy.created : copy.saved" :description="copy.existing" />
        <TemplateReadiness
          v-if="showReadiness"
          :application="savedApplication"
          :provider-available="savedProviderAvailable"
          :valid="valid"
          :unsaved="unsaved"
          :pages="pages"
          :desktop="desktop"
          :busy="blocked"
          @navigate="navigate"
          @open-page="openPage"
        />
        <AppAlert v-else :heading="copy.provider" :description="copy.unsupported">
          <template #actions
            ><AppButton variant="outline" @click="navigate('model')">{{
              copy.actions.model
            }}</AppButton></template
          >
        </AppAlert>
      </template>
      <template v-else>
        <ol :class="styles.steps()" :aria-label="copy.title">
          <li
            v-for="(label, index) in [copy.template, copy.connection, copy.review]"
            :key="label"
            :aria-current="step === index ? 'step' : undefined"
          >
            {{ label }}
          </li>
        </ol>
        <fieldset v-if="step === 0" :class="styles.fields()" :disabled="blocked">
          <legend :class="styles.legend()">{{ copy.template }}</legend>
          <label :class="styles.field()"
            >{{ libraryCopy.templates }}
            <select v-model="selectedId" :class="styles.select()">
              <option v-for="item in templates" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <template v-if="selected">
            <p :class="styles.paragraph()">{{ selected.description }}</p>
            <ul :class="styles.features()">
              <li v-for="feature in selected.features" :key="feature">{{ feature }}</li>
            </ul>
          </template>
        </fieldset>
        <fieldset v-else-if="step === 1" :class="styles.fields()" :disabled="blocked">
          <legend :class="styles.legend()">{{ copy.connection }}</legend>
          <label :class="styles.field()"
            >{{ copy.provider }}
            <select v-model="providerKey" :class="styles.select()">
              <option v-if="!selectedProvider" value="" disabled>{{ copy.missingProvider }}</option>
              <option
                v-for="provider in providers"
                :key="provider.id"
                :value="provider.descriptorKey"
              >
                {{ provider.name }}
              </option>
            </select>
          </label>
          <p :class="styles.paragraph()">{{ copy.providerHint }}</p>
          <label :class="styles.field()"
            >{{ libraryCopy.authProfile }}
            <select v-model="profile" :class="styles.select()">
              <option value="local-keycloak">{{ libraryCopy.localKeycloak }}</option>
              <option value="oidc">{{ libraryCopy.customOIDC }}</option>
            </select>
          </label>
          <p v-if="profile === 'local-keycloak'" :class="styles.paragraph()">
            {{ libraryCopy.localHint }}
          </p>
          <label :class="styles.field()"
            >{{ libraryCopy.issuer }}
            <AppInput
              v-if="profile === 'oidc'"
              v-model="issuer"
              maxlength="2048"
              spellcheck="false"
              :aria-label="libraryCopy.issuer"
            />
            <span v-else :class="styles.value()">{{ authentication.issuer }}</span>
          </label>
          <label :class="styles.field()"
            >{{ libraryCopy.clientId }}
            <AppInput
              v-if="profile === 'oidc'"
              v-model="clientId"
              maxlength="256"
              spellcheck="false"
              :aria-label="libraryCopy.clientId"
            />
            <span v-else :class="styles.value()">{{ authentication.clientId }}</span>
          </label>
          <label v-if="operations" :class="styles.field()"
            >{{ libraryCopy.commission }}
            <AppInput
              v-model="commission"
              type="number"
              :min="0"
              :max="10000"
              :step="1"
              :aria-label="libraryCopy.commission"
            />
            <span>{{ libraryCopy.commissionHint }}</span>
          </label>
          <AppAlert :heading="libraryCopy.publicAuth" :description="copy.publicOnly" />
        </fieldset>
        <section v-else-if="selected" :class="styles.section()" :aria-label="copy.review">
          <h3 :class="styles.heading()">{{ selected.name }}</h3>
          <dl :class="styles.definition()">
            <dt>{{ copy.provider }}</dt>
            <dd>{{ selectedProvider?.name }}</dd>
            <dt>{{ libraryCopy.issuer }}</dt>
            <dd>{{ authentication.issuer }}</dd>
            <dt>{{ libraryCopy.clientId }}</dt>
            <dd>{{ authentication.clientId }}</dd>
            <dt>{{ libraryCopy.pages }}</dt>
            <dd>{{ selected.pages.join(' · ') }}</dd>
            <dt>{{ copy.data }}</dt>
            <dd>{{ selected.entities.join(' · ') }}</dd>
          </dl>
          <h4 :class="styles.subheading()">{{ copy.roles }}</h4>
          <ul :class="styles.list()">
            <li v-for="role in selected.roles" :key="role">{{ role }}</li>
          </ul>
          <p :class="styles.paragraph()">{{ copy.rolesHint }}</p>
          <h4 :class="styles.subheading()">{{ libraryCopy.requirements }}</h4>
          <ul :class="styles.list()">
            <li v-for="requirement in selected.requirements" :key="requirement">
              {{ requirement }}
            </li>
          </ul>
          <AppAlert :heading="copy.review" :description="copy.createHint" />
        </section>
        <AppAlert v-if="reason" tone="warning" :heading="copy.missing" :description="reason">
          <template #actions>
            <AppButton
              v-if="blockReason === 'draft' || blockReason === 'read-error'"
              variant="outline"
              :disabled="blocked"
              @click="navigate('model')"
              >{{ copy.actions.model }}</AppButton
            >
            <AppButton
              v-else-if="!selectedProvider && step > 0"
              variant="outline"
              :disabled="blocked"
              @click="navigate('plugins')"
              >{{ copy.actions.plugins }}</AppButton
            >
          </template>
        </AppAlert>
      </template>
    </div>
    <AppDialogFooter v-if="!hasDeclaration">
      <AppButton v-if="step > 0" variant="outline" :disabled="blocked" @click="step--">{{
        copy.back
      }}</AppButton>
      <AppButton
        v-if="step < 2"
        color="primary"
        variant="solid"
        :disabled="blocked || !selected || (step === 1 && !connectionValid)"
        @click="step++"
        >{{ copy.next }}</AppButton
      >
      <AppButton
        v-else
        color="primary"
        variant="solid"
        :disabled="blocked || !!reason"
        :loading="pending"
        @click="create"
        >{{ copy.create }}</AppButton
      >
    </AppDialogFooter>
  </AppDialogRoot>
</template>
