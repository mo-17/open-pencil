import { shallowRef } from 'vue'

import { createMotionPresetLibraryStore } from './store'

export const appMotionPresetLibrary = createMotionPresetLibraryStore()
export const appMotionPresetLibrarySnapshot = shallowRef(appMotionPresetLibrary.snapshot())

appMotionPresetLibrary.subscribe((snapshot) => {
  appMotionPresetLibrarySnapshot.value = snapshot
})
