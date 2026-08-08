/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />
/// <reference types="unplugin-icons/types/vue" />

// Phase 3 §4.3 — self-host collab signaling relays + TURN. Typed here so the
// VITE_COLLAB_* reads in src/app/collab/network-config.ts aren't `any`.
interface ImportMetaEnv {
  readonly VITE_COLLAB_STRATEGY?: string
  readonly VITE_COLLAB_APP_ID?: string
  readonly VITE_COLLAB_RELAY_URLS?: string
  readonly VITE_COLLAB_SUPABASE_URL?: string
  readonly VITE_COLLAB_SUPABASE_KEY?: string
  readonly VITE_COLLAB_TURN_URL?: string
  readonly VITE_COLLAB_TURN_USERNAME?: string
  readonly VITE_COLLAB_TURN_CREDENTIAL?: string
  /** Build-time, non-secret signed plugin catalog trust roots and publisher public keys. */
  readonly VITE_OPENPENCIL_PLUGIN_TRUST_CONFIG?: string
  /** Build-time root trust anchor for a signed Phase 3 marketplace snapshot. */
  readonly VITE_OPENPENCIL_MARKETPLACE_TRUST_CONFIG?: string
}

declare const __OPENPENCIL_APP_VERSION__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: string | null
declare const __OPENPENCIL_PROJECT_ROOT__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
