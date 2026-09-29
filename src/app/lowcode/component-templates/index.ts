export { COMPONENT_TEMPLATE_IDS, getComponentTemplates, isComponentTemplateId } from './catalog'
export type {
  ComponentTemplateId,
  ComponentTemplateItem,
  ComponentTemplateKind,
  ComponentTemplateModule
} from './catalog'
export { createComponentTemplate } from './build'
export { componentTemplateAvailability, insertComponentTemplate } from './insert'
export { ComponentTemplateError } from './types'
export type {
  ComponentTemplateEditor,
  ComponentTemplatePlacement,
  ComponentTemplateResult
} from './types'
