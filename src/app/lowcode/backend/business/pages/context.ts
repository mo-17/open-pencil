import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { DocumentStateDef, SceneNode } from '@open-pencil/scene-graph'

import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'

import {
  businessLabel,
  type BusinessTemplateDefinition,
  type BusinessTemplateEditor
} from '../types'
import { businessPageCopy } from './copy'
import { createBusinessLayout } from './layout'
import type { BusinessModulePageOptions, BusinessNavigationEntry } from './module-types'

export function createBusinessPageContext(
  editor: BusinessTemplateEditor,
  root: SceneNode,
  application: BackendApplicationSpecV1,
  definition: BusinessTemplateDefinition,
  locale: string,
  options: BusinessModulePageOptions = {}
) {
  const documentStates: DocumentStateDef[] = structuredClone(root.lowcodeDocumentState ?? [])
  const doc = (base: string, type: 'string' | 'object' = 'string') => {
    let name = 'business' + base.replace(/[^a-z0-9]/giu, '')
    while (documentStates.some((state) => state.name === name)) name += 'Next'
    documentStates.push({
      id: crypto.randomUUID(),
      name,
      type,
      defaultValue: type === 'object' ? {} : ''
    })
    return name
  }
  const reserved = new Set(
    editor.graph
      .getPages()
      .map(
        (page) => page.lowcodeRoutePattern || '/' + page.name.toLowerCase().replace(/\s+/gu, '-')
      )
  )
  const route = (base: string) => {
    for (let index = 1; index < 100; index++) {
      const candidate = index === 1 ? base : `${base}-${index}`
      if (reserved.has(candidate)) continue
      reserved.add(candidate)
      return candidate
    }
    throw new BackendDraftOperationError('No available business page route remains.')
  }
  const paths: Record<string, string> = {
    login: options.shared?.login.path ?? route('/business-login')
  }
  for (const page of definition.pages)
    paths[page.id] =
      page.id === 'account' && options.shared?.account
        ? options.shared.account.path
        : route(page.path)
  const navigationByPath = new Map<string, BusinessNavigationEntry>()
  const account = definition.pages.find((page) => page.id === 'account')
  const entries = [
    ...(account ? [{ key: paths.account, label: account.title, path: paths.account }] : []),
    ...(options.existingNavigation ?? []),
    ...definition.pages
      .filter((page) => page.id !== 'account')
      .map((page) => ({ key: paths[page.id], label: page.title, path: paths[page.id] }))
  ]
  for (const entry of entries) {
    if (!/^\/(?!\/)[^?#:*\\]*$/u.test(entry.path) || entry.path.length > 256)
      throw new BackendDraftOperationError(
        'Business navigation requires a bounded static application route.'
      )
    if (entry.path !== paths.login && !navigationByPath.has(entry.path))
      navigationByPath.set(entry.path, { ...entry, key: entry.path })
  }
  const navigation = [...navigationByPath.values()]
  const pageIds: string[] = []
  return {
    editor,
    application,
    definition,
    locale,
    paths,
    navigation,
    pageIds,
    doc,
    documentStates,
    layout: createBusinessLayout(editor),
    copy: businessPageCopy(locale),
    label: (value: Parameters<typeof businessLabel>[0]) => businessLabel(value, locale)
  }
}

export type BusinessPageContext = ReturnType<typeof createBusinessPageContext>
