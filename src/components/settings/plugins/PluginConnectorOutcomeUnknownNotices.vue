<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { appConnectorOutcomeUnknownNotices } from '@/app/plugins/connectors/app'
import { pluginConnectorControlsCopy } from '@/app/plugins/connectors/settings-controls-model'

const { locale } = useI18n()
const copy = computed(() => pluginConnectorControlsCopy(locale.value))
const notices = shallowRef(appConnectorOutcomeUnknownNotices.snapshot())
const unsubscribe = appConnectorOutcomeUnknownNotices.subscribe((snapshot) => {
  notices.value = snapshot
})

onBeforeUnmount(unsubscribe)
</script>

<template>
  <section
    v-if="notices.length"
    class="rounded border border-warning/30 bg-warning/5 px-2.5 py-2 text-[10px] text-muted"
    role="alert"
    data-test-id="connector-outcome-unknown-notices"
  >
    <h4 class="font-medium text-warning">{{ copy.outcomeUnknownNoticesTitle }}</h4>
    <article
      v-for="notice in notices"
      :key="notice.id"
      class="mt-1.5 border-t border-warning/20 pt-1.5"
      :data-test-id="`connector-outcome-unknown-${notice.id}`"
    >
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p>{{ copy.executionOutcomeUnknown }}</p>
          <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-[9px]">
            <dt>{{ copy.outcomeUnknownPlugin }}</dt>
            <dd class="break-all">{{ notice.pluginId }}</dd>
            <dt>{{ copy.outcomeUnknownConnector }}</dt>
            <dd class="break-all">{{ notice.connectorId }}</dd>
            <dt>{{ copy.outcomeUnknownOperation }}</dt>
            <dd class="break-all">{{ notice.operationId }}</dd>
          </dl>
        </div>
        <button
          type="button"
          class="shrink-0 rounded border border-warning/30 px-2 py-1 text-[9px] text-surface hover:bg-warning/10"
          :data-test-id="`connector-outcome-unknown-dismiss-${notice.id}`"
          @click="appConnectorOutcomeUnknownNotices.dismiss(notice.id)"
        >
          {{ copy.dismiss }}
        </button>
      </div>
    </article>
  </section>
</template>
