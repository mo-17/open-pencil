import { tryOnScopeDispose } from '@vueuse/core'

import {
  APPLICATION_RUNTIME_GUIDE_MENU_ID,
  openApplicationRuntimeGuide
} from '@/app/help/application-runtime-guide'
import { isTauri } from '@/app/tauri/env'

export { APPLICATION_RUNTIME_GUIDE_MENU_ID, openApplicationRuntimeGuide }

/** Keep Help available even when the editor route (and its native menu listener) is not mounted. */
export function useApplicationRuntimeGuideMenu(): void {
  if (!isTauri()) return

  let disposed = false
  let unlisten: (() => void) | undefined

  void import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<string>('menu-event', (event) => {
        if (event.payload === APPLICATION_RUNTIME_GUIDE_MENU_ID) openApplicationRuntimeGuide()
      })
    )
    .then((stopListening) => {
      if (disposed) stopListening()
      else unlisten = stopListening
      return undefined
    })

  tryOnScopeDispose(() => {
    disposed = true
    unlisten?.()
  })
}
