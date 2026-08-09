import {
  ACCORDION_MODULE_TYPE,
  ACCORDION_PLUGIN_ID,
  resolveAccordionModule
} from '@open-pencil/core/plugins'

import { createContractModuleLowerer } from './contract-lowerer'

export const ACCORDION_COMPILER_MODULE_LOWERER = createContractModuleLowerer({
  pluginId: ACCORDION_PLUGIN_ID,
  moduleType: ACCORDION_MODULE_TYPE,
  warningCodePrefix: 'accordion-module',
  displayName: 'Accordion',
  resolve: resolveAccordionModule,
  payload: (config) => ({
    label: config.label,
    items: config.items.map((item) => ({ ...item })),
    allowMultiple: config.allowMultiple,
    initialOpenIds: [...config.initialOpenIds],
    showDividers: config.showDividers,
    backgroundColor: config.backgroundColor,
    textColor: config.textColor,
    accentColor: config.accentColor,
    fontSize: config.fontSize
  })
})
