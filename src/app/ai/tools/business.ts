import { defineTool, type ToolDef } from '@open-pencil/core/tools'

import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import { prepareBusinessModuleInstallation } from '@/app/lowcode/backend/business/installation'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import {
  assertBusinessTemplateId,
  BUSINESS_TEMPLATE_IDS
} from '@/app/lowcode/backend/business/model/types'
import { requireBusinessTemplatePlugins } from '@/app/lowcode/backend/business/plugins'
import { createBusinessPages } from '@/app/lowcode/backend/business/template'
import type { BusinessTemplateEditor } from '@/app/lowcode/backend/business/types'
import { appPluginStore } from '@/app/plugins'

import {
  BACKEND_STARTER_AUTHENTICATION_PARAMS,
  backendStarterAuthentication
} from './backend/starter/authentication'
import { resolveBackendStarterProvider } from './backend/starter/provider'
import type { BackendStarterAIToolOptions } from './backend/starter/types'

export const BUSINESS_AI_TOOL_NAME = 'create_business_app'
export type BusinessAIToolOptions = BackendStarterAIToolOptions

/** Create a reviewed document; service setup, role grants and deployment stay separate. */
export function createBusinessAITools(
  editor: BusinessTemplateEditor,
  options: BusinessAIToolOptions = {}
): readonly ToolDef[] {
  return [
    defineTool({
      name: BUSINESS_AI_TOOL_NAME,
      mutates: true,
      description:
        'Create a working, exportable business application or explicitly add a module to an existing compatible application: customer CRM (客户跟进), independent single-stage ticket approval (工单审批), plain-text content/knowledge base (内容知识库), capacity-checked bookings (预约报名), project memberships/tasks (项目任务), rental listings and viewing appointments with a linked VR panorama (租房看房), video catalog/live channels with playback, creator management and favorites (视频网站与直播), single-restaurant dine-in/pickup food ordering with cart, menu management and kitchen transitions (点餐), personal blogging with categories, draft editing, publishing and private bookmarks (个人博客), automotive news with brands/models, editor/publisher roles and private bookmarks (汽车资讯), or single-hospital registration with departments, doctors, capacity-checked schedules, private patients, appointments and staff handling (医院挂号). Also supports procurement/inventory with partial receipts, returns and stocktakes (进销存), fixed two-stage leave/expense/purchase approvals (企业审批), immutable fixed-question surveys (问卷), text courses with enrollment and instructor grading (在线课程), and moderated discussions, replies, private follows and reports (社区论坛). Also supports individually tracked asset custody and maintenance (资产管理, asset-management), private single-line quote versions and recorded contract delivery/acceptance (报价与合同, quote-contracts), and private HR recruitment with onboarding/offboarding checklists (招聘与入离职, recruitment-hr). Contract confirmations are internal records, not electronic signatures; HR checklists never change identity-service access. Rental requires VR Tour; video-live requires Video. mode=create requires an empty Backend/auth flow and public OIDC configuration. mode=add-module reviews compatibility, shares the existing login and account setup, appends navigation and preserves existing pages, permissions and customizations in one undoable change; omit authentication parameters. Requires an enabled NestJS provider. Does not grant roles, access credentials, start services, migrate databases, export, deploy, start real streaming or contact third-party services.',
      params: {
        ...BACKEND_STARTER_AUTHENTICATION_PARAMS,
        authentication: {
          ...BACKEND_STARTER_AUTHENTICATION_PARAMS.authentication,
          required: false,
          description:
            'Required only for mode=create. Omit authentication, issuer and client_id when adding a module; the existing application identity service is reused.'
        },
        mode: {
          type: 'string',
          enum: ['create', 'add-module'],
          description:
            'create by default. Use add-module only when the user asks to extend an existing application with another business workflow.'
        },
        kind: {
          type: 'string',
          required: true,
          enum: [...BUSINESS_TEMPLATE_IDS],
          description:
            'Required reviewed application template; choose by the user’s business workflow.'
        },
        locale: {
          type: 'string',
          enum: ['en', 'zh-CN'],
          description: 'Page language, en by default or zh-CN for Chinese.'
        }
      },
      execute: async (_figma, args, context) => {
        assertBusinessTemplateId(args.kind)
        const locale = args.locale ?? 'en'
        if (locale !== 'en' && locale !== 'zh-CN')
          throw new Error('Select en or zh-CN page language.')
        const mode = args.mode ?? 'create'
        if (mode !== 'create' && mode !== 'add-module')
          throw new Error('Select create or add-module mode.')
        if (mode === 'add-module') {
          if (
            args.authentication !== undefined ||
            args.issuer !== undefined ||
            args.client_id !== undefined
          )
            throw new Error(
              'Adding a module reuses existing sign-in. Omit all authentication overrides.'
            )
          await resolveBackendStarterProvider(options, context?.signal)
          const installation = prepareBusinessModuleInstallation({
            editor,
            store: options.pluginStore ?? appPluginStore,
            kind: args.kind,
            locale
          })
          if (installation.review.status !== 'ready') throw new Error(installation.review.summary)
          context?.signal?.throwIfAborted()
          const result = installation.apply()
          return {
            status: 'module-added',
            ...result,
            entryPath: result.path,
            exportPageIds: editor.graph
              .getPages()
              .filter((page) => !page.internalOnly && page.lowcodeRoutePattern)
              .map((page) => page.id),
            review: installation.review,
            nextSteps: [
              'Inspect the new pages and appended navigation, preserve existing customizations, and export every exportPageId together as one React or Vue application.',
              'Reuse the existing sign-in and Account setup. Grant required roles only through the identity service; adding a module does not grant permissions or project membership.',
              'Review and apply database changes separately before using the added module. This change does not start services, migrate data or verify real login.'
            ]
          }
        }
        if (typeof args.authentication !== 'string')
          throw new Error(
            'Select local-keycloak or oidc authentication when creating an application.'
          )
        const publicConfig = backendStarterAuthentication({
          ...args,
          authentication: args.authentication
        })
        const descriptor = await resolveBackendStarterProvider(options, context?.signal)
        requireBusinessTemplatePlugins(options.pluginStore ?? appPluginStore, args.kind)
        const authentication = {
          kind: 'oidc-pkce' as const,
          ...publicConfig,
          scopes: ['openid', 'profile'],
          callbackPath: '/_openpencil/auth/callback'
        }
        const application = createBusinessApplication(
          crypto.randomUUID(),
          authentication,
          args.kind
        )
        const pages = createBusinessPages(editor, descriptor, application, args.kind, locale)
        const definition = businessTemplateDefinition(args.kind)
        const entryPath = pages.paths[definition.entryPage]
        const entryPageId = pages.pageIds.find(
          (id) => editor.graph.getNode(id)?.lowcodeRoutePattern === entryPath
        )
        return {
          status: 'created',
          kind: args.kind,
          providerId: descriptor.providerId,
          applicationId: application.applicationId,
          ...pages,
          entryPageId,
          entryPath,
          exportPageIds: pages.pageIds,
          authentication,
          nextSteps: [
            'Switch to entryPageId, inspect every exportPageId and style existing controls. Preserve forms, bindings, routes, account-bound request recovery and authorization; export all returned pages together as React or Vue source.',
            'Sign in and register your own profile in Account setup. Grant ' +
              definition.roles.join(', ') +
              ' only through the identity service; profile registration and navigation do not grant roles or membership.',
            'Follow the exported README to configure OIDC, PostgreSQL and the API. Creating pages does not start services, create records, verify real login or apply migrations.',
            'Keep independent approval, server status/capacity checks and record access rules. Connect attachments, notifications, payments or third-party APIs after export.'
          ]
        }
      }
    })
  ]
}
