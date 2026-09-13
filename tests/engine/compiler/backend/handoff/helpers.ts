import {
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { fakeBackendApplication } from '../helpers'

export const HANDOFF_PACKAGE_DIGEST = `app-bundle-sha256:${'A'.repeat(43)}`
export const OTHER_DIGEST = 'E'.repeat(43)

export function handoffApplication(): BackendApplicationSpecV1 {
  const application = fakeBackendApplication(['data.read', 'migrations.schema', 'policy.row-level'])
  application.applicationId = 'handoff-application'
  application.dataModel.entities = [
    {
      id: 'handoff-records',
      name: 'handoff_records',
      management: 'managed',
      fields: [{ id: 'record-id', name: 'id', type: 'uuid', nullable: false }],
      primaryKey: { fields: ['record-id'] }
    }
  ]
  return application
}

export function handoffDeclaration(
  selection: BackendProviderSelection,
  application: BackendApplicationSpecV1
) {
  const { outputs, ...descriptor } = selection.descriptor
  return {
    format: 'openpencil.backend-provider-request.v1',
    selection: {
      ...descriptor,
      outputKinds: outputs,
      descriptorVersion: 1,
      packageAuthority: {
        packageDigest: selection.packageDigest,
        trustSource: 'app-bundle',
        publisherId: 'open-pencil',
        publisherKeyId: 'app-bundle-v1',
        pluginVersion: '1.0.0',
        pinnedDigest: null,
        marketplaceAuthority: null
      }
    },
    application
  }
}

export function handoffFixture(target: 'react' | 'vue' = 'react') {
  const selection: BackendProviderSelection = {
    descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: HANDOFF_PACKAGE_DIGEST,
    enabled: true
  }
  const application = handoffApplication()
  const registry = createBuiltinBackendProviderRegistry()
  const planned = createBackendProviderPlan(registry, {
    selection,
    application,
    target,
    mode: 'production'
  })
  if (!planned.ok) throw new Error('Invalid handoff test plan')
  const emitted = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
  if (!emitted.ok) throw new Error('Invalid handoff test emission')
  const declarationValue = handoffDeclaration(selection, application)
  return {
    declarationValue,
    plan: planned.plan,
    emission: emitted.emission,
    input: {
      declaration: JSON.stringify(declarationValue),
      selection,
      application,
      target,
      planDigest: planned.plan.planDigest,
      manifestDigest: emitted.emission.manifestDigest
    }
  }
}

export function deployMessage(stage: 'ready' | 'authorize' | 'cancel' = 'ready') {
  return {
    format: 'openpencil.backend-provider-deploy.v1',
    stage,
    handoffDigest: 'A'.repeat(43),
    dispatchDigest: OTHER_DIGEST,
    challenge: 'ab0234ed-195b-4be7-a4b1-b798fbf911bf'
  }
}
