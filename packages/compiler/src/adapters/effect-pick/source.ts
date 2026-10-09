import type { IRNode } from '#compiler/ir/types'

import {
  EFFECT_PICK_CATALOG,
  EFFECT_PICK_PLUGIN_ID,
  EFFECT_PICK_MODULE_TYPE,
  type EffectPickCatalogEntry
} from '@open-pencil/core/plugins'

/** Collect every authored instance, including multiple effects sharing one module identity. */
export function collectEffectPickArtifacts(
  nodes: readonly IRNode[]
): readonly EffectPickCatalogEntry[] {
  const ids = new Set<string>()
  const visit = (node: IRNode): void => {
    if (node.kind === 'conditional') return visit(node.consequent)
    if (node.kind === 'list') return visit(node.template)
    if (node.kind !== 'element') return
    if (
      node.module?.pluginId === EFFECT_PICK_PLUGIN_ID &&
      node.module.moduleType === EFFECT_PICK_MODULE_TYPE
    ) {
      const id = node.module.payload.effectId
      if (typeof id === 'string') ids.add(id)
    }
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return EFFECT_PICK_CATALOG.filter((entry) => ids.has(entry.id))
}

export const EFFECT_PICK_CONFIG_SOURCE = `interface OpenPencilEffectPickConfig {
  effectId: string
  collectionVersion: string
  artifactDigest: string
  text: string
  color: string
  secondaryColor: string
  speed: number
}`

// Resolve inline padding from the definite effect container before intrinsic button sizing.
// The reviewed artifact and its persisted digest remain unchanged.
const EFFECT_PICK_BUTTON_LAYOUT_CSS =
  '\n.fx-diagonal-fill{container-type:inline-size}.fx-diagonal-fill .fx-button{padding-inline:clamp(.6rem,8cqw,2.6rem)}'

/** Emits trusted local code only. Artifact data comes from the reviewed Core catalog. */
export function effectPickRuntimeSource(
  artifacts: readonly EffectPickCatalogEntry[],
  typescript = false
): string {
  const reviewed = artifacts.map((artifact) => {
    const entry = EFFECT_PICK_CATALOG.find((candidate) => candidate.id === artifact.id)
    if (
      !entry ||
      entry.artifactDigest !== artifact.artifactDigest ||
      entry.collectionVersion !== artifact.collectionVersion
    ) {
      throw new TypeError('EffectPick artifact is not in the reviewed catalog')
    }
    return {
      id: entry.id,
      collectionVersion: entry.collectionVersion,
      artifactDigest: entry.artifactDigest,
      events: entry.events,
      artifact: entry.artifact
    }
  })
  const annotation = (type: string): string => (typescript ? `: ${type}` : '')
  return `${typescript ? EFFECT_PICK_CONFIG_SOURCE : ''}
const effectPickArtifacts = ${JSON.stringify(reviewed).replace(/</g, '\\u003c')}
function effectPickRecord(value${annotation('unknown')})${annotation('Record<string, unknown> | null')} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const result${annotation('Record<string, unknown>')} = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !property || !property.enumerable || !('value' in property)) return null
    result[key] = property.value
  }
  return result
}
function effectPickConfig(value${annotation('unknown')}) {
  const config = effectPickRecord(value)
  if (!config || Object.keys(config).sort().join(',') !== 'artifactDigest,collectionVersion,color,effectId,secondaryColor,speed,text') return null
  const entry = effectPickArtifacts.find(candidate => candidate.id === config.effectId && candidate.collectionVersion === config.collectionVersion && candidate.artifactDigest === config.artifactDigest)
  if (!entry || typeof config.text !== 'string' || config.text.length > 160 || typeof config.color !== 'string' || typeof config.secondaryColor !== 'string' || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(config.color) || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(config.secondaryColor) || typeof config.speed !== 'number' || !Number.isFinite(config.speed) || config.speed < .1 || config.speed > 4) return null
  return {entry, config: {effectId:entry.id,collectionVersion:entry.collectionVersion,artifactDigest:entry.artifactDigest,text:config.text,color:config.color,secondaryColor:config.secondaryColor,speed:config.speed}}
}
function effectPickEscape(text${annotation('string')})${annotation('string')} {
  return text.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character] || character))
}
function mountEffectPick(host${annotation('HTMLElement')}, authored${annotation('unknown')}, onClick${typescript ? '?: (event: MouseEvent) => void' : ''}) {
  const initial = effectPickConfig(authored)
  if (!initial) throw new TypeError('EffectPick configuration rejected')
  const document = host.ownerDocument, view = document.defaultView
  if (!view) throw new TypeError('EffectPick document is unavailable')
  const buttonConstructor = view.HTMLButtonElement
  const transitionConstructor = typeof view.CSSTransition === 'function' ? view.CSSTransition : null
  const shadow = host.shadowRoot || host.attachShadow({mode:'open'})
  shadow.querySelector('[data-effect-pick-surface]')?.dispatchEvent(new view.Event('effect-pick-replace'))
  const style = document.createElement('style'), surface = document.createElement('div')
  const instanceId = 'ep-' + Array.from(view.crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2,'0')).join('')
  surface.setAttribute('data-effect-pick-surface', '')
  shadow.replaceChildren(style, surface)
  let current = initial, destroyed = false, requestedPlay = true, onscreen = true, reducedOverride = false
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)')
  const animations = () => surface.getAnimations({subtree:true})
  function synchronize() {
    if (destroyed) return
    const paused = !requestedPlay || document.hidden || reduced.matches || reducedOverride || !onscreen
    surface.toggleAttribute('data-effect-pick-reduced-motion', reduced.matches || reducedOverride)
    surface.toggleAttribute('data-effect-pick-paused', paused)
    for (const animation of animations()) {
      if (!transitionConstructor || !(animation instanceof transitionConstructor)) animation.updatePlaybackRate(current.config.speed)
      if (paused) animation.pause()
      else animation.play()
    }
  }
  function render() {
    for (const animation of animations()) animation.cancel()
    const config = current.config, artifact = current.entry.artifact
    style.textContent = ':host{display:block;width:100%;height:100%}[data-effect-pick-surface]{width:100%;height:100%;display:grid;place-items:center;overflow:hidden}.fx{box-sizing:border-box;max-width:100%;max-height:100%}' + artifact.css + ${JSON.stringify(EFFECT_PICK_BUTTON_LAYOUT_CSS)} + '\\n[data-effect-pick-paused] *,[data-effect-pick-paused] *::before,[data-effect-pick-paused] *::after{animation-play-state:paused!important;transition-duration:0s!important}[data-effect-pick-reduced-motion] *,[data-effect-pick-reduced-motion] *::before,[data-effect-pick-reduced-motion] *::after{animation:none!important;transition:none!important}[data-effect-pick-reduced-motion] .water-level{transform:translateY(var(--water-y,64px))}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-play-state:paused!important;transition-duration:0s!important}}'
    const characters = Array.from(config.text).map((character, index) => '<span style="--wave-delay:' + (index * -110) + 'ms">' + (character === ' ' ? '&nbsp;' : effectPickEscape(character)) + '</span>').join('')
    const markup = artifact.markup.replace(/__EP_(?:TEXT|CHARACTERS|INSTANCE|WATER_FONT_SIZE)__/g, token => {
      if (token === '__EP_TEXT__') return effectPickEscape(config.text)
      if (token === '__EP_CHARACTERS__') return characters
      if (token === '__EP_INSTANCE__') return instanceId
      return String(Math.min(142,560/Math.max(1,Array.from(config.text).length)))
    })
    const effect = document.createElement('div')
    effect.className = 'fx fx-' + current.entry.id
    effect.style.setProperty('--fx-accent',config.color)
    effect.style.setProperty('--fx-secondary',config.secondaryColor)
    effect.style.setProperty('--fx-bg',config.secondaryColor)
    effect.style.setProperty('--fx-duration',artifact.durationMs + 'ms')
    effect.style.setProperty('--fx-speed',String(config.speed))
    effect.setAttribute('aria-label',config.text)
    effect.innerHTML = markup
    surface.replaceChildren(effect)
    void surface.offsetWidth
    synchronize()
  }
  function click(event${annotation('MouseEvent')}) {
    if (destroyed || !host.isConnected || !current.entry.events.includes('click') || !event.composedPath().some(target => target instanceof buttonConstructor)) return
    event.stopPropagation()
    onClick?.(event)
  }
  surface.addEventListener('click',click)
  surface.addEventListener('effect-pick-replace',destroy)
  document.addEventListener('visibilitychange',synchronize)
  reduced.addEventListener('change',synchronize)
  const observer = typeof view.IntersectionObserver === 'function' ? new view.IntersectionObserver(entries => {
    if (destroyed) return
    onscreen = entries.some(entry => entry.isIntersecting)
    synchronize()
  }) : null
  observer?.observe(host)
  render()
  return {
    play() {if (destroyed) return; requestedPlay = true; synchronize()},
    pause() {if (destroyed) return; requestedPlay = false; synchronize()},
    replay() {if (destroyed) return; requestedPlay = true; render()},
    setReducedMotion(value${annotation('boolean')}) {if (destroyed) return; reducedOverride = value === true; synchronize()},
    setConfig(next${annotation('unknown')}) {
      if (destroyed) return false
      const validated = effectPickConfig(next)
      if (!validated) return false
      current = validated; render(); return true
    },
    destroy
  }
  function destroy() {
    if (destroyed) return
    destroyed = true
    observer?.disconnect()
    document.removeEventListener('visibilitychange',synchronize)
    reduced.removeEventListener('change',synchronize)
    surface.removeEventListener('click',click)
    surface.removeEventListener('effect-pick-replace',destroy)
    for (const animation of animations()) animation.cancel()
    style.remove();surface.remove()
  }
}
`
}

/** Provenance follows the exported project. It does not grant redistribution rights. */
export function emitEffectPickNotices(
  files: Map<string, string | Uint8Array>,
  artifacts: readonly EffectPickCatalogEntry[]
): void {
  if (artifacts.length === 0) return
  const path = 'EFFECT_PICK_SOURCES.md'
  if (files.has(path)) throw new Error('EffectPick source notice would overwrite generated file')
  files.set(
    path,
    [
      '# EffectPick local sources',
      '',
      'These reviewed implementations were adapted from the user-owned local @effect-pick/collection. The collection is UNLICENSED and source redistribution permissions have not been reviewed. This project export preserves provenance; it does not assert public distribution permission.',
      '',
      ...artifacts.map(
        (entry) =>
          `- ${entry.title} (${entry.id}), collection ${entry.collectionVersion}, digest ${entry.artifactDigest}. Source: ${entry.source.url}; author: ${entry.source.authorName || entry.source.author}; source mode: ${entry.source.mode}; license: ${entry.source.license}; status: ${entry.source.licenseStatus}.`
      ),
      ''
    ].join('\n')
  )
}
