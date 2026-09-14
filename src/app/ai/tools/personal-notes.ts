import { defineTool, type ToolDef } from '@open-pencil/core/tools'

import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'
import {
  createPersonalNotesPages,
  type NotesTemplateEditor
} from '@/app/lowcode/backend/notes-template'
import { appPluginStore, appPluginStoreReady } from '@/app/plugins'
import { listAppBackendProviderDescriptors } from '@/app/plugins/host/backend-provider'
import { NESTJS_BACKEND_PROVIDER_PLUGIN_ID } from '@/app/plugins/host/nestjs/backend-provider'

import {
  BACKEND_STARTER_AUTHENTICATION_PARAMS,
  backendStarterAuthentication
} from './backend/starter/authentication'
import type { BackendStarterAIToolOptions } from './backend/starter/types'

export const PERSONAL_NOTES_AI_TOOL_NAME = 'create_personal_notes_app'

export type PersonalNotesAIToolOptions = BackendStarterAIToolOptions

/** App-owned document authoring, separate from the Provider's read-only MCP review capability. */
export function createPersonalNotesAITools(
  editor: NotesTemplateEditor,
  options: PersonalNotesAIToolOptions = {}
): readonly ToolDef[] {
  const pluginStore = options.pluginStore ?? appPluginStore
  const ready = options.ready ?? (() => appPluginStoreReady.then(() => undefined))
  return [
    defineTool({
      name: PERSONAL_NOTES_AI_TOOL_NAME,
      mutates: true,
      description:
        'Create a working personal notes application (个人笔记): a reviewed NestJS owner-only data model, OIDC login page, protected notes page, and wired create/list/edit/delete controls in one undoable document operation. Use this before styling when the user wants an exportable working notes app. Requires the installed and enabled NestJS Backend Provider. Existing pages are preserved; an existing Backend or authentication flow is never replaced. This authors the document only and never starts services, accesses credentials, exports, migrates a database, or deploys.',
      params: BACKEND_STARTER_AUTHENTICATION_PARAMS,
      execute: async (_figma, args, context) => {
        context?.signal?.throwIfAborted()
        const publicConfig = backendStarterAuthentication(args)
        await ready()
        context?.signal?.throwIfAborted()
        const descriptor = listAppBackendProviderDescriptors(pluginStore).find(
          (entry) => entry.pluginId === NESTJS_BACKEND_PROVIDER_PLUGIN_ID
        )
        if (!descriptor) {
          throw new Error(
            'Enable the installed, host-reviewed NestJS Backend Provider in Settings → Plugins before creating notes.'
          )
        }
        if (readBackendProviderDocumentRequest(editor.graph)) {
          throw new Error(
            'This document already has a Backend model. Use a new document or edit the existing model in the Backend panel.'
          )
        }
        const application = createNestJSNotesApplication(crypto.randomUUID())
        const authentication = application.httpApi?.browserClient?.authentication
        if (!authentication) throw new Error('The reviewed notes login template is unavailable.')
        Object.assign(authentication, publicConfig)
        const pages = createPersonalNotesPages(editor, descriptor, application)
        return {
          status: 'created',
          providerId: descriptor.providerId,
          applicationId: application.applicationId,
          ...pages,
          exportPageIds: [pages.loginPageId, pages.notesPageId],
          authentication: {
            issuer: authentication.issuer,
            clientId: authentication.clientId,
            callbackPath: authentication.callbackPath
          },
          nextSteps: [
            'Use switch_page with notesPageId to show the created app, then style both returned pages while preserving controls, state IDs, bindings, events, routes, and the Backend declaration.',
            'Export both returned pages together as a React or Vue source project using the installed exporter.',
            'Follow the exported README to configure and start the database, identity service, API, and frontend. Document creation does not start or verify these services.'
          ]
        }
      }
    })
  ]
}
