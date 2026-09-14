import { defineTool, type ToolDef } from '@open-pencil/core/tools'

import { createMerchantCommerceApplication } from '@/app/lowcode/backend/commerce/merchant/application'
import { createMerchantCommercePages } from '@/app/lowcode/backend/commerce/merchant/template'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'
import { createCommerceOperationsPages } from '@/app/lowcode/backend/commerce/operations/template'
import type { NotesTemplateEditor } from '@/app/lowcode/backend/notes-template'

import {
  BACKEND_STARTER_AUTHENTICATION_PARAMS,
  backendStarterAuthentication,
  type BackendStarterAuthenticationInput
} from './backend/starter/authentication'
import { resolveBackendStarterProvider } from './backend/starter/provider'
import type { BackendStarterAIToolOptions } from './backend/starter/types'

export const COMMERCE_AI_TOOL_NAME = 'create_commerce_app'
export type CommerceAIToolOptions = BackendStarterAIToolOptions

function merchantMode(value: unknown): 'single-merchant' | 'multi-merchant' {
  if (value === 'single-merchant' || value === 'multi-merchant') return value
  throw new Error('Explicitly select single-merchant or multi-merchant commerce mode.')
}

function commerceConfiguration(args: BackendStarterAuthenticationInput & Record<string, unknown>) {
  const mode = merchantMode(args.mode)
  const edition = args.edition ?? 'starter'
  if (edition !== 'starter' && edition !== 'operations')
    throw new Error('Select starter or operations edition.')
  const commission = args.commission_basis_points ?? 0
  if (
    typeof commission !== 'number' ||
    !Number.isInteger(commission) ||
    commission < 0 ||
    commission > 10000 ||
    (edition === 'starter' && commission !== 0)
  )
    throw new Error('Commission requires operations and an integer from 0 to 10000 basis points.')
  const publicConfig = backendStarterAuthentication(args)
  const locale = args.locale ?? 'en'
  if (locale !== 'en' && locale !== 'zh-CN') throw new Error('Select en or zh-CN page language.')
  return { mode, edition, commission, publicConfig, locale }
}

const roleInstructions = {
  operations:
    'Grant merchant for store ownership and commerce-operator separately for refund review and settlement bookkeeping. Both operations modes use one store per account; single-merchant additionally permits only one store in the application. Do not grant roles through document or client state.',
  'multi-merchant':
    'The platform must grant the merchant role through the identity service before a user opens their own shop. Each account owns at most one shop. Preserve server membership lookup through stores owner/id; never trust a client-supplied owner or store as authorization.',
  'single-merchant':
    'Configure the catalog-manager role through the identity service for product management and merchant orders. Visiting a management page does not grant this role.'
}

/** Author the reviewed commerce document without obtaining service or deployment authority. */
export function createCommerceAITools(
  editor: NotesTemplateEditor,
  options: CommerceAIToolOptions = {}
): readonly ToolDef[] {
  return [
    defineTool({
      name: COMMERCE_AI_TOOL_NAME,
      mutates: true,
      description:
        'Create an exportable commerce application (电商、单商户、多商户) with an explicit single-merchant or multi-merchant mode. Includes a storefront, OIDC login, buyer orders, product management and merchant orders; multi-merchant adds a store directory and shop opening for verified merchants, one shop per account, with server-enforced store isolation. Reuses the reviewed NestJS template in one undoable document operation and preserves existing pages. Requires an installed, enabled NestJS Backend Provider and no existing Backend/authentication flow. Choose edition=operations for saved multi-product carts, atomic store-order splitting, simulated payments, manual shipping/delivery, pre-shipment whole-order refunds and settlement bookkeeping; starter remains the default one-SKU edition. Operations uses merchant-owned stores in both modes and a separate commerce-operator role. No real collection, carrier integration, automatic payout, role grants, service start, credential access, export, migration or deployment. Create the working flow before styling and preserve its commands and authorization.',
      params: {
        ...BACKEND_STARTER_AUTHENTICATION_PARAMS,
        mode: {
          type: 'string',
          enum: ['single-merchant', 'multi-merchant'],
          required: true,
          description:
            'Required business model: single-merchant for one merchant, multi-merchant for separate stores. Starter single mode uses catalog-manager; operations uses merchant-owned stores in both modes. Never infer a mode from the number of SKUs.'
        },
        edition: {
          type: 'string',
          enum: ['starter', 'operations'],
          description:
            'Default starter preserves the existing one-SKU template. Choose operations for payment, cart, shipping, refunds or settlement requests; payment is simulated and settlement records do not transfer funds.'
        },
        commission_basis_points: {
          type: 'number',
          description:
            'Operations only: integer commission basis points from 0 to 10000, default 0. 100 basis points equals 1 percent.'
        },
        locale: {
          type: 'string',
          enum: ['en', 'zh-CN'],
          description: 'Page copy language: zh-CN for Chinese or en for English; defaults to en.'
        }
      },
      execute: async (_figma, args, context) => {
        context?.signal?.throwIfAborted()
        const { mode, edition, commission, publicConfig, locale } = commerceConfiguration(args)
        const descriptor = await resolveBackendStarterProvider(options, context?.signal)
        const authentication = {
          kind: 'oidc-pkce' as const,
          ...publicConfig,
          scopes: ['openid', 'profile'],
          callbackPath: '/_openpencil/auth/callback'
        }
        const application =
          edition === 'operations'
            ? createCommerceOperationsApplication(
                crypto.randomUUID(),
                authentication,
                mode,
                commission
              )
            : createMerchantCommerceApplication(crypto.randomUUID(), authentication, mode)
        const pages =
          edition === 'operations'
            ? createCommerceOperationsPages(editor, descriptor, application, mode, locale)
            : createMerchantCommercePages(editor, descriptor, application, mode, locale)
        const shopPageId = pages.pageIds.find(
          (id) => editor.graph.getNode(id)?.lowcodeRoutePattern === pages.paths.shop
        )
        return {
          status: 'created',
          mode,
          edition,
          providerId: descriptor.providerId,
          applicationId: application.applicationId,
          ...pages,
          shopPageId,
          exportPageIds: pages.pageIds,
          authentication,
          nextSteps: [
            'Use switch_page with shopPageId, inspect every exportPageId and style the existing controls. Preserve state, bindings, events, routes, command recovery and server authorization; export all returned pages together as a React or Vue source project.',
            roleInstructions[edition === 'operations' ? 'operations' : mode],
            'Follow the exported README to configure OIDC, PostgreSQL, the API and frontend. Document creation does not start services, create database rows, grant roles, or verify real login or persistence.',
            edition === 'operations'
              ? 'Preserve the account-bound cart, server-owned totals/stock/atomic splitting, payment simulation labels, manual tracking, pre-shipment whole-store-order refund limits, settlement eligibility and explicit saved-request recovery. Simulated payment is disabled in production. Recorded settlements are bookkeeping, not transfers; default commission is 0 and settlement delay is 7 days.'
              : 'Keep single-SKU order quantities, server pricing and stock checks, explicit checkout/cancellation confirmations, and saved-request inspection, retry and acknowledgement. Never calculate authoritative prices or inventory updates in the browser. Payments, multi-SKU carts, shipping tracking and settlement splitting are not included.'
          ]
        }
      }
    })
  ]
}
