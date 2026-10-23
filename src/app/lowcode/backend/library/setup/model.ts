import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { SceneNode } from '@open-pencil/scene-graph'

import { validTemplateAuthentication } from '../authentication'
import type { BackendLibraryItem, BackendLibraryProvider } from '../catalog'

export type TemplateSetupAction = 'plugins' | 'model' | 'login' | 'pages' | 'preview'
export type TemplateSetupCheckId = 'provider' | 'model' | 'login' | 'pages' | 'runtime'
export interface TemplateSetupCheck {
  readonly id: TemplateSetupCheckId
  readonly state: 'configured' | 'missing' | 'unverified'
  readonly action: TemplateSetupAction
}
export type TemplateSetupPage = Pick<SceneNode, 'id' | 'name' | 'lowcodeRoutePattern'>

export interface TemplateSetupReadinessInput {
  readonly application: BackendApplicationSpecV1 | null
  readonly providerAvailable: boolean
  readonly valid: boolean
  readonly unsaved: boolean
  readonly pages: readonly TemplateSetupPage[]
}

/** Templates use their existing NestJS installer; unrelated providers cannot be substituted. */
export function templateSetupProviders(
  items: readonly BackendLibraryItem[]
): BackendLibraryProvider[] {
  return items.filter(
    (item): item is BackendLibraryProvider =>
      item.kind === 'provider' && item.providerId === 'nestjs' && !!item.descriptorKey
  )
}

/** Local metadata is evidence of configuration, never of a reachable or deployed service. */
export function templateSetupReadiness(input: TemplateSetupReadinessInput): TemplateSetupCheck[] {
  const authentication = input.application?.httpApi?.browserClient?.authentication
  return [
    {
      id: 'provider',
      state: input.providerAvailable ? 'configured' : 'missing',
      action: 'plugins'
    },
    {
      id: 'model',
      state: input.application && input.valid && !input.unsaved ? 'configured' : 'missing',
      action: 'model'
    },
    {
      id: 'login',
      state:
        authentication && validTemplateAuthentication(authentication) ? 'configured' : 'missing',
      action: 'login'
    },
    {
      id: 'pages',
      state: input.pages.some((page) => !!page.lowcodeRoutePattern) ? 'configured' : 'missing',
      action: 'pages'
    },
    { id: 'runtime', state: 'unverified', action: 'preview' }
  ]
}
