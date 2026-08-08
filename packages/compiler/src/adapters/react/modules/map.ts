import { MAP_MODULE_TYPE, MAP_PLUGIN_ID } from '@open-pencil/core/plugins'

import { buildOpenPencilMapComponent, MAPLIBRE_GL_VERSION } from '../map/component'
import type { ReactModuleAdapter } from './types'

export const MAP_REACT_MODULE_ADAPTER: ReactModuleAdapter = Object.freeze({
  pluginId: MAP_PLUGIN_ID,
  moduleType: MAP_MODULE_TYPE,
  componentName: 'OpenPencilMap',
  runtimePath: 'src/__openpencil_map.tsx',
  rootImportPath: './__openpencil_map',
  nestedImportPath: '../__openpencil_map',
  dependencies: Object.freeze({ 'maplibre-gl': MAPLIBRE_GL_VERSION }),
  optimizeDeps: Object.freeze(['maplibre-gl']),
  buildRuntime: buildOpenPencilMapComponent
})
