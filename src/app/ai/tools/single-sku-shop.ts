import { defineTool, type ToolDef } from '@open-pencil/core/tools'

import { createCommerceApplication } from '@/app/lowcode/backend/commerce/application'
import { createCommercePages } from '@/app/lowcode/backend/commerce/template'
import type { NotesTemplateEditor } from '@/app/lowcode/backend/notes-template'
import { appPluginStore, appPluginStoreReady } from '@/app/plugins'
import { listAppBackendProviderDescriptors } from '@/app/plugins/host/backend-provider'
import { NESTJS_BACKEND_PROVIDER_PLUGIN_ID } from '@/app/plugins/host/nestjs/backend-provider'

import {
  BACKEND_STARTER_AUTHENTICATION_PARAMS,
  backendStarterAuthentication
} from './backend/starter/authentication'
import type { BackendStarterAIToolOptions } from './backend/starter/types'

export const SINGLE_SKU_SHOP_AI_TOOL_NAME = 'create_single_sku_shop_app'

export type SingleSkuShopAIToolOptions = BackendStarterAIToolOptions

/** Reuses the reviewed editor template; no service, credential, database or export authority. */
export function createSingleSkuShopAITools(
  editor: NotesTemplateEditor,
  options: SingleSkuShopAIToolOptions = {}
): readonly ToolDef[] {
  const pluginStore = options.pluginStore ?? appPluginStore
  const ready = options.ready ?? (() => appPluginStoreReady.then(() => undefined))
  return [
    defineTool({
      name: SINGLE_SKU_SHOP_AI_TOOL_NAME,
      mutates: true,
      description:
        'Create an exportable single-SKU-per-order shop starter (电商、商品、下单): public products, OIDC login, buyer-owned orders, catalog-manager controls, atomic server-priced checkout with inventory reservation, cancellation restoring stock, and explicit idempotent retries. Reuses the reviewed NestJS editor template in one undoable document operation. Requires the installed and enabled NestJS Backend Provider and a document without an existing Backend/authentication flow. Preserves existing pages. Does not collect payment, create database products or user roles, start services, access credentials, export, migrate or deploy. Use before styling a working shop request, then preserve its state, bindings, actions and Backend commands.',
      params: {
        ...BACKEND_STARTER_AUTHENTICATION_PARAMS,
        locale: {
          type: 'string',
          enum: ['en', 'zh-CN'],
          description:
            'Page copy language: choose zh-CN for Chinese or en for English. Defaults to en.'
        }
      },
      execute: async (_figma, args, context) => {
        context?.signal?.throwIfAborted()
        const publicConfig = backendStarterAuthentication(args)
        const locale = args.locale ?? 'en'
        if (!['en', 'zh-CN'].includes(locale)) throw new Error('Select en or zh-CN page language.')
        await ready()
        context?.signal?.throwIfAborted()
        const descriptor = listAppBackendProviderDescriptors(pluginStore).find(
          (entry) => entry.pluginId === NESTJS_BACKEND_PROVIDER_PLUGIN_ID
        )
        if (!descriptor)
          throw new Error(
            'Enable the installed, host-reviewed NestJS Backend Provider in Settings → Plugins before creating a shop.'
          )
        const authentication = {
          kind: 'oidc-pkce' as const,
          ...publicConfig,
          scopes: ['openid', 'profile'],
          callbackPath: '/_openpencil/auth/callback'
        }
        const application = createCommerceApplication(crypto.randomUUID(), authentication)
        const pages = createCommercePages(editor, descriptor, application, locale)
        const shopPageId = editor.graph
          .getPages()
          .find(
            (page) =>
              pages.pageIds.includes(page.id) && page.lowcodeRoutePattern === pages.paths.shop
          )?.id
        return {
          status: 'created',
          providerId: descriptor.providerId,
          applicationId: application.applicationId,
          ...pages,
          shopPageId,
          exportPageIds: pages.pageIds,
          authentication,
          nextSteps: [
            'Use switch_page with shopPageId to show the shop, then style all returned pages while preserving controls, state IDs, bindings, events, routes, authentication and the Backend commands.',
            'Export all returned exportPageIds together as a React or Vue source project using the installed exporter, and follow its README to configure the identity service, PostgreSQL, API and frontend.',
            'Configure a verified catalog-manager role through the identity service, then use the catalog page to create products. Prices use integer minor units; each order contains one SKU with quantity 1–99. No payment is collected.',
            'After refresh or signing in again with the same account, inspect the saved attempt before explicitly retrying its original key and parameters. Confirm the outcome in My orders before acknowledging the attempt and starting another. The browser retains bounded keys and parameters in local IndexedDB, never tokens or command results, and never resends automatically. Document creation does not start services or verify persistence.'
          ]
        }
      }
    })
  ]
}
