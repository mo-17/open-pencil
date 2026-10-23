<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed } from 'vue'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppBadge from '@/components/ui/feedback/AppBadge.vue'
import theme from '@/theme/backend-template-setup'

import { templateSetupCopy } from './copy'
import { templateSetupReadiness, type TemplateSetupAction, type TemplateSetupPage } from './model'

const { application, providerAvailable, valid, unsaved, pages, desktop, busy } = defineProps<{
  application: BackendApplicationSpecV1 | null
  providerAvailable: boolean
  valid: boolean
  unsaved: boolean
  pages: readonly TemplateSetupPage[]
  desktop: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  navigate: [action: TemplateSetupAction]
  openPage: [id: string]
}>()
const { locale } = useI18n()
const styles = tv(theme)()
const copy = computed(() => templateSetupCopy(locale.value))
const checks = computed(() =>
  templateSetupReadiness({ application, providerAvailable, valid, unsaved, pages })
)
</script>

<template>
  <section
    :class="styles.readiness()"
    :aria-label="copy.readiness"
    data-property="template-readiness"
  >
    <h3 :class="styles.heading()">{{ copy.readiness }}</h3>
    <AppAlert :heading="copy.saved" :description="copy.localOnly" />
    <AppAlert v-if="unsaved" tone="warning" :heading="copy.missing" :description="copy.draft" />
    <ol :class="styles.checks()">
      <li
        v-for="check in checks"
        :key="check.id"
        :class="styles.check()"
        :data-condition="check.id"
        :data-state="check.state"
      >
        <div :class="styles.checkHeading()">
          <h4 :class="styles.subheading()">{{ copy.checks[check.id] }}</h4>
          <AppBadge :tone="check.state === 'configured' ? 'success' : 'warning'">{{
            copy[check.state]
          }}</AppBadge>
        </div>
        <AppButton
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="emit('navigate', check.action)"
        >
          {{ copy.actions[check.action] }}
        </AppButton>
      </li>
    </ol>
    <section :class="styles.detail()" :aria-label="copy.environment">
      <h4 :class="styles.subheading()">{{ copy.environment }}</h4>
      <ul :class="styles.requirements()">
        <li>{{ desktop ? copy.desktop : copy.browser }}</li>
        <li>{{ copy.database }}</li>
        <li>{{ copy.identity }}</li>
      </ul>
    </section>
    <section :class="styles.detail()" :aria-label="copy.count">
      <h4 :class="styles.subheading()">{{ copy.count }} · {{ pages.length }}</h4>
      <div :class="styles.pages()">
        <AppButton
          v-for="page in pages"
          :key="page.id"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="emit('openPage', page.id)"
        >
          {{ page.name }} · {{ page.lowcodeRoutePattern }}
        </AppButton>
      </div>
    </section>
  </section>
</template>
