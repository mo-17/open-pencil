import { MAP_MODULE_ATTRIBUTION, MAP_MODULE_LIMITS } from '@open-pencil/core/plugins'

/** Host-reviewed local dependency; documents cannot select a map runtime or tile origin. */
export const MAPLIBRE_GL_VERSION = '6.4.1'
export const MAP_DEPENDENCIES = Object.freeze({ 'maplibre-gl': MAPLIBRE_GL_VERSION })

const attribution = `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">${MAP_MODULE_ATTRIBUTION}</a>`

/** Framework-neutral generated MapLibre lifecycle, shared by the web adapters. */
export const MAP_RUNTIME_SOURCE = String.raw`
import { Map as MapLibreMap, Marker as MapLibreMarker, Popup as MapLibrePopup, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export interface OpenPencilMapMarker { id: string; lng: number; lat: number; label?: string }
export interface OpenPencilMapConfig {
  provider: 'openstreetmap'
  style: 'standard' | 'light' | 'dark'
  center: readonly [number, number]
  zoom: number
  interactive: boolean
  markers: readonly OpenPencilMapMarker[]
  layers: readonly unknown[]
  attribution: string
}

const OPENSTREETMAP_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png']
const OPENSTREETMAP_ATTRIBUTION = ${JSON.stringify(attribution)}
const STYLE_FILTERS: Record<OpenPencilMapConfig['style'], string> = {
  standard: 'none', light: 'grayscale(0.2) brightness(1.08) contrast(0.9)',
  dark: 'invert(0.92) hue-rotate(180deg) brightness(0.72) contrast(1.18) saturate(0.7)'
}

function ownMapRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const keys = Reflect.ownKeys(value)
  return required.every(key => keys.includes(key)) && keys.every(key => typeof key === 'string' &&
    (required.includes(key) || optional.includes(key)) && 'value' in (Object.getOwnPropertyDescriptor(value, key) ?? {}))
}
function ownMapArray(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false
  return Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
    .every(descriptor => descriptor && 'value' in descriptor)
}
function mapNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}
export function serializeOpenPencilMapConfig(value: unknown): string | null {
  try {
    if (!ownMapRecord(value, ['provider', 'style', 'center', 'zoom', 'interactive', 'markers', 'layers', 'attribution']) ||
      value.provider !== 'openstreetmap' || typeof value.style !== 'string' || !['standard', 'light', 'dark'].includes(value.style) ||
      value.attribution !== ${JSON.stringify(MAP_MODULE_ATTRIBUTION)} ||
      !ownMapArray(value.center, 2) || value.center.length !== 2 || !mapNumber(value.center[0], -180, 180) ||
      !mapNumber(value.center[1], -90, 90) || !mapNumber(value.zoom, 0, ${MAP_MODULE_LIMITS.zoom}) ||
      typeof value.interactive !== 'boolean' || !ownMapArray(value.layers, 0) || !ownMapArray(value.markers, ${MAP_MODULE_LIMITS.markers})) return null
    const ids = new Set<string>()
    for (const marker of value.markers) {
      if (!ownMapRecord(marker, ['id', 'lng', 'lat'], ['label']) || typeof marker.id !== 'string' ||
        !/^[A-Za-z0-9._:-]+$/.test(marker.id) || marker.id.length > ${MAP_MODULE_LIMITS.markerId} || ids.has(marker.id) ||
        !mapNumber(marker.lng, -180, 180) || !mapNumber(marker.lat, -90, 90) ||
        (marker.label !== undefined && (typeof marker.label !== 'string' || marker.label.length > ${MAP_MODULE_LIMITS.label}))) return null
      ids.add(marker.id)
    }
    return JSON.stringify({ provider: value.provider, style: value.style, center: value.center, zoom: value.zoom,
      interactive: value.interactive, markers: value.markers.map(marker => {
        const item = marker as OpenPencilMapMarker
        return { id: item.id, lng: item.lng, lat: item.lat, ...(item.label === undefined ? {} : { label: item.label }) }
      }), layers: [], attribution: value.attribution })
  } catch { return null }
}
function openStreetMapStyle(): StyleSpecification {
  return { version: 8, sources: { openstreetmap: { type: 'raster', tiles: OPENSTREETMAP_TILES,
    tileSize: 256, maxzoom: 19, attribution: OPENSTREETMAP_ATTRIBUTION } },
    layers: [{ id: 'openstreetmap', type: 'raster', source: 'openstreetmap' }] }
}
function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2')
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return context !== null
  } catch { return false }
}
export function mountOpenPencilMap(container: HTMLDivElement, serializedConfig: string | null, onFailure: () => void): () => void {
  if (serializedConfig === null || !supportsWebGl()) { onFailure(); return () => {} }
  const config = JSON.parse(serializedConfig) as OpenPencilMapConfig
  let map: MapLibreMap | undefined
  const markers: MapLibreMarker[] = []
  let canvas: HTMLCanvasElement | undefined
  let observer: ResizeObserver | undefined
  let active = true
  const release = () => {
    observer?.disconnect()
    observer = undefined
    canvas?.removeEventListener('webglcontextlost', contextLost)
    canvas = undefined
    for (const marker of markers) marker.remove()
    markers.length = 0
    const current = map
    map = undefined
    current?.remove()
  }
  const fail = () => { if (active) { release(); onFailure() } }
  const contextLost = (event: Event) => { event.preventDefault(); fail() }
  try {
    map = new MapLibreMap({ container, style: openStreetMapStyle(), center: [config.center[0], config.center[1]],
      zoom: config.zoom, maxZoom: 19, interactive: config.interactive, attributionControl: { compact: false } })
    if (!config.interactive) {
      map.boxZoom.disable(); map.doubleClickZoom.disable(); map.dragPan.disable(); map.dragRotate.disable()
      map.keyboard.disable(); map.scrollZoom.disable(); map.touchZoomRotate.disable()
    }
    canvas = map.getCanvas()
    canvas.style.filter = STYLE_FILTERS[config.style]
    canvas.addEventListener('webglcontextlost', contextLost)
    for (const marker of config.markers) {
      const instance = new MapLibreMarker()
      markers.push(instance)
      instance.setLngLat([marker.lng, marker.lat])
      if (marker.label) {
        const label = document.createElement('span')
        label.textContent = marker.label
        instance.setPopup(new MapLibrePopup({ offset: 24 }).setDOMContent(label))
      }
      instance.addTo(map)
    }
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => { if (active && map) { try { map.resize() } catch { fail() } } })
      observer.observe(container)
    }
  } catch { fail() }
  return () => { active = false; release() }
}
`
