import type { PLUGIN_RUNTIME_COMPUTE_ABI } from '@open-pencil/plugin-contracts'

export const PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION = 2 as const

export type PluginRuntimeWorkerLimits = Readonly<{
  maxArtifactBytes: number
  maxInputBytes: number
  maxOutputBytes: number
  maxMemoryPages: number
}>

export type PluginRuntimeWorkerRequest = Readonly<{
  version: typeof PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION
  type: 'execute-wasm'
  requestId: string
  abi: typeof PLUGIN_RUNTIME_COMPUTE_ABI
  limits: PluginRuntimeWorkerLimits
  wasmBytes: ArrayBuffer
  inputJson: string
}>

export type PluginRuntimeWorkerResponse =
  | Readonly<{
      version: typeof PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION
      type: 'result'
      requestId: string
      outputJson: string
    }>
  | Readonly<{
      version: typeof PLUGIN_RUNTIME_WORKER_PROTOCOL_VERSION
      type: 'error'
      requestId: string
      error: string
    }>
