import { computed, ref, watch } from 'vue'

import type { MotionRecipe, MotionRecipeMergePolicy } from '@open-pencil/scene-graph'
import { useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  appMotionRecipeLibrary,
  appMotionRecipeLibrarySnapshot,
  applyMotionRecipeInstantiation,
  checkMotionRecipeMapping,
  chooseTauriMotionRecipeLibraryFile,
  createMotionRecipeFromNodes,
  defaultMotionRecipeRoleMapping,
  readBrowserMotionRecipeLibraryFile,
  saveMotionRecipeLibraryFile
} from '@/app/motion-recipes'

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function createRecipeId(): string {
  if (!('crypto' in globalThis) || typeof globalThis.crypto.randomUUID !== 'function') {
    throw new Error('Secure random identifiers are unavailable in this runtime.')
  }
  return `recipe-${globalThis.crypto.randomUUID()}`
}

export function useMotionRecipeLibrary() {
  const editor = useEditorStore()
  const { selectedIds } = useSelectionState()
  const selectedRecipeId = ref('')
  const createName = ref('')
  const createDescription = ref('')
  const roleMapping = ref<Record<string, string[]>>({})
  const parameters = ref<Record<string, number>>({})
  const importJson = ref('')
  const exportedJson = ref('')
  const localError = ref('')

  const recipes = computed(() => appMotionRecipeLibrarySnapshot.value.library.recipes)
  const blocked = computed(() => appMotionRecipeLibrarySnapshot.value.blocked)
  const selectedRecipe = computed(
    () => recipes.value.find((recipe) => recipe.id === selectedRecipeId.value) ?? null
  )
  const error = computed(
    () => localError.value || appMotionRecipeLibrarySnapshot.value.error?.message || ''
  )
  const compatibility = computed(() => {
    const recipe = selectedRecipe.value
    if (!recipe) {
      return { compatible: false, assignmentCount: 0, error: null, instance: null }
    }
    return checkMotionRecipeMapping(
      recipe,
      { roleMapping: roleMapping.value, parameters: parameters.value },
      [...selectedIds.value],
      (nodeId) => editor.graph.getNode(nodeId)
    )
  })

  function resetInstantiation(recipe: MotionRecipe | null): void {
    if (!recipe) {
      roleMapping.value = {}
      parameters.value = {}
      return
    }
    roleMapping.value = defaultMotionRecipeRoleMapping(recipe, [...selectedIds.value])
    parameters.value = Object.fromEntries(
      recipe.parameters.map((parameter) => [parameter.id, parameter.defaultValue])
    )
  }

  watch([selectedRecipe, () => [...selectedIds.value]], ([recipe]) => resetInstantiation(recipe), {
    immediate: true
  })

  function selectRecipe(id: string): void {
    selectedRecipeId.value = id
  }

  function createFromSelection(): void {
    try {
      const nodes = [...selectedIds.value].map((id) => {
        const node = editor.graph.getNode(id)
        if (!node) throw new Error(`Selected node no longer exists: ${id}`)
        return { id, name: node.name, motion: node.motion }
      })
      const recipe = createMotionRecipeFromNodes({
        id: createRecipeId(),
        name: createName.value,
        ...(createDescription.value.trim() ? { description: createDescription.value.trim() } : {}),
        nodes
      })
      appMotionRecipeLibrary.addRecipe(recipe)
      selectedRecipeId.value = recipe.id
      createName.value = ''
      createDescription.value = ''
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  function setRoleTargets(roleId: string, value: string): void {
    roleMapping.value = {
      ...roleMapping.value,
      [roleId]: [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      ]
    }
  }

  function setParameter(parameterId: string, value: number): void {
    parameters.value = { ...parameters.value, [parameterId]: value }
  }

  function checkedInstance() {
    const result = compatibility.value
    if (!result.compatible || !result.instance) {
      throw new Error(result.error ?? 'The Motion recipe mapping is incompatible.')
    }
    const missing = result.instance.assignments.filter(
      ({ nodeId }) => !editor.graph.getNode(nodeId)
    )
    if (missing.length > 0) {
      throw new Error(
        `Motion recipe target node(s) no longer exist: ${missing.map(({ nodeId }) => nodeId).join(', ')}`
      )
    }
    return result.instance
  }

  function preview(): void {
    try {
      const instance = checkedInstance()
      editor.stopMotionPreview()
      editor.previewMotionSpecs(
        instance.assignments.map(({ nodeId, motion }) => ({ nodeId, spec: motion })),
        {
          selection: { mode: 'all' },
          infiniteAsSingleCycle: true,
          holdFinalFrame: true
        }
      )
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  function apply(label: string): void {
    try {
      const instance = checkedInstance()
      editor.stopMotionPreview()
      applyMotionRecipeInstantiation(editor, instance, label)
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  function removeSelected(): void {
    if (!selectedRecipe.value) return
    try {
      appMotionRecipeLibrary.deleteRecipe(selectedRecipe.value.id)
      selectedRecipeId.value = ''
      editor.stopMotionPreview()
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  function importLibrary(policy: MotionRecipeMergePolicy): void {
    try {
      appMotionRecipeLibrary.importJson(importJson.value, policy)
      importJson.value = ''
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  function exportLibrary(): void {
    try {
      exportedJson.value = appMotionRecipeLibrary.exportJson()
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  async function importFile(
    file: File | undefined,
    policy: MotionRecipeMergePolicy
  ): Promise<void> {
    try {
      const json = file
        ? await readBrowserMotionRecipeLibraryFile(file)
        : await chooseTauriMotionRecipeLibraryFile()
      if (json === null) return
      appMotionRecipeLibrary.importJson(json, policy)
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  async function exportFile(): Promise<void> {
    try {
      await saveMotionRecipeLibraryFile(appMotionRecipeLibrary.exportJson())
      localError.value = ''
    } catch (cause) {
      localError.value = errorMessage(cause)
    }
  }

  return {
    recipes,
    blocked,
    error,
    selectedRecipeId,
    selectedRecipe,
    createName,
    createDescription,
    roleMapping,
    parameters,
    compatibility,
    importJson,
    exportedJson,
    selectRecipe,
    createFromSelection,
    setRoleTargets,
    setParameter,
    preview,
    stopPreview: () => editor.stopMotionPreview(),
    apply,
    removeSelected,
    importLibrary,
    exportLibrary,
    importFile,
    exportFile
  }
}
