import { shallowRef } from 'vue'

import { createMotionRecipeLibraryStore } from './store'

export const appMotionRecipeLibrary = createMotionRecipeLibraryStore()
export const appMotionRecipeLibrarySnapshot = shallowRef(appMotionRecipeLibrary.snapshot())

appMotionRecipeLibrary.subscribe((snapshot) => {
  appMotionRecipeLibrarySnapshot.value = snapshot
})
