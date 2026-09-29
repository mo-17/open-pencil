import { createModuleFieldFactory } from '#core/plugins/property-fields'
import type { ModulePropertyField } from '#core/plugins/types'

const field = createModuleFieldFactory('lowcodeModuleWalktour')
export const WALKTOUR_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  field('triggerLabel', 'text', 'Start button label'),
  field('steps', 'json', 'Guide steps'),
  field('disabled', 'boolean', 'Disabled'),
  field('showProgress', 'boolean', 'Show step progress'),
  field('showSkip', 'boolean', 'Show skip button'),
  field('panelWidth', 'number', 'Guide panel width', { min: 160, max: 600, step: 1 }),
  field('overlayOpacity', 'number', 'Overlay opacity', { min: 0, max: 0.8, step: 0.05 }),
  field('triggerBackground', 'color', 'Start button background'),
  field('triggerTextColor', 'color', 'Start button text color'),
  field('panelBackground', 'color', 'Guide panel background'),
  field('textColor', 'color', 'Guide text color'),
  field('accentColor', 'color', 'Accent color'),
  field('borderColor', 'color', 'Border color'),
  field('fontSize', 'number', 'Font size', { min: 10, max: 24, step: 1 }),
  field('borderRadius', 'number', 'Corner radius', { min: 0, max: 24, step: 1 })
])
