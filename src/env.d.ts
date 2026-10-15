/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />
/// <reference types="unplugin-icons/types/vue" />

interface ImportMetaEnv {
  readonly VITE_COLLAB_STRATEGY?: string
  readonly VITE_COLLAB_APP_ID?: string
  readonly VITE_COLLAB_RELAY_URLS?: string
  readonly VITE_COLLAB_SUPABASE_URL?: string
  readonly VITE_COLLAB_SUPABASE_KEY?: string
  readonly VITE_COLLAB_TURN_URL?: string
  readonly VITE_COLLAB_TURN_USERNAME?: string
  readonly VITE_COLLAB_TURN_CREDENTIAL?: string
  readonly VITE_OPENPENCIL_PLUGIN_TRUST_CONFIG?: string
  readonly VITE_OPENPENCIL_MARKETPLACE_TRUST_CONFIG?: string
  readonly VITE_GOOGLE_DRIVE_CLIENT_ID?: string
  readonly VITE_ONEDRIVE_CLIENT_ID?: string
  readonly VITE_ALIYUN_DRIVE_CLIENT_ID?: string
  readonly VITE_BAIDU_NETDISK_APP_KEY?: string
  /** Enabled only in official release builds. */
  readonly VITE_OPENPENCIL_FEEDBACK?: string
}

declare const __OPENPENCIL_APP_VERSION__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: string | null
declare const __OPENPENCIL_PROJECT_ROOT__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_URL__: string
declare const __OPENPENCIL_LOCAL_AUTOMATION_HTTP_URL__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
