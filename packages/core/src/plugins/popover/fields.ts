import type { ModulePropertyField } from '#core/plugins/types'

export function popoverFields(): ModulePropertyField[] {
  const field = (
    key: string,
    label: string,
    kind: ModulePropertyField['kind'],
    extra: Partial<ModulePropertyField> = {}
  ): ModulePropertyField => ({
    path: [key],
    kind,
    label,
    i18nLabelKey: 'lowcodeModuleFieldPopover' + key[0].toUpperCase() + key.slice(1),
    ...extra
  })
  return [
    field('mode', 'Mode', 'select', { options: ['popover', 'confirm'] }),
    field('triggerLabel', 'Trigger text', 'text'),
    field('title', 'Title', 'text'),
    field('contentChildName', 'Content child layer', 'text'),
    field('content', 'Content', 'text'),
    field('placement', 'Preferred placement', 'select', {
      options: ['top', 'right', 'bottom', 'left']
    }),
    field('gap', 'Distance', 'number', { min: 0, max: 32, step: 1 }),
    field('panelWidth', 'Panel width', 'number', { min: 160, max: 720, step: 1 }),
    field('disabled', 'Disabled', 'boolean'),
    field('confirmLabel', 'Confirm text', 'text'),
    field('cancelLabel', 'Cancel text', 'text'),
    field('panelBackground', 'Panel background', 'color'),
    field('textColor', 'Panel text color', 'color'),
    field('accentColor', 'Confirm background', 'color'),
    field('triggerBackground', 'Trigger background', 'color'),
    field('triggerTextColor', 'Trigger text color', 'color'),
    field('borderRadius', 'Corner radius', 'number', { min: 0, max: 32, step: 1 }),
    field('fontSize', 'Font size', 'number', { min: 10, max: 32, step: 1 })
  ]
}
