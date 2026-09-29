import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import { PAGINATION_FIELDS } from './pagination/fields'
import { parsePaginationConfig } from './pagination/parse'
import type { ModuleResolution } from './types'

export { paginationPageCount, clampPaginationPage, paginationItems } from './pagination/pages'
export { PAGINATION_LAYOUT, paginationLayout } from './pagination/layout'
export type { PaginationItem } from './pagination/pages'
export type { PaginationLayout, PaginationCell } from './pagination/layout'
export const PAGINATION_PLUGIN_ID = 'open-pencil.pagination'
export const PAGINATION_MODULE_TYPE = 'pagination'
export const PAGINATION_MODULE_CONFIG_VERSION = 1
export const PAGINATION_MODULE_DEFAULT_SIZE = Object.freeze({ width: 440, height: 48 })
export const PAGINATION_MODULE_LIMITS = Object.freeze({
  total: 1_000_000_000,
  pageSize: 1000,
  configBytes: 4096
})

export interface PaginationModuleConfigV1 extends JSONObject {
  label: string
  total: number
  pageSize: number
  initialPage: number
  showFirstLast: boolean
  disabled: boolean
  size: 'comfortable' | 'compact'
  backgroundColor: string
  textColor: string
  accentColor: string
  borderColor: string
  borderRadius: number
  fontSize: number
}
export type PaginationModuleConfig = PaginationModuleConfigV1
export const PAGINATION_MODULE_DEFAULT_CONFIG: Readonly<PaginationModuleConfigV1> = Object.freeze({
  label: 'Pagination',
  total: 100,
  pageSize: 10,
  initialPage: 1,
  showFirstLast: false,
  disabled: false,
  size: 'comfortable',
  backgroundColor: '#FFFFFF',
  textColor: '#172B4D',
  accentColor: '#2563EB',
  borderColor: '#E2E8F0',
  borderRadius: 8,
  fontSize: 14
})
const CONTRACT: contract.ModuleContract<PaginationModuleConfigV1> = {
  pluginId: PAGINATION_PLUGIN_ID,
  moduleType: PAGINATION_MODULE_TYPE,
  configVersion: PAGINATION_MODULE_CONFIG_VERSION,
  displayName: 'pagination',
  defaultConfig: PAGINATION_MODULE_DEFAULT_CONFIG,
  parseConfig: parsePaginationConfig
}
export function createPaginationModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolvePaginationModule(
  value: unknown
): ModuleResolution<PaginationModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createPaginationModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Pagination',
      defaultSize: PAGINATION_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createPaginationModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}
export const PAGINATION_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Pagination',
  description: 'Bounded page navigation with previous, next, and optional first and last controls.',
  i18nNameKey: 'lowcodeModulePaginationName',
  i18nDescriptionKey: 'lowcodeModulePaginationDescription',
  defaultSize: PAGINATION_MODULE_DEFAULT_SIZE,
  fields: PAGINATION_FIELDS,
  createInstance: createPaginationModuleInstance,
  createFrameOverrides: createPaginationModuleFrameOverrides,
  resolve: resolvePaginationModule
})
export const PAGINATION_PLUGIN = contract.createSingleModulePlugin(
  PAGINATION_PLUGIN_ID,
  'OpenPencil Pagination',
  PAGINATION_MODULE_DEFINITION
)
