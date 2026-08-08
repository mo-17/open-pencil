import {
  isPlainJsonObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const HTML_PLUGIN_ID = 'open-pencil.html'
export const HTML_MODULE_TYPE = 'html'
export const HTML_MODULE_CONFIG_VERSION = 1
export const HTML_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 400 })
export const HTML_MODULE_LIMITS = Object.freeze({ html: 65_536 })

/** Shared fail-closed policy for every HTML-module srcdoc surface. */
export const HTML_MODULE_SANDBOX_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "form-action 'none'",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "style-src 'unsafe-inline'"
].join('; ')

export interface HtmlModuleConfigV1 extends JsonObject {
  html: string
}

export type HtmlModuleConfig = HtmlModuleConfigV1

const DEFAULT_HTML = `<article>
  <header>
    <h1>Editable HTML</h1>
    <p>Preview semantic HTML safely.</p>
  </header>
  <section aria-labelledby="html-details">
    <h2 id="html-details">About this block</h2>
    <p>Edit the HTML source in the properties panel.</p>
  </section>
</article>`

export const HTML_MODULE_DEFAULT_CONFIG: Readonly<HtmlModuleConfigV1> = Object.freeze({
  html: DEFAULT_HTML
})

type ParseResult = { ok: true; config: HtmlModuleConfigV1 } | { ok: false; reason: string }

function parseHtmlSource(value: unknown): string | null {
  return typeof value === 'string' && value.length <= HTML_MODULE_LIMITS.html ? value : null
}

function parseHtmlConfig(value: unknown): ParseResult {
  if (
    !isPlainJsonObject(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, 'html')
  ) {
    return { ok: false, reason: 'HTML config must contain exactly html' }
  }
  const html = parseHtmlSource(value.html)
  if (html === null) {
    return {
      ok: false,
      reason: `HTML config html must be a string of at most ${HTML_MODULE_LIMITS.html} characters`
    }
  }
  return { ok: true, config: { html } }
}

function mergeWithDefaults(config: unknown): unknown {
  if (config === undefined) return structuredClone(HTML_MODULE_DEFAULT_CONFIG)
  if (!isPlainJsonObject(config)) return config
  return { ...structuredClone(HTML_MODULE_DEFAULT_CONFIG), ...config }
}

export function createHtmlModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseHtmlConfig(mergeWithDefaults(config))
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: HTML_PLUGIN_ID,
    moduleType: HTML_MODULE_TYPE,
    configVersion: HTML_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createHtmlModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: '</> HTML',
    defaultSize: HTML_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createHtmlModuleInstance(config)
  })
}

export function resolveHtmlModule(value: unknown): ModuleResolution<HtmlModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== HTML_PLUGIN_ID ||
    instance.value.moduleType !== HTML_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== HTML_MODULE_CONFIG_VERSION) {
    return { ok: false, reason: `unsupported HTML config version ${instance.value.configVersion}` }
  }
  const config = parseHtmlConfig(instance.value.config)
  if (!config.ok) return config
  return { ok: true, instance: { ...instance.value, config: config.config }, config: config.config }
}

/** Build CSP-prefixed srcdoc markup; callers must also use an empty iframe sandbox. */
export function buildHtmlSandboxDocument(html: string): string {
  const source = parseHtmlSource(html)
  if (source === null) {
    throw new TypeError(
      `HTML source must be a string of at most ${HTML_MODULE_LIMITS.html} characters`
    )
  }
  const policy = HTML_MODULE_SANDBOX_CSP.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${source}`
}

const HTML_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['html'],
    kind: 'text',
    label: 'HTML',
    i18nLabelKey: 'lowcodeModuleFieldHtml'
  }
])

export const HTML_MODULE_DEFINITION: ModuleDefinition<HtmlModuleConfigV1> = Object.freeze({
  pluginId: HTML_PLUGIN_ID,
  moduleType: HTML_MODULE_TYPE,
  name: '</> HTML',
  description: 'Display bounded HTML in a script-free sandbox.',
  i18nNameKey: 'lowcodeModuleHtmlName',
  i18nDescriptionKey: 'lowcodeModuleHtmlDescription',
  configVersion: HTML_MODULE_CONFIG_VERSION,
  defaultSize: HTML_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(HTML_MODULE_DEFAULT_CONFIG),
  fields: HTML_MODULE_FIELDS,
  createInstance: createHtmlModuleInstance,
  createFrameOverrides: createHtmlModuleFrameOverrides,
  resolve: resolveHtmlModule
})

export const HTML_PLUGIN = Object.freeze({
  id: HTML_PLUGIN_ID,
  name: '</> HTML',
  version: '1.0.0',
  modules: Object.freeze([HTML_MODULE_DEFINITION])
})
