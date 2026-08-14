export type OpenPencilMicrofrontendFrameworkV1 = 'react' | 'vue'

export interface OpenPencilMicrofrontendAppV1 {
  id: string
  name: string
  version: string
  framework: OpenPencilMicrofrontendFrameworkV1
}

export interface OpenPencilMicrofrontendRuntimeAssetV1 {
  /** Root-relative or runtime-manifest-relative path. Never an arbitrary URL. */
  path: string
  mediaType: 'text/javascript' | 'text/css'
  byteLength: number
  /** Canonical unpadded base64url SHA-256 digest. */
  digest: string
}

export interface OpenPencilMicrofrontendRuntimeArtifactV1 {
  entry: OpenPencilMicrofrontendRuntimeAssetV1 & { mediaType: 'text/javascript' }
  styles: readonly (OpenPencilMicrofrontendRuntimeAssetV1 & { mediaType: 'text/css' })[]
}

export interface OpenPencilMicrofrontendRuntimeManifestV1 {
  format: 'openpencil-microfrontend'
  schemaVersion: 1
  abi: 'openpencil.microfrontend.v1'
  app: OpenPencilMicrofrontendAppV1
  artifact: OpenPencilMicrofrontendRuntimeArtifactV1
  routes: readonly string[]
}

export interface OpenPencilMicrofrontendLocalManifestCoordinateV1 {
  kind: 'local'
  /** Portable composition-manifest-relative path beginning with `./`. */
  path: string
}

export interface OpenPencilMicrofrontendRemoteManifestCoordinateV1 {
  kind: 'remote'
  url: string
  digest: string
  byteLength: number
}

export type OpenPencilMicrofrontendManifestCoordinateV1 =
  | OpenPencilMicrofrontendLocalManifestCoordinateV1
  | OpenPencilMicrofrontendRemoteManifestCoordinateV1

export interface OpenPencilMicrofrontendCompositionSlotV1 {
  id: string
}

export interface OpenPencilMicrofrontendCompositionAppV1 {
  appId: string
  manifest: OpenPencilMicrofrontendManifestCoordinateV1
  /** Static canonical root path used by the composition shell's longest-prefix router. */
  routeBase: string
  slotId: string
}

export interface OpenPencilMicrofrontendCompositionIdentityV1 {
  id: string
  name: string
  version: string
}

export interface OpenPencilMicrofrontendCompositionManifestV1 {
  format: 'openpencil-microfrontend-composition'
  schemaVersion: 1
  abi: 'openpencil.microfrontend.v1'
  composition: OpenPencilMicrofrontendCompositionIdentityV1
  slots: readonly OpenPencilMicrofrontendCompositionSlotV1[]
  apps: readonly OpenPencilMicrofrontendCompositionAppV1[]
}

export interface OpenPencilMicrofrontendLocationV1 {
  pathname: string
  search: string
  hash: string
}

export type OpenPencilMicrofrontendEventHandlerV1 = (payload: unknown) => void

export interface OpenPencilMicrofrontendEventBusV1 {
  publish(topic: string, payload: unknown): void
  subscribe(topic: string, handler: OpenPencilMicrofrontendEventHandlerV1): () => void
}

export interface OpenPencilMicrofrontendHostContextV1 {
  appId: string
  basePath: string
  /** Portal destination owned by the shell (for modals, menus, and other overlays). */
  portalTarget: HTMLElement
  location: OpenPencilMicrofrontendLocationV1
  navigate(to: string): void
  events: OpenPencilMicrofrontendEventBusV1
}

/** Direct same-realm ESM ABI implemented by every generated React/Vue runtime entry. */
export interface OpenPencilMicrofrontendRuntimeModuleV1 {
  bootstrap(): Promise<void>
  mount(container: HTMLElement, context: OpenPencilMicrofrontendHostContextV1): Promise<void>
  update(context: OpenPencilMicrofrontendHostContextV1): Promise<void>
  unmount(): Promise<void>
}
