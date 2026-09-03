import { onScopeDispose, readonly, ref, shallowReadonly, shallowRef } from 'vue'

import {
  BACKEND_LIMITS,
  validateStagedMigrationExecutionPlan,
  type StagedMigrationExecutionPlanV1
} from '@open-pencil/lowcode/backend'

export type SupabaseStagedMigrationPlanError = 'invalid-file' | 'invalid-plan' | 'plan-too-large'

const MAX_VISIBLE_FILE_NAME_LENGTH = 128
export const MAX_SUPABASE_STAGED_MIGRATION_PLAN_BYTES = BACKEND_LIMITS.maxCanonicalBytes

function selectedFile(event: Event): File | null {
  return (event.currentTarget as HTMLInputElement).files?.item(0) ?? null
}

export function useSupabaseStagedMigrationPlan(onChanged: () => void) {
  const input = ref<HTMLInputElement>()
  const plan = shallowRef<StagedMigrationExecutionPlanV1 | null>(null)
  const fileName = ref('')
  const error = ref<SupabaseStagedMigrationPlanError | null>(null)
  const busy = ref(false)
  let generation = 0

  function setInput(value: unknown): void {
    input.value = value instanceof HTMLInputElement ? value : undefined
  }

  function resetInput(): void {
    if (input.value) input.value.value = ''
  }

  function clear(): void {
    generation += 1
    plan.value = null
    fileName.value = ''
    error.value = null
    busy.value = false
    resetInput()
    onChanged()
  }

  async function select(event: Event): Promise<void> {
    const file = selectedFile(event)
    const currentGeneration = ++generation
    plan.value = null
    fileName.value = ''
    error.value = null
    onChanged()
    if (!file || !file.name.toLowerCase().endsWith('.json')) {
      error.value = 'invalid-file'
      resetInput()
      return
    }
    if (file.size > MAX_SUPABASE_STAGED_MIGRATION_PLAN_BYTES) {
      error.value = 'plan-too-large'
      resetInput()
      return
    }
    busy.value = true
    let text = ''
    try {
      text = await file.text()
      if (currentGeneration !== generation) return
      if (new TextEncoder().encode(text).byteLength > MAX_SUPABASE_STAGED_MIGRATION_PLAN_BYTES) {
        error.value = 'plan-too-large'
        return
      }
      let source: unknown
      try {
        source = JSON.parse(text)
      } catch {
        error.value = 'invalid-plan'
        return
      }
      const parsed = validateStagedMigrationExecutionPlan(source)
      source = undefined
      if (!parsed.ok) {
        error.value = 'invalid-plan'
        return
      }
      plan.value = parsed.value
      fileName.value = file.name.slice(0, MAX_VISIBLE_FILE_NAME_LENGTH)
    } finally {
      text = ''
      resetInput()
      if (currentGeneration === generation) busy.value = false
    }
  }

  onScopeDispose(() => {
    generation += 1
    plan.value = null
    resetInput()
  })

  return {
    busy: readonly(busy),
    clear,
    error: readonly(error),
    fileName: readonly(fileName),
    plan: shallowReadonly(plan),
    select,
    setInput
  }
}
