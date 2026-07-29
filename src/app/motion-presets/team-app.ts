import { shallowRef } from 'vue'

import { createTeamMotionLibraryStore } from './team-store'

export const appTeamMotionLibrary = createTeamMotionLibraryStore()
export const appTeamMotionLibrarySnapshot = shallowRef(appTeamMotionLibrary.snapshot())

appTeamMotionLibrary.subscribe((snapshot) => {
  appTeamMotionLibrarySnapshot.value = snapshot
})

void appTeamMotionLibrary.load()
