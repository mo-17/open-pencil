import type {
  BackendApplicationSpecV1,
  BackendModuleDefinitionIR
} from '@open-pencil/lowcode/backend'

import { detectStandaloneBusinessKinds } from '../business/composition'
import { businessModuleDefinition } from '../business/composition/modules'
import { createBusinessApplication } from '../business/model'
import { BUSINESS_TEMPLATE_IDS, type BusinessTemplateId } from '../business/model/types'

export interface RecognizedBusinessModule {
  readonly kind: BusinessTemplateId
  readonly declaration: BackendModuleDefinitionIR
}

/** Module labels alone cannot identify a template. Require its declared record ownership too. */
function ownsTemplate(
  actual: BackendModuleDefinitionIR,
  expected: BackendModuleDefinitionIR
): boolean {
  return (['entityIds', 'resourceIds', 'commandIds', 'dependsOn'] as const).every((key) =>
    expected[key].every((id) => actual[key].includes(id))
  )
}

export function recognizedBusinessModules(
  application: BackendApplicationSpecV1
): RecognizedBusinessModule[] {
  const authentication = application.httpApi?.browserClient?.authentication
  if (!authentication) return []
  const standalone = application.modules ? [] : detectStandaloneBusinessKinds(application)
  return BUSINESS_TEMPLATE_IDS.flatMap((kind) => {
    const declared = application.modules?.modules.find((entry) => entry.id === kind)
    if (!declared && !standalone.includes(kind)) return []
    const source = createBusinessApplication(application.applicationId, authentication, kind)
    const expected = businessModuleDefinition(source, kind)
    if (declared && !ownsTemplate(declared, expected)) return []
    return [{ kind, declaration: declared ?? expected }]
  })
}
